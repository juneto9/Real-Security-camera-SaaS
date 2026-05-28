const db = require('../utils/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class MotionEventRepository {
  async create({ device_id, organization_id, confidence, s3_snapshot_url, recording_id }) {
    try {
      const id = uuidv4();
      await db.query(
        `INSERT INTO motion_events (id, device_id, timestamp, confidence, thumbnail_url, recording_id, created_at)
         VALUES ($1, $2, NOW(), $3, $4, $5, NOW())`,
        [id, device_id, confidence, s3_snapshot_url || null, recording_id || null]
      );
      return id;
    } catch (err) {
      logger.error('MotionEventRepository.create error', { error: err.message });
      throw err;
    }
  }

  async findByDevice(deviceId, limit = 100, offset = 0) {
    try {
      const result = await db.query(
        `SELECT * FROM motion_events WHERE device_id = $1
         ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
        [deviceId, limit, offset]
      );
      return result.rows;
    } catch (err) {
      logger.error('MotionEventRepository.findByDevice error', { error: err.message });
      throw err;
    }
  }

  async findByDateRange(deviceId, startDate, endDate) {
    try {
      const result = await db.query(
        `SELECT * FROM motion_events
         WHERE device_id = $1 AND timestamp BETWEEN $2 AND $3
         ORDER BY timestamp DESC`,
        [deviceId, startDate, endDate]
      );
      return result.rows;
    } catch (err) {
      logger.error('MotionEventRepository.findByDateRange error', { error: err.message });
      throw err;
    }
  }
}

module.exports = new MotionEventRepository();
