const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./utils/database');
const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const recordingRoutes = require('./routes/recordings');
const streamRoutes = require('./routes/streams');
const userRoutes = require('./routes/users');
const setupSocket = require('./socket');
const streamingRoutes  = require('./routes/streaming');
const enrollmentRoutes = require('./routes/enrollment');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });
app.set('io', io);
app.set('activeStreams', {});

// ── CORS must come FIRST before any routes ───────────────────────
app.options('*', cors());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://real-security-camera-web-a4yq7.ondigitalocean.app',
  ],
  credentials: true,
}));

// ── Then other middleware ────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ── Routes (all AFTER cors) ──────────────────────────────────────
// Ensure tables exist on startup — using DATABASE_URL directly
setTimeout(async () => {
  const { Pool: StartupPool } = require('pg');
  const sp = new StartupPool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await sp.query(`CREATE TABLE IF NOT EXISTS recordings (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      organization_id UUID, device_id UUID, filename TEXT,
      url TEXT, size BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await sp.query(`CREATE TABLE IF NOT EXISTS enrollment_tokens (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      token TEXT UNIQUE NOT NULL, organization_id UUID NOT NULL,
      created_by UUID NOT NULL, camera_name TEXT, location TEXT,
      expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN DEFAULT FALSE,
      device_id UUID, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log('Tables ready');
  } catch(e) { console.log('Table init error:', e.message); }
  sp.end();
}, 3000);

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/recordings', authMiddleware, recordingRoutes);
app.use('/api/streams', authMiddleware, streamRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/streaming',  streamingRoutes);
app.use('/api/enrollment', authMiddleware, enrollmentRoutes);

// ── Socket.io signaling ──────────────────────────────────────────
setupSocket(io, app);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', path: req.path });
});
app.use(errorHandler);

// ── DB + Spaces ──────────────────────────────────────────────────
const connectDatabase = async () => {
  try {
    const connected = await db.testConnection();
    if (connected) { logger.info('Database connected successfully'); }
  } catch (error) {
    logger.warn('Database connection failed', { error: error.message });
    setTimeout(connectDatabase, 5000);
  }
};

const connectSpaces = async () => {
  try {
    const { testConnection: testSpaces } = require('./utils/spacesClient');
    const ok = await testSpaces();
    if (ok) { logger.info('Spaces storage connected successfully'); }
    else { setTimeout(connectSpaces, 5000); }
  } catch (error) {
    logger.warn('Spaces connection failed', { error: error.message });
    setTimeout(connectSpaces, 5000);
  }
};

// ── Start ────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    server.listen(config.PORT, () => {
      logger.info('Server started', {
        port: config.PORT,
        env: config.NODE_ENV,
        url: `http://localhost:${config.PORT}`,
      });
    });
    connectDatabase();
    connectSpaces();

    process.on('SIGTERM', async () => {
      server.close(async () => { await db.close(); process.exit(0); });
    });
    process.on('SIGINT', async () => {
      server.close(async () => { await db.close(); process.exit(0); });
    });
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
  logger.error('Unhandled Rejection', { reason });
  process.exit(1);
});

startServer();
module.exports = app;
