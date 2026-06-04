// models/Device.js
// Corrected to match actual DB schema columns:
//   name, status, is_active, rtsp_url, is_motion_detection_enabled,
//   motion_sensitivity, is_recording, last_heartbeat, last_stream_at,
//   ip_address, mac_address, firmware_version, total_storage_used_gb,
//   qr_activated, qr_activated_at, is_armed, armed_at, deleted_at

const db     = require('../utils/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class Device {

  // ─────────────────────────────────────────────────────────────
  // CREATE — name is AUTO-GENERATED from userId + counter
  // No name input needed from the user
  // ─────────────────────────────────────────────────────────────
  static async create(userId, organizationId, location, deviceType = 'camera') {
    try {
      // Count existing non-deleted devices for this user → next number
      const countResult = await db.query(
        `SELECT COUNT(*) FROM devices
         WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      );
      const deviceNumber = parseInt(countResult.rows[0].count, 10) + 1;

      // Auto-name: CAM-{first8charsOfUserId}-{n}  e.g. CAM-A3F9B2C1-1
      const shortId    = userId.replace(/-/g, '').substring(0, 8).toUpperCase();
      const deviceName = `CAM-${shortId}-${deviceNumber}`;

      const deviceId  = uuidv4();
      const streamKey = uuidv4();

      const result = await db.query(
        `INSERT INTO devices
           (id, organization_id, user_id, name, location, device_type,
            stream_key, status, is_active,
            qr_activated, is_armed,
            is_motion_detection_enabled, is_recording,
            created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6,
            $7, 'offline', true,
            false, false,
            false, false,
            NOW(), NOW())
         RETURNING
           id, organization_id, user_id, name, location, device_type,
           stream_key, status, is_active,
           qr_activated, is_armed, created_at`,
        [deviceId, organizationId, userId, deviceName, location, deviceType, streamKey]
      );

      logger.info(`Device created: ${deviceName} for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating device', { error: error.message, userId });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // FIND BY ID — only non-deleted
  // ─────────────────────────────────────────────────────────────
  static async findById(deviceId, userId = null) {
    try {
      let query    = 'SELECT * FROM devices WHERE id = $1 AND deleted_at IS NULL';
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

  // ─────────────────────────────────────────────────────────────
  // FIND BY STREAM KEY — only non-deleted
  // ─────────────────────────────────────────────────────────────
  static async findByStreamKey(streamKey) {
    try {
      const result = await db.query(
        'SELECT * FROM devices WHERE stream_key = $1 AND deleted_at IS NULL',
        [streamKey]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding device by stream key', { error: error.message });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET BY USER — ONLY qr_activated + non-deleted
  // Feeds the Cameras tab and all dashboard cards
  // ─────────────────────────────────────────────────────────────
  static async getByUserId(userId, limit = 50, offset = 0) {
    try {
      const result = await db.query(
        `SELECT
           id, organization_id, user_id, name, description, location,
           device_type, status, is_active, is_armed, qr_activated,
           qr_activated_at, is_motion_detection_enabled, motion_sensitivity,
           is_recording, last_heartbeat, last_stream_at,
           ip_address, mac_address, firmware_version,
           total_storage_used_gb, created_at, updated_at
         FROM devices
         WHERE user_id      = $1
           AND qr_activated = true
           AND deleted_at   IS NULL
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      const countResult = await db.query(
        `SELECT COUNT(*) FROM devices
         WHERE user_id = $1 AND qr_activated = true AND deleted_at IS NULL`,
        [userId]
      );

      return {
        data:   result.rows,
        total:  parseInt(countResult.rows[0].count, 10),
        limit,
        offset,
      };
    } catch (error) {
      logger.error('Error getting user devices', { error: error.message, userId });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET PENDING — not yet QR activated (admin use only)
  // Never shown in Discover tab or any camera card
  // ─────────────────────────────────────────────────────────────
  static async getPendingByUserId(userId) {
    try {
      const result = await db.query(
        `SELECT id, user_id, name, location, device_type, stream_key, created_at
         FROM devices
         WHERE user_id      = $1
           AND qr_activated = false
           AND deleted_at   IS NULL
         ORDER BY created_at DESC`,
        [userId]
      );
      return result.rows;
    } catch (error) {
      logger.error('Error getting pending devices', { error: error.message, userId });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ACTIVATE — called when phone successfully scans its QR code
  // ─────────────────────────────────────────────────────────────
  static async activate(deviceId, userId) {
    try {
      const result = await db.query(
        `UPDATE devices
         SET qr_activated    = true,
             qr_activated_at = NOW(),
             updated_at      = NOW()
         WHERE id           = $1
           AND user_id      = $2
           AND deleted_at   IS NULL
         RETURNING id, name, qr_activated, qr_activated_at`,
        [deviceId, userId]
      );
      if (!result.rows[0]) return null;
      logger.info(`Device QR activated: ${deviceId}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error activating device', { error: error.message, deviceId });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ARM / DISARM — gates whether motion/sound alerts fire
  // ─────────────────────────────────────────────────────────────
  static async setArmed(deviceId, userId, armed) {
    try {
      const result = await db.query(
        `UPDATE devices
         SET is_armed    = $1,
             armed_at    = ${armed ? 'NOW()' : 'NULL'},
             updated_at  = NOW()
         WHERE id           = $2
           AND user_id      = $3
           AND qr_activated = true
           AND deleted_at   IS NULL
         RETURNING id, name, is_armed, armed_at`,
        [armed, deviceId, userId]
      );
      if (!result.rows[0]) return null;
      logger.info(`Device ${armed ? 'ARMED' : 'DISARMED'}: ${deviceId}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error setting armed state', { error: error.message, deviceId });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // UPDATE — rename, change location, toggle motion detection etc.
  // ─────────────────────────────────────────────────────────────
  static async update(deviceId, userId, updates) {
    try {
      const allowedFields = [
        'name',
        'description',
        'location',
        'status',
        'is_active',
        'is_motion_detection_enabled',
        'motion_sensitivity',
        'resolution',
        'fps',
        'bitrate_kbps',
        'codec',
        'ip_address',
        'mac_address',
        'firmware_version',
        'rtsp_url',
        'rtsp_username',
      ];

      const fields = [];
      const values = [];
      let   paramCount = 1;

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

      const query = `
        UPDATE devices
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id         = $${paramCount}
          AND user_id    = $${paramCount + 1}
          AND deleted_at IS NULL
        RETURNING *`;

      const result = await db.query(query, values);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating device', { error: error.message, deviceId });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // UPDATE LAST HEARTBEAT
  // ─────────────────────────────────────────────────────────────
  static async updateLastSeen(deviceId) {
    try {
      const result = await db.query(
        `UPDATE devices
         SET last_heartbeat = NOW(), last_stream_at = NOW()
         WHERE id = $1
         RETURNING last_heartbeat`,
        [deviceId]
      );
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating last_heartbeat', { error: error.message, deviceId });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SOFT DELETE — sets deleted_at; device disappears from all views
  // ─────────────────────────────────────────────────────────────
  static async softDelete(deviceId, userId) {
    try {
      const result = await db.query(
        `UPDATE devices
         SET deleted_at = NOW(),
             updated_at = NOW(),
             is_armed   = false,
             status     = 'offline'
         WHERE id         = $1
           AND user_id    = $2
           AND deleted_at IS NULL
         RETURNING id`,
        [deviceId, userId]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error soft-deleting device', { error: error.message, deviceId });
      throw error;
    }
  }
}

module.exports = Device;
