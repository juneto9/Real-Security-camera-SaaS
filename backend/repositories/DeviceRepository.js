// backend/repositories/DeviceRepository.js
const { query, queryOne, insert, update, remove } = require('../database/queries');
const logger = require('../utils/logger');

class DeviceRepository {
  async findById(deviceId) {
    try {
      const sql = `
        SELECT d.*, o.name as organization_name 
        FROM devices d 
        LEFT JOIN organizations o ON d.organization_id = o.id 
        WHERE d.id = ?
      `;
      return await queryOne(sql, [deviceId]);
    } catch (error) {
      logger.error('Error finding device by ID:', error);
      throw error;
    }
  }

  async findBySerialNumber(serialNumber) {
    try {
      const sql = 'SELECT * FROM devices WHERE serial_number = ?';
      return await queryOne(sql, [serialNumber]);
    } catch (error) {
      logger.error('Error finding device by serial number:', error);
      throw error;
    }
  }

  async create(deviceData) {
    try {
      const {
        name,
        serial_number,
        organization_id,
        location,
        stream_url,
        stream_type,
        username,
        password,
        status
      } = deviceData;

      const data = {
        name,
        serial_number,
        organization_id,
        location,
        stream_url,
        stream_type: stream_type || 'rtsp',
        username,
        password,
        status: status || 'offline',
        created_at: new Date()
      };
      return await insert('devices', data);
    } catch (error) {
      logger.error('Error creating device:', error);
      throw error;
    }
  }

  async update(deviceId, deviceData) {
    try {
      const { name, location, stream_url, username, password, status } = deviceData;
      const data = { name, location, stream_url, username, password, status, updated_at: new Date() };
      await update('devices', data, { id: deviceId });
      return await this.findById(deviceId);
    } catch (error) {
      logger.error('Error updating device:', error);
      throw error;
    }
  }

  async delete(deviceId) {
    try {
      return await remove('devices', { id: deviceId });
    } catch (error) {
      logger.error('Error deleting device:', error);
      throw error;
    }
  }

  async findByOrganization(organizationId) {
    try {
      const sql = 'SELECT * FROM devices WHERE organization_id = ? ORDER BY created_at DESC';
      return await query(sql, [organizationId]);
    } catch (error) {
      logger.error('Error finding devices by organization:', error);
      throw error;
    }
  }

  async updateStatus(deviceId, status) {
    try {
      await update('devices', { status, last_seen: new Date() }, { id: deviceId });
      return true;
    } catch (error) {
      logger.error('Error updating device status:', error);
      throw error;
    }
  }

  async findActiveDevices(organizationId) {
    try {
      const sql = 'SELECT * FROM devices WHERE organization_id = ? AND status = "online"';
      return await query(sql, [organizationId]);
    } catch (error) {
      logger.error('Error finding active devices:', error);
      throw error;
    }
  }
}

module.exports = new DeviceRepository();