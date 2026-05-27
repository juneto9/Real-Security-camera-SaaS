// backend/repositories/MotionEventRepository.js
const { query, queryOne, insert, update } = require('../database/queries');
const logger = require('../utils/logger');

class MotionEventRepository {
  async create(eventData) {
    try {
      const {
        device_id,
        organization_id,
        confidence,
        s3_snapshot_url,
        recording_id
      } = eventData;

      const data = {
        device_id,
        organization_id,
        confidence,
        s3_snapshot_url,
        recording_id,
        created_at: new Date()
      };
      return await insert('motion_events', data);
    } catch (error) {
      logger.error('Error creating motion event:', error);
      throw error;
    }
  }

  async findByDevice(deviceId, limit = 100, offset = 0) {
    try {
      const sql = `
        SELECT * FROM motion_events 
        WHERE device_id = ? 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `;
      return await query(sql, [deviceId, limit, offset]);
    } catch (error) {
      logger.error('Error finding motion events:', error);
      throw error;
    }
  }

  async findByDateRange(deviceId, startDate, endDate) {
    try {
      const sql = `
        SELECT * FROM motion_events 
        WHERE device_id = ? 
        AND created_at >= ? 
        AND created_at <= ? 
        ORDER BY created_at DESC
      `;
      return await query(sql, [deviceId, startDate, endDate]);
    } catch (error) {
      logger.error('Error finding motion events by date range:', error);
      throw error;
    }
  }
}

module.exports = new MotionEventRepository();