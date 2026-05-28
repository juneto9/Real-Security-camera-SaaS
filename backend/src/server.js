const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
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

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());

app.use(cors({
  origin: config.SECURITY.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

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

// Health check - simple and always responsive
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/devices', authMiddleware, deviceRoutes);
app.use('/api/recordings', authMiddleware, recordingRoutes);
app.use('/api/streams', authMiddleware, streamRoutes);
app.use('/api/users', authMiddleware, userRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', path: req.path });
});

app.use(errorHandler);

let dbConnected = false;
let spacesConnected = false;

const connectDatabase = async () => {
  try {
    const connected = await db.testConnection();
    if (connected) {
      dbConnected = true;
      logger.info('Database connected successfully');
    }
  } catch (error) {
    logger.warn('Database connection failed', { error: error.message });
    dbConnected = false;
    // Retry in 5 seconds
    setTimeout(connectDatabase, 5000);
  }
};

const connectSpaces = async () => {
  try {
    const { testConnection: testSpaces } = require('./utils/spacesClient');
    spacesConnected = await testSpaces();
    if (spacesConnected) {
      logger.info('Spaces storage connected successfully');
    } else {
      logger.warn('Spaces storage not connected - video uploads will fail');
      setTimeout(connectSpaces, 5000);
    }
  } catch (error) {
    logger.warn('Spaces connection failed', { error: error.message });
    spacesConnected = false;
    setTimeout(connectSpaces, 5000);
  }
};

const startServer = async () => {
  try {
    // Start server immediately
    const server = app.listen(config.PORT, () => {
      logger.info(`Server started`, {
        port: config.PORT,
        env: config.NODE_ENV,
        url: `http://localhost:${config.PORT}`,
      });
    });

    // Connect to services in background (non-blocking)
    connectDatabase();
    connectSpaces();

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(async () => {
        await db.close();
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received: closing HTTP server');
      server.close(async () => {
        await db.close();
        logger.info('HTTP server closed');
        process.exit(0);
      });
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