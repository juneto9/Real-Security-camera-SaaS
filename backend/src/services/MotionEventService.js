// services/MotionEventService.js
// Fixed: checks is_armed AND qr_activated before creating events or alerting.
// Uses correct schema column names (name, is_armed, qr_activated).

const MotionEventRepository = require('../repositories/MotionEventRepository');
const Device                = require('../models/Device');
const logger                = require('../utils/logger');
const AppError              = require('../utils/AppError');

class MotionEventService {

  // ─────────────────────────────────────────────────────────────
  // CREATE MOTION EVENT
  // Called by motion.js route on every /detect POST.
  // Silently ignores if device is not armed — no toast, no recording.
  // ─────────────────────────────────────────────────────────────
  async createMotionEvent(eventData, organizationId) {
    try {
      const { device_id, confidence, s3_snapshot_url, recording_id } = eventData;

      // Validate confidence score
      if (confidence < 0 || confidence > 100) {
        throw new AppError('Confidence must be between 0 and 100', 400);
      }

      // ── GATE: fetch device and check armed + activated state ──
      const device = await Device.findById(device_id);

      if (!device) {
        logger.warn(`Motion detect: unknown device ${device_id} — ignored`);
        return { id: null, ignored: true, reason: 'device_not_found' };
      }

      if (!device.qr_activated) {
        logger.warn(`Motion detect: device ${device_id} not QR activated — ignored`);
        return { id: null, ignored: true, reason: 'not_activated' };
      }

      if (!device.is_armed) {
        // Silent ignore — this is the NexiGo false-toast fix
        logger.info(
          `Motion detect: device "${device.name}" (${device_id}) is NOT armed — event suppressed`
        );
        return { id: null, ignored: true, reason: 'not_armed' };
      }
      // ── END GATE ──────────────────────────────────────────────

      const eventId = await MotionEventRepository.create({
        device_id,
        organization_id: organizationId,
        confidence,
        s3_snapshot_url,
        recording_id,
      });

      logger.info(
        `Motion event created: ${eventId} | device: "${device.name}" | confidence: ${confidence}%`
      );

      // Alert only on high-confidence events — device is already confirmed armed above
      if (confidence > 80) {
        await this.sendMotionAlert(device_id, device.name, confidence);
      }

      return { id: eventId, confidence };
    } catch (error) {
      logger.error('Error creating motion event:', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET EVENTS FOR A DEVICE
  // ─────────────────────────────────────────────────────────────
  async getDeviceMotionEvents(deviceId, limit = 100, offset = 0) {
    try {
      return await MotionEventRepository.findByDevice(deviceId, limit, offset);
    } catch (error) {
      logger.error('Error getting motion events:', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET EVENTS BY DATE RANGE
  // ─────────────────────────────────────────────────────────────
  async getMotionEventsByDateRange(deviceId, startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end   = new Date(endDate);
      if (start > end) throw new AppError('Start date must be before end date', 400);
      return await MotionEventRepository.findByDateRange(deviceId, start, end);
    } catch (error) {
      logger.error('Error getting motion events by date range:', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SEND ALERT — only ever reached when device IS armed
  // Wire up real push / WebSocket / email here
  // ─────────────────────────────────────────────────────────────
  async sendMotionAlert(deviceId, deviceName, confidence) {
    try {
      logger.info(`🔔 ALERT | "${deviceName}" (${deviceId}) | confidence: ${confidence}%`);
      // TODO Phase 2: push notification / WebSocket broadcast
      // await pushNotificationService.send({ deviceId, deviceName, confidence });
      // await websocketServer.broadcast('motion_alert', { deviceId, deviceName, confidence });
    } catch (error) {
      logger.error('Error sending motion alert:', error);
      // Don't rethrow — alert failure should not break event creation
    }
  }

  // ─────────────────────────────────────────────────────────────
  // MOTION STATS
  // ─────────────────────────────────────────────────────────────
  async getMotionStats(deviceId, days = 7) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const endDate = new Date();

      const events = await MotionEventRepository.findByDateRange(deviceId, startDate, endDate);

      return {
        totalEvents:          events.length,
        averageConfidence:    events.length > 0
          ? (events.reduce((sum, e) => sum + e.confidence, 0) / events.length).toFixed(2)
          : 0,
        highConfidenceEvents: events.filter(e => e.confidence > 80).length,
      };
    } catch (error) {
      logger.error('Error getting motion stats:', error);
      throw error;
    }
  }
}

module.exports = new MotionEventService();
