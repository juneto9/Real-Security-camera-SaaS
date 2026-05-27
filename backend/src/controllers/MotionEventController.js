// backend/controllers/MotionEventController.js
const MotionEventService = require('../services/MotionEventService');
const logger = require('../utils/logger');

class MotionEventController {
  async createMotionEvent(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const eventData = req.body;

      const event = await MotionEventService.createMotionEvent(eventData, organizationId);

      res.status(201).json({
        success: true,
        message: 'Motion event created',
        data: event
      });
    } catch (error) {
      next(error);
    }
  }

  async getDeviceMotionEvents(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { limit = 100, offset = 0 } = req.query;

      const events = await MotionEventService.getDeviceMotionEvents(
        deviceId,
        parseInt(limit),
        parseInt(offset)
      );

      res.status(200).json({
        success: true,
        data: events
      });
    } catch (error) {
      next(error);
    }
  }

  async getMotionEventsByDateRange(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { startDate, endDate } = req.query;

      const events = await MotionEventService.getMotionEventsByDateRange(
        deviceId,
        startDate,
        endDate
      );

      res.status(200).json({
        success: true,
        data: events
      });
    } catch (error) {
      next(error);
    }
  }

  async getMotionStats(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { days = 7 } = req.query;

      const stats = await MotionEventService.getMotionStats(deviceId, parseInt(days));

      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new MotionEventController();