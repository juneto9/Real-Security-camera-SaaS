// backend/controllers/RecordingController.js
const RecordingService = require('../services/RecordingService');
const logger = require('../utils/logger');

class RecordingController {
  async createRecording(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const recordingData = req.body;

      const recording = await RecordingService.createRecording(recordingData, organizationId);

      res.status(201).json({
        success: true,
        message: 'Recording created successfully',
        data: recording
      });
    } catch (error) {
      next(error);
    }
  }

  async getRecording(req, res, next) {
    try {
      const { recordingId } = req.params;
      const organizationId = req.user.organization_id;

      const recording = await RecordingService.getRecordingById(recordingId, organizationId);

      res.status(200).json({
        success: true,
        data: recording
      });
    } catch (error) {
      next(error);
    }
  }

  async getDeviceRecordings(req, res, next) {
    try {
      const { deviceId } = req.params;
      const organizationId = req.user.organization_id;
      const { limit = 50, offset = 0 } = req.query;

      const recordings = await RecordingService.getDeviceRecordings(
        deviceId,
        organizationId,
        parseInt(limit),
        parseInt(offset)
      );

      res.status(200).json({
        success: true,
        data: recordings
      });
    } catch (error) {
      next(error);
    }
  }

  async getOrganizationRecordings(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const { limit = 100, offset = 0 } = req.query;

      const recordings = await RecordingService.getOrganizationRecordings(
        organizationId,
        parseInt(limit),
        parseInt(offset)
      );

      res.status(200).json({
        success: true,
        data: recordings
      });
    } catch (error) {
      next(error);
    }
  }

  async getRecordingsByDateRange(req, res, next) {
    try {
      const { deviceId } = req.params;
      const organizationId = req.user.organization_id;
      const { startDate, endDate } = req.query;

      const recordings = await RecordingService.getRecordingsByDateRange(
        deviceId,
        startDate,
        endDate,
        organizationId
      );

      res.status(200).json({
        success: true,
        data: recordings
      });
    } catch (error) {
      next(error);
    }
  }

  async getRecordingsByType(req, res, next) {
    try {
      const { deviceId } = req.params;
      const organizationId = req.user.organization_id;
      const { type } = req.query;

      const recordings = await RecordingService.getRecordingsByType(
        deviceId,
        type,
        organizationId
      );

      res.status(200).json({
        success: true,
        data: recordings
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteRecording(req, res, next) {
    try {
      const { recordingId } = req.params;
      const organizationId = req.user.organization_id;

      await RecordingService.deleteRecording(recordingId, organizationId);

      res.status(200).json({
        success: true,
        message: 'Recording deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async getRecordingUrl(req, res, next) {
    try {
      const { recordingId } = req.params;
      const organizationId = req.user.organization_id;
      const { expiresIn = 3600 } = req.query;

      const urlData = await RecordingService.getRecordingUrl(
        recordingId,
        organizationId,
        parseInt(expiresIn)
      );

      res.status(200).json({
        success: true,
        data: urlData
      });
    } catch (error) {
      next(error);
    }
  }

  async cleanupOldRecordings(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const { daysOld = 30 } = req.body;

      await RecordingService.cleanupOldRecordings(organizationId, daysOld);

      res.status(200).json({
        success: true,
        message: 'Old recordings cleaned up'
      });
    } catch (error) {
      next(error);
    }
  }

  async getRecordingStats(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const stats = await RecordingService.getRecordingStats(organizationId);

      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new RecordingController();