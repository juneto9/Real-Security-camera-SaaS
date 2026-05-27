// backend/services/MotionEventService.js
const MotionEventRepository = require('../repositories/MotionEventRepository');
const logger = require('../utils/logger');
const AppError = require('../utils/errorHandler');

class MotionEventService {
  async createMotionEvent(eventData, organizationId) {
    try {
      const { device_id, confidence, s3_snapshot_url, recording_id } = eventData;

      // Validate confidence score
      if (confidence < 0 || confidence > 100) {
        throw new AppError('Confidence must be between 0 and 100', 400);
      }

      const eventId = await MotionEventRepository.create({
        device_id,
        organization_id: organizationId,
        confidence,
        s3_snapshot_url,
        recording_id
      });

      logger.info(`Motion event created: ${eventId}`);

      // TODO: Trigger notifications if confidence is high
      if (confidence > 80) {
        await this.sendMotionAlert(device_id, confidence);
      }

      return { id: eventId, confidence };
    } catch (error) {
      logger.error('Error creating motion event:', error);
      throw error;
    }
  }

  async getDeviceMotionEvents(deviceId, limit = 100, offset = 0) {
    try {
      const events = await MotionEventRepository.findByDevice(deviceId, limit, offset);
      return events;
    } catch (error) {
      logger.error('Error getting motion events:', error);
      throw error;
    }
  }

  async getMotionEventsByDateRange(deviceId, startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start > end) {
        throw new AppError('Start date must be before end date', 400);
      }

      const events = await MotionEventRepository.findByDateRange(deviceId, start, end);
      return events;
    } catch (error) {
      logger.error('Error getting motion events by date range:', error);
      throw error;
    }
  }

  async sendMotionAlert(deviceId, confidence) {
    try {
      // TODO: Implement email/push notification
      logger.info(`Motion alert sent for device ${deviceId} with confidence ${confidence}`);
    } catch (error) {
      logger.error('Error sending motion alert:', error);
    }
  }

  async getMotionStats(deviceId, days = 7) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const endDate = new Date();

      const events = await MotionEventRepository.findByDateRange(deviceId, startDate, endDate);

      return {
        totalEvents: events.length,
        averageConfidence: events.length > 0
          ? (events.reduce((sum, e) => sum + e.confidence, 0) / events.length).toFixed(2)
          : 0,
        highConfidenceEvents: events.filter(e => e.confidence > 80).length
      };
    } catch (error) {
      logger.error('Error getting motion stats:', error);
      throw error;
    }
  }
}

module.exports = new MotionEventService();