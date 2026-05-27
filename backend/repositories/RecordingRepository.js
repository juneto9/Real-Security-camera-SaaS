// backend/repositories/RecordingRepository.js
const { query, queryOne, insert, update, remove } = require('../database/queries');
const logger = require('../utils/logger');

class RecordingRepository {
  async findById(recordingId) {
    try {
      const sql = `
        SELECT r.*, d.name as device_name 
        FROM recordings r 
        LEFT JOIN devices d ON r.device_id = d.id 
        WHERE r.id = ?
      `;
      return await queryOne(sql, [recordingId]);
    } catch (error) {
      logger.error('Error finding recording by ID:', error);
      throw error;
    }
  }

  async create(recordingData) {
    try {
      const {
        device_id,
        organization_id,
        s3_key,
        s3_url,
        duration,
        file_size,
        recording_type,
        start_time,
        end_time
      } = recordingData;

      const data = {
        device_id,
        organization_id,
        s3_key,
        s3_url,
        duration,
        file_size,
        recording_type: recording_type || 'continuous',
        start_time,
        end_time,
        created_at: new Date()
      };
      return await insert('recordings', data);
    } catch (error) {
      logger.error('Error creating recording:', error);
      throw error;
    }
  }

  async delete(recordingId) {
    try {
      return await remove('recordings', { id: recordingId });
    } catch (error) {
      logger.error('Error deleting recording:', error);
      throw error;
    }
  }

  async findByDevice(deviceId, limit = 50, offset = 0) {
    try {
      const sql = `
        SELECT * FROM recordings 
        WHERE device_id = ? 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `;
      return await query(sql, [deviceId, limit, offset]);
    } catch (error) {
      logger.error('Error finding recordings by device:', error);
      throw error;
    }
  }

  async findByOrganization(organizationId, limit = 100, offset = 0) {
    try {
      const sql = `
        SELECT r.* FROM recordings r 
        WHERE r.organization_id = ? 
        ORDER BY r.created_at DESC 
        LIMIT ? OFFSET ?
      `;
      return await query(sql, [organizationId, limit, offset]);
    } catch (error) {
      logger.error('Error finding recordings by organization:', error);
      throw error;
    }
  }

  async findByDateRange(deviceId, startDate, endDate) {
    try {
      const sql = `
        SELECT * FROM recordings 
        WHERE device_id = ? 
        AND start_time >= ? 
        AND end_time <= ? 
        ORDER BY start_time DESC
      `;
      return await query(sql, [deviceId, startDate, endDate]);
    } catch (error) {
      logger.error('Error finding recordings by date range:', error);
      throw error;
    }
  }

  async findByType(deviceId, recordingType) {
    try {
      const sql = `
        SELECT * FROM recordings 
        WHERE device_id = ? 
        AND recording_type = ? 
        ORDER BY created_at DESC
      `;
      return await query(sql, [deviceId, recordingType]);
    } catch (error) {
      logger.error('Error finding recordings by type:', error);
      throw error;
    }
  }

  async countByDevice(deviceId) {
    try {
      const sql = 'SELECT COUNT(*) as count FROM recordings WHERE device_id = ?';
      const result = await queryOne(sql, [deviceId]);
      return result.count;
    } catch (error) {
      logger.error('Error counting recordings:', error);
      throw error;
    }
  }

  async deleteOldRecordings(organizationId, daysOld) {
    try {
      const sql = `
        DELETE FROM recordings 
        WHERE organization_id = ? 
        AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      `;
      return await query(sql, [organizationId, daysOld]);
    } catch (error) {
      logger.error('Error deleting old recordings:', error);
      throw error;
    }
  }
}

module.exports = new RecordingRepository();