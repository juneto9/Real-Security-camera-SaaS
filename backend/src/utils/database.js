const { Pool } = require('pg');
const config = require('../config');
const logger = require('./logger');

// Create connection pool
const pool = new Pool({
  host: config.DB.host,
  port: config.DB.port,
  database: config.DB.database,
  user: config.DB.user,
  password: config.DB.password,
  max: config.DB.max,
  idleTimeoutMillis: config.DB.idleTimeoutMillis,
  connectionTimeoutMillis: config.DB.connectionTimeoutMillis,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

// Handle pool errors
pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err.message });
});

// Test connection
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    logger.info('Database connection successful', { timestamp: result.rows[0].now });
    return true;
  } catch (error) {
    logger.error('Database connection failed', { error: error.message });
    return false;
  }
};

// Execute query
const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      logger.warn('Slow query detected', { query: text, duration, params });
    }

    return result;
  } catch (error) {
    logger.error('Database query error', {
      error: error.message,
      query: text,
      params,
    });
    throw error;
  }
};

// Execute transaction
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction failed', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

// Close pool
const close = async () => {
  try {
    await pool.end();
    logger.info('Database pool closed');
  } catch (error) {
    logger.error('Error closing database pool', { error: error.message });
  }
};

module.exports = {
  pool,
  query,
  transaction,
  testConnection,
  close,
};