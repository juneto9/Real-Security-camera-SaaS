const db = require('../utils/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class Device {
  static async create(userId, deviceName, location, deviceType = 'camera') {
    try {
      const deviceId = uuidv4();
      const streamKey = uuidv4();

      const result = await db.query(
        `INSERT INTO devices (id, user_id, device_name, location, device_type, stream_key, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
         RETURNING id, user_id, device_name, location, device_type, stream_key, is_active, created_at`,
        [deviceId, userId, deviceName, location, deviceType, streamKey]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating device', { error: error.message, userId });
      throw error;
    }
  }

  static async findById(deviceId, userId = null) {
    try {
      let query = 'SELECT * FROM devices WHERE id = $1';
      const params = [deviceId];

      if (userId) {
        query += ' AND user_id = $2';
        params.push(userId);
      }

      const result = await db.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding device', { error: error.message, deviceId });
      throw error;
    }
  }

  static async findByStreamKey(streamKey) {
    try {
      const result = await db.query(
        'SELECT * FROM devices WHERE stream_key = $1',
        [streamKey]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding device by stream key', { error: error.message });
      throw error;
    }
  }

  static async getByUserId(userId, limit = 50, offset = 0) {
    try {
      const result = await db.query(
        `SELECT id, user_id, device_name, location, device_type, is_active, last_seen, created_at, updated_at
         FROM devices
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      const countResult = await db.query(
        'SELECT COUNT(*) FROM devices WHERE user_id = $1',
        [userId]
      );
      const total = parseInt(countResult.rows[0].count, 10);

      return {
        data: result.rows,
        total,
        limit,
        offset,
      };
    } catch (error) {
      logger.error('Error getting user devices', { error: error.message, userId });
      throw error;
    }
  }

  static async update(deviceId, userId, updates) {
    try {
      const allowedFields = ['device_name', 'location', 'is_active', 'motion_sensitivity', 'frame_rate', 'resolution'];
      const fields = [];
      const values = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          fields.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      }

      if (fields.length === 0) {
        return await this.findById(deviceId, userId);
      }

      values.push(deviceId);
      values.push(userId);

      const query = `UPDATE devices SET ${fields.join(', ')}, updated_at = NOW()
                     WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
                     RETURNING *`;

      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating device', { error: error.message, deviceId });
      throw error;
    }
  }

  static async updateLastSeen(deviceId) {
    try {
      const result = await db.query(
        'UPDATE devices SET last_seen = NOW() WHERE id = $1 RETURNING last_seen',
        [deviceId]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error updating last_seen', { error: error.message, deviceId });
      throw error;
    }
  }

  static async delete(deviceId, userId) {
    try {
      const result = await db.query(
        'DELETE FROM devices WHERE id = $1 AND user_id = $2 RETURNING id',
        [deviceId, userId]
      );

      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting device', { error: error.message, deviceId });
      throw error;
    }
  }
}

module.exports = Device;