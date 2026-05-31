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

    // Initialize Socket.io signaling — shares same port as Express
    const { io, getActiveStreams } = initSignaling(httpServer, corsOrigins);

    // Active-streams REST endpoint — needs getActiveStreams closure
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
