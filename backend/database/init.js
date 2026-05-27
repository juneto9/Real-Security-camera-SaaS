// db/init.js
const pool = require('./pool');
const logger = require('../utils/logger');

const initializeDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    logger.info('Database connected successfully');
    connection.release();
  } catch (error) {
    logger.error('Database initialization failed:', error);
    process.exit(1);
  }
};

module.exports = { initializeDatabase };