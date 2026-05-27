const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });
// Load environment variables

const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  API_URL: process.env.API_URL || 'http://localhost:3000',
  WEB_URL: process.env.WEB_URL || 'http://localhost:3001',

  // Database
  DB: {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'security_camera',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: parseInt(process.env.DB_POOL_SIZE || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: false },
},

  // JWT
  JWT: {
    secret: process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this_in_production',
    expiresIn: process.env.JWT_EXPIRE || '7d',
    refreshExpiresIn: '30d',
  },

  // Storage (AWS S3 or DigitalOcean Spaces)
  STORAGE: {
    type: process.env.STORAGE_TYPE || 'spaces', // 'spaces' or 's3'
    endpoint: process.env.STORAGE_ENDPOINT || 'https://nyc3.digitaloceanspaces.com',
    region: process.env.STORAGE_REGION || 'nyc3',
    bucket: process.env.STORAGE_BUCKET || 'security-camera-recordings',
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
    cdnUrl: process.env.STORAGE_CDN_URL || '',
  },

  // WebRTC / TURN Server
  WEBRTC: {
    turnServer: process.env.TURN_SERVER || 'turn:your-turn-server.com:3478',
    turnUsername: process.env.TURN_USERNAME || 'turnuser',
    turnPassword: process.env.TURN_PASSWORD || 'turnpassword',
    stunServer: process.env.STUN_SERVER || 'stun:stun.l.google.com:19302',
  },

  // Email (SendGrid)
  EMAIL: {
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    fromEmail: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
    enabled: !!process.env.SENDGRID_API_KEY,
  },

  // Redis
  REDIS: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // Logging
  LOG: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log',
  },

  // Security
  SECURITY: {
    corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3001,http://localhost:3000').split(','),
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  },

  // Features
  FEATURES: {
    motionDetectionEnabled: process.env.MOTION_DETECTION_ENABLED !== 'false',
    recordingRetentionDays: parseInt(process.env.RECORDING_RETENTION_DAYS || '11', 10),
    motionTriggerDuration: parseInt(process.env.MOTION_TRIGGER_DURATION || '30', 10), // seconds
  },

  // Stripe (Payments)
  STRIPE: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },

  // Analytics
  ANALYTICS: {
    sentryDsn: process.env.SENTRY_DSN,
    googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
  },
};

// Validate required environment variables
const requiredEnvVars = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
];

if (config.NODE_ENV === 'production') {
  requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  });
}

module.exports = config;
