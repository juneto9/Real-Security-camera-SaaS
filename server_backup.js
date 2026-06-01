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

// Create HTTP server (required for Socket.io to share the same port)
const httpServer = http.createServer(app);

// Trust proxy (DigitalOcean App Platform sits behind one)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());

// CORS configuration
const corsOrigins = config.SECURITY.corsOrigin;
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
app.use('/api/auth',       authRoutes);
app.use('/api/devices',    authMiddleware, deviceRoutes);
app.use('/api/recordings', authMiddleware, recordingRoutes);
app.use('/api/streams',    authMiddleware, streamRoutes);
app.use('/api/users',      authMiddleware, userRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', path: req.path });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    const dbConnected = await db.testConnection();
    if (!dbConnected) throw new Error('Failed to connect to database');

    // Initialize Socket.io signaling ΓÇö shares same port as Express
    const { io, getActiveStreams } = initSignaling(httpServer, corsOrigins);

    // ΓöÇΓöÇ Upload recording clip to Spaces + DB ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const multer = require('multer');
    const { uploadFile } = require('./spacesClient');
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500*1024*1024 } });

    app.post('/api/recordings/upload', authMiddleware, upload.single('clip'), async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
        const { deviceId, organizationId, filename, eventId } = req.body;
        const orgId = organizationId || req.user.organizationId;
        const key = `recordings/${orgId}/${deviceId}/${filename || req.file.originalname}`;
        const url = await uploadFile(req.file.buffer, key, req.file.mimetype || 'video/webm');
        console.log('Uploaded to Spaces:', url);

        // Insert with start_time to satisfy not-null constraint
        try {
          await db.query(
            `INSERT INTO recordings (organization_id, device_id, filename, url, size, start_time, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [orgId, deviceId, filename || req.file.originalname, url, req.file.size]
          );
        } catch (dbErr) {
          console.error('DB insert error:', dbErr.message, dbErr.code);
          // Retry with end_time too in case schema needs both
          try {
            await db.query(
              `INSERT INTO recordings (organization_id, device_id, filename, url, size, start_time, end_time, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())`,
              [orgId, deviceId, filename || req.file.originalname, url, req.file.size]
            );
            console.log('DB insert retry succeeded');
          } catch (e2) { console.error('DB retry also failed:', e2.message); }
        }

        res.json({ success: true, url, eventId });
      } catch (err) {
        logger.error('Upload error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // ΓöÇΓöÇ QR Enrollment ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    app.post('/api/enrollment/generate', authMiddleware, async (req, res) => {
      try {
        const { cameraName, location, expiresIn = 24 } = req.body;
        if (!cameraName) return res.status(400).json({ success:false, message:'Camera name required' });
        const orgId = req.user.organizationId || req.user.org_id;

        // Create the device in DB
        const result = await db.query(
          `INSERT INTO devices (organization_id, device_name, location, device_type, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, 'mobile', false, NOW(), NOW())
           RETURNING id`,
          [orgId, cameraName, location||'']
        );
        const deviceId = result.rows[0].id;
        const expiresAt = new Date(Date.now() + expiresIn * 3600000).toISOString();

        // Generate enrollment token
        const token = Buffer.from(JSON.stringify({
          deviceId, orgId, cameraName, expiresAt
        })).toString('base64url');

        const enrollUrl = `${req.protocol}://${req.get('host')}/enroll?token=${token}`;

        res.json({
          success: true,
          data: {
            deviceId,
            token,
            url: enrollUrl,
            cameraName,
            location: location||'',
            expiresAt,
          }
        });
      } catch(err) {
        logger.error('Enrollment generate error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
      }
    });

    app.post('/api/enrollment/complete', async (req, res) => {
      try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ success:false, message:'Token required' });
        const data = JSON.parse(Buffer.from(token, 'base64url').toString());
        if (new Date(data.expiresAt) < new Date())
          return res.status(410).json({ success:false, message:'Enrollment link expired' });
        await db.query(
          `UPDATE devices SET is_active = true, updated_at = NOW() WHERE id = $1`,
          [data.deviceId]
        );
        res.json({ success: true, data: { deviceId: data.deviceId, orgId: data.orgId } });
      } catch(err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // ΓöÇΓöÇ Org Members ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    app.get('/api/org/members', authMiddleware, async (req, res) => {
      try {
        const orgId = req.user.organizationId || req.user.org_id;
        const result = await db.query(
          `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.created_at
           FROM users u
           JOIN organizations o ON u.organization_id = o.id
           WHERE o.id = $1
           ORDER BY u.created_at ASC`,
          [orgId]
        );
        res.json({ success: true, data: result.rows });
      } catch(err) {
        logger.error('Get members error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
      }
    });

    app.put('/api/org/members/:userId/role', authMiddleware, async (req, res) => {
      try {
        const orgId = req.user.organizationId || req.user.org_id;
        const { role } = req.body;
        if (!['admin','viewer'].includes(role))
          return res.status(400).json({ success:false, message:'Invalid role' });
        // Check admin limit (max 2 admins)
        // TODO: ENABLE PAYWALL ΓÇö check subscription tier for higher limits
        const MAX_ADMINS = 2;
        if (role === 'admin') {
          const count = await db.query(
            `SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'admin'`,
            [orgId]
          );
          if (parseInt(count.rows[0].count) >= MAX_ADMINS) {
            return res.status(403).json({ success:false, message:`Admin limit of ${MAX_ADMINS} reached` });
          }
        }
        await db.query(
          `UPDATE users SET role = $1 WHERE id = $2 AND organization_id = $3`,
          [role, req.params.userId, orgId]
        );
        res.json({ success: true, message: `Role updated to ${role}` });
      } catch(err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    app.post('/api/org/invite', authMiddleware, async (req, res) => {
      try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success:false, message:'Email required' });
        const orgId = req.user.organizationId || req.user.org_id;
        // Check if already a member
        const existing = await db.query(
          'SELECT id FROM users WHERE email = $1 AND organization_id = $2',
          [email, orgId]
        );
        if (existing.rows.length > 0)
          return res.status(409).json({ success:false, message:'User already a member' });
        // For now just log the invite ΓÇö email sending would go here
        logger.info('User invited', { email, orgId, invitedBy: req.user.userId });
        res.json({ success: true, message: `Invitation sent to ${email}` });
      } catch(err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // ΓöÇΓöÇ Device Discovery ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    app.get('/api/devices/discover', authMiddleware, async (req, res) => {
      try {
        // Returns devices that have been seen via mDNS/Socket.io but not yet enrolled
        // For now returns connected socket devices not in the devices table
        const orgId = req.user.organizationId || req.user.org_id;
        const enrolled = await db.query(
          'SELECT ip_address, mac_address FROM devices WHERE organization_id = $1',
          [orgId]
        );
        const enrolledIPs = new Set(enrolled.rows.map(r=>r.ip_address).filter(Boolean));
        // Return active streams not yet enrolled
        const streams = getActiveStreams();
        const unenrolled = streams.filter(s => !enrolledIPs.has(s.deviceId));
        res.json({ success: true, data: unenrolled.map(s=>({
          id: s.socketId,
          name: s.deviceName,
          type: 'RSCCamera',
          source: 'socket',
          ip: '',
          mac: '',
        }))});
      } catch(err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // Active-streams REST endpoint ΓÇö needs getActiveStreams closure
    app.get('/api/streaming/streams', authMiddleware, (req, res) => {
      try {
        res.json({ success: true, data: getActiveStreams() });
      } catch (err) {
        logger.error('Error fetching streams', { error: err.message });
        res.status(500).json({ success: false, message: 'Failed to fetch streams' });
      }
    });

    httpServer.listen(config.PORT, () => {
      logger.info('Server started successfully', {
        port: config.PORT,
        env: config.NODE_ENV,
        url: `http://localhost:${config.PORT}`,
        socketio: 'enabled',
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
