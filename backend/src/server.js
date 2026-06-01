const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./utils/database');
const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');
const { initSignaling } = require('./signalingServer');

// Import routes
const authRoutes      = require('./routes/auth');
const deviceRoutes    = require('./routes/devices');
const recordingRoutes = require('./routes/recordings');
const streamRoutes    = require('./routes/streams');
const userRoutes      = require('./routes/users');

const app = express();
const httpServer = http.createServer(app);

// Make db available to routes via req.app.get('db')
app.set('db', db);

app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());

const corsOrigins = config.SECURITY.corsOrigin;
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${Date.now() - start}ms`,
      ip: req.ip,
    });
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ── Discovery Agent Report ─────────────────────────────────────────────────
// Called by the LAN agent — no user auth, uses orgId from body
// Saves to DB so it survives server restarts/redeploys
app.post('/api/discovery/report', async (req, res) => {
  try {
    const { orgId, devices, count, agentIP } = req.body;
    if (!orgId) return res.status(400).json({ success: false, message: 'orgId required' });

    const deviceList = devices || [];
    const deviceCount = count || deviceList.length;
    const ip = agentIP || req.ip;

    // Upsert into DB — survives restarts unlike global memory
    await db.query(
      `INSERT INTO discovery_reports (id, org_id, agent_ip, count, devices, discovered_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       ON CONFLICT (org_id)
       DO UPDATE SET agent_ip = $2, count = $3, devices = $4, discovered_at = NOW()`,
      [orgId, ip, deviceCount, JSON.stringify(deviceList)]
    );

    logger.info('Discovery report received', { orgId, count: deviceCount, agentIP: ip });
    res.json({ success: true, received: deviceCount });
  } catch (err) {
    logger.error('Discovery report error', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Enrollment complete — no auth needed (device scans QR) ────────────────
app.post('/api/enrollment/complete', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });
    const data = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (new Date(data.expiresAt) < new Date())
      return res.status(410).json({ success: false, message: 'Enrollment link expired' });
    await db.query(
      `UPDATE devices SET is_active = true, updated_at = NOW() WHERE id = $1`,
      [data.deviceId]
    );
    res.json({ success: true, data: { deviceId: data.deviceId, orgId: data.orgId } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── API Routes ─────────────────────────────────────────────────────────────
// /api/devices MUST be registered after the static routes above
app.use('/api/auth',       authRoutes);
app.use('/api/devices',    authMiddleware, deviceRoutes);
app.use('/api/recordings', authMiddleware, recordingRoutes);
app.use('/api/streams',    authMiddleware, streamRoutes);
app.use('/api/users',      authMiddleware, userRoutes);

// ── Start server ───────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    const dbConnected = await db.testConnection();
    if (!dbConnected) throw new Error('Failed to connect to database');

    const { io, getActiveStreams } = initSignaling(httpServer, corsOrigins);

    // Upload recording clip to Spaces + DB
    const multer = require('multer');
    const { uploadFile } = require('./spacesClient');
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

    app.post('/api/recordings/upload', authMiddleware, upload.single('clip'), async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
        const { deviceId, organizationId, filename, eventId } = req.body;
        const orgId = organizationId || req.user.organizationId;
        const key = `recordings/${orgId}/${deviceId}/${filename || req.file.originalname}`;
        const url = await uploadFile(req.file.buffer, key, req.file.mimetype || 'video/webm');
        try {
          // end_time is NOT NULL — set it to NOW() for uploaded clips
          await db.query(
            `INSERT INTO recordings
               (id, organization_id, device_id, filename, url, size,
                s3_url, start_time, end_time, created_at)
             VALUES
               (gen_random_uuid(), $1, $2, $3, $4, $5, $4, NOW(), NOW(), NOW())`,
            [orgId, deviceId, filename || req.file.originalname, url, req.file.size]
          );
          logger.info('Recording saved to DB', { orgId, deviceId, filename });
        } catch (dbErr) {
          logger.error('DB insert error', { error: dbErr.message });
        }
        res.json({ success: true, url, eventId });
      } catch (err) {
        logger.error('Upload error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // QR Enrollment generate
    app.post('/api/enrollment/generate', authMiddleware, async (req, res) => {
      try {
        const { cameraName, location, expiresIn = 24 } = req.body;
        if (!cameraName) return res.status(400).json({ success: false, message: 'Camera name required' });
        const orgId = req.user.organizationId || req.user.org_id;
        const newDeviceId = require('crypto').randomUUID();
        const streamKey = require('crypto').randomUUID();
        const result = await db.query(
          `INSERT INTO devices (id, user_id, organization_id, name, location, rtsp_url, stream_key, status, is_active, is_motion_detection_enabled, motion_sensitivity, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, '', $6, 'offline', false, true, 50, NOW(), NOW())
           RETURNING id`,
          [newDeviceId, req.user.userId || req.user.id, req.user.organization_id || req.user.org_id, cameraName, location || '', streamKey]
        );
        const createdId = result.rows[0].id;
        const expiresAt = new Date(Date.now() + expiresIn * 3600000).toISOString();
        const token = Buffer.from(JSON.stringify({
          deviceId: createdId, orgId, cameraName, expiresAt
        })).toString('base64url');
        const enrollUrl = `${req.protocol}://${req.get('host')}/enroll?token=${token}`;
        res.json({
          success: true,
          data: { deviceId: createdId, token, url: enrollUrl, cameraName, location: location || '', expiresAt }
        });
      } catch (err) {
        logger.error('Enrollment generate error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // Org Members
    app.get('/api/org/members', authMiddleware, async (req, res) => {
      try {
        const orgId = req.user.organizationId || req.user.org_id;
        const result = await db.query(
          `SELECT id, first_name, last_name, email, role, created_at
           FROM users WHERE organization_id = $1 ORDER BY created_at ASC`,
          [orgId]
        );
        res.json({ success: true, data: result.rows });
      } catch (err) {
        logger.error('Get members error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
      }
    });

    app.put('/api/org/members/:userId/role', authMiddleware, async (req, res) => {
      try {
        const orgId = req.user.organizationId || req.user.org_id;
        const { role } = req.body;
        if (!['admin', 'viewer'].includes(role))
          return res.status(400).json({ success: false, message: 'Invalid role' });
        const MAX_ADMINS = 2;
        if (role === 'admin') {
          const countResult = await db.query(
            `SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'admin'`,
            [orgId]
          );
          if (parseInt(countResult.rows[0].count) >= MAX_ADMINS)
            return res.status(403).json({ success: false, message: `Admin limit of ${MAX_ADMINS} reached` });
        }
        await db.query(
          `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
          [role, req.params.userId, orgId]
        );
        res.json({ success: true, message: `Role updated to ${role}` });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    app.post('/api/org/invite', authMiddleware, async (req, res) => {
      try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email required' });
        const orgId = req.user.organizationId || req.user.org_id;
        const existing = await db.query(
          'SELECT id FROM users WHERE email = $1 AND organization_id = $2',
          [email, orgId]
        );
        if (existing.rows.length > 0)
          return res.status(409).json({ success: false, message: 'User already a member' });
        logger.info('User invited', { email, orgId, invitedBy: req.user.userId });
        res.json({ success: true, message: `Invitation sent to ${email}` });
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // Device discover — needs getActiveStreams closure so stays here
    // Reads from DB discovery_reports so it survives restarts
    app.get('/api/device-discover', authMiddleware, async (req, res) => {
      try {
        const orgId = req.user.organizationId || req.user.org_id;
        const results = [];

        // 1. Devices from DB discovery report
        const reportResult = await db.query(
          `SELECT agent_ip, count, discovered_at, devices
           FROM discovery_reports WHERE org_id = $1
           ORDER BY discovered_at DESC LIMIT 1`,
          [orgId]
        );
        if (reportResult.rows.length > 0) {
          const report = reportResult.rows[0];
          const deviceList = Array.isArray(report.devices) ? report.devices : [];
          deviceList.forEach(d => results.push({
            ...d, source: d.source || 'agent', lastSeen: report.discovered_at,
          }));
        }

        // 2. Active socket streams not yet enrolled
        const enrolled = await db.query(
          `SELECT d.id FROM devices d JOIN users u ON d.user_id = u.id WHERE u.organization_id = $1`,
          [orgId]
        );
        const enrolledIds = new Set(enrolled.rows.map(r => r.id));
        const streams = getActiveStreams();
        streams.filter(s => !enrolledIds.has(s.deviceId)).forEach(s => results.push({
          id: s.socketId, name: s.deviceName, type: 'RSCCamera', source: 'socket', ip: '', mac: '',
        }));

        res.json({ success: true, data: results });
      } catch (err) {
        logger.error('Device discover error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // Active streams
    app.get('/api/streaming/streams', authMiddleware, (req, res) => {
      try {
        res.json({ success: true, data: getActiveStreams() });
      } catch (err) {
        logger.error('Error fetching streams', { error: err.message });
        res.status(500).json({ success: false, message: 'Failed to fetch streams' });
      }
    });

    // 404 handler — MUST be after all routes
    app.use((req, res) => {
      res.status(404).json({ success: false, message: 'Route not found', path: req.path });
    });

    // Error handler — MUST be last
    app.use(errorHandler);

    httpServer.listen(config.PORT, () => {
      logger.info('Server started successfully', {
        port: config.PORT, env: config.NODE_ENV,
        url: `http://localhost:${config.PORT}`, socketio: 'enabled',
      });
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully`);
      httpServer.close(async () => { await db.close(); process.exit(0); });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: String(reason) });
  process.exit(1);
});

startServer();
module.exports = app;
