const fs = require('fs');
const path = require('path');
const config = require('../config');

// Create logs directory if it doesn't exist
const logsDir = path.dirname(config.LOG.file);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const getCurrentLogLevel = () => LOG_LEVELS[config.LOG.level] || LOG_LEVELS.info;

const formatLog = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message} ${metaStr}`.trim();
};

const writeLog = (level, message, meta = {}) => {
  if (LOG_LEVELS[level] > getCurrentLogLevel()) {
    return;
  }

  const logMessage = formatLog(level, message, meta);

  // Console output
  const colors = {
    error: '\x1b[31m', // Red
    warn: '\x1b[33m', // Yellow
    info: '\x1b[36m', // Cyan
    debug: '\x1b[35m', // Magenta
    reset: '\x1b[0m',
  };

  const coloredMessage = `${colors[level]}${logMessage}${colors.reset}`;
  console.log(coloredMessage);

  // File output
  try {
    fs.appendFileSync(config.LOG.file, logMessage + '\n');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
};

const logger = {
  error: (message, meta) => writeLog('error', message, meta),
  warn: (message, meta) => writeLog('warn', message, meta),
  info: (message, meta) => writeLog('info', message, meta),
  debug: (message, meta) => writeLog('debug', message, meta),
};

module.exports = logger;