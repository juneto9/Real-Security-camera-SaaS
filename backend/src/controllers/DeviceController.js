// backend/controllers/DeviceController.js
const DeviceService = require('../services/DeviceService');
const logger = require('../utils/logger');

class DeviceController {
  async registerDevice(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const { name, stream_url, stream_type, username, password, location } = req.body;

      const device = await DeviceService.registerDevice(
        { name, stream_url, stream_type, username, password, location },
        organizationId
      );

      res.status(201).json({
        success: true,
        message: 'Device registered successfully',
        data: device
      });
    } catch (error) {
      next(error);
    }
  }

  async getDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      const organizationId = req.user.organization_id;

      const device = await DeviceService.getDeviceById(deviceId, organizationId);

      res.status(200).json({
        success: true,
        data: device
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      const organizationId = req.user.organization_id;
      const updateData = req.body;

      const device = await DeviceService.updateDevice(deviceId, updateData, organizationId);

      res.status(200).json({
        success: true,
        message: 'Device updated successfully',
        data: device
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      const organizationId = req.user.organization_id;

      await DeviceService.deleteDevice(deviceId, organizationId);

      res.status(200).json({
        success: true,
        message: 'Device deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async getOrganizationDevices(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const devices = await DeviceService.getOrganizationDevices(organizationId);

      res.status(200).json({
        success: true,
        data: devices
      });
    } catch (error) {
      next(error);
    }
  }

  async getActiveDevices(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const devices = await DeviceService.getActiveDevices(organizationId);

      res.status(200).json({
        success: true,
        data: devices
      });
    } catch (error) {
      next(error);
    }
  }

  async testConnection(req, res, next) {
    try {
      const { deviceId } = req.params;
      const organizationId = req.user.organization_id;

      const result = await DeviceService.testDeviceConnection(deviceId, organizationId);

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DeviceController();