// backend/services/DeviceService.js
const DeviceRepository = require('../repositories/DeviceRepository');
const logger = require('../utils/logger');
const AppError = require('../utils/errorHandler');
const crypto = require('crypto');

class DeviceService {
  async registerDevice(deviceData, organizationId) {
    try {
      const { name, stream_url, stream_type, username, password, location } = deviceData;

      // Generate unique serial number
      const serial_number = this.generateSerialNumber();

      // Validate stream URL
      if (!this.isValidStreamUrl(stream_url)) {
        throw new AppError('Invalid stream URL format', 400);
      }

      const deviceId = await DeviceRepository.create({
        name,
        serial_number,
        organization_id: organizationId,
        location,
        stream_url,
        stream_type: stream_type || 'rtsp',
        username,
        password,
        status: 'offline'
      });

      logger.info(`Device registered: ${name} (${serial_number})`);
      return {
        id: deviceId,
        name,
        serial_number,
        status: 'offline'
      };
    } catch (error) {
      logger.error('Error registering device:', error);
      throw error;
    }
  }

  async getDeviceById(deviceId, organizationId) {
    try {
      const device = await DeviceRepository.findById(deviceId);
      if (!device) {
        throw new AppError('Device not found', 404);
      }

      // Verify device belongs to organization
      if (device.organization_id !== organizationId) {
        throw new AppError('Unauthorized access to device', 403);
      }

      return device;
    } catch (error) {
      logger.error('Error getting device:', error);
      throw error;
    }
  }

  async updateDevice(deviceId, deviceData, organizationId) {
    try {
      const device = await DeviceRepository.findById(deviceId);
      if (!device) {
        throw new AppError('Device not found', 404);
      }

      if (device.organization_id !== organizationId) {
        throw new AppError('Unauthorized access to device', 403);
      }

      // Validate stream URL if provided
      if (deviceData.stream_url && !this.isValidStreamUrl(deviceData.stream_url)) {
        throw new AppError('Invalid stream URL format', 400);
      }

      const updatedDevice = await DeviceRepository.update(deviceId, deviceData);
      logger.info(`Device updated: ${deviceId}`);
      return updatedDevice;
    } catch (error) {
      logger.error('Error updating device:', error);
      throw error;
    }
  }

  async deleteDevice(deviceId, organizationId) {
    try {
      const device = await DeviceRepository.findById(deviceId);
      if (!device) {
        throw new AppError('Device not found', 404);
      }

      if (device.organization_id !== organizationId) {
        throw new AppError('Unauthorized access to device', 403);
      }

      await DeviceRepository.delete(deviceId);
      logger.info(`Device deleted: ${deviceId}`);
      return { message: 'Device deleted successfully' };
    } catch (error) {
      logger.error('Error deleting device:', error);
      throw error;
    }
  }

  async getOrganizationDevices(organizationId) {
    try {
      const devices = await DeviceRepository.findByOrganization(organizationId);
      return devices;
    } catch (error) {
      logger.error('Error getting organization devices:', error);
      throw error;
    }
  }

  async getActiveDevices(organizationId) {
    try {
      const devices = await DeviceRepository.findActiveDevices(organizationId);
      return devices;
    } catch (error) {
      logger.error('Error getting active devices:', error);
      throw error;
    }
  }

  async updateDeviceStatus(deviceId, status) {
    try {
      await DeviceRepository.updateStatus(deviceId, status);
      logger.info(`Device status updated: ${deviceId} -> ${status}`);
      return { message: 'Device status updated' };
    } catch (error) {
      logger.error('Error updating device status:', error);
      throw error;
    }
  }

  async testDeviceConnection(deviceId, organizationId) {
    try {
      const device = await this.getDeviceById(deviceId, organizationId);

      // TODO: Implement actual connection test logic
      // This would test RTSP/WebRTC connection
      const isConnected = await this.checkStreamConnection(device);

      if (isConnected) {
        await this.updateDeviceStatus(deviceId, 'online');
      }

      return { connected: isConnected };
    } catch (error) {
      logger.error('Error testing device connection:', error);
      throw error;
    }
  }

  async checkStreamConnection(device) {
    // TODO: Implement actual stream connection check
    return true;
  }

  generateSerialNumber() {
    return `CAM-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  }

  isValidStreamUrl(url) {
    try {
      new URL(url);
      return url.startsWith('rtsp://') || url.startsWith('http://') || url.startsWith('https://');
    } catch (error) {
      return false;
    }
  }
}

module.exports = new DeviceService();