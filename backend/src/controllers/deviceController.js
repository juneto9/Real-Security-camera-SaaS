// controllers/deviceController.js
// Uses correct schema: name (not device_name), status (not is_active only)

const Device = require('../models/Device');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────
// GET /api/devices — only qr_activated, non-deleted devices
// ─────────────────────────────────────────────────────────────
exports.getDevices = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const result = await Device.getByUserId(
      req.user.userId,
      parseInt(limit),
      (page - 1) * parseInt(limit)
    );
    res.json({ success: true, data: result.data, total: result.total, page, limit });
  } catch (err) {
    logger.error('Error getting devices', { error: err.message });
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/devices/pending — not yet QR activated (admin only)
// ─────────────────────────────────────────────────────────────
exports.getPendingDevices = async (req, res, next) => {
  try {
    const devices = await Device.getPendingByUserId(req.user.userId);
    res.json({ success: true, data: devices });
  } catch (err) {
    logger.error('Error getting pending devices', { error: err.message });
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/devices/:deviceId
// ─────────────────────────────────────────────────────────────
exports.getDevice = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.deviceId, req.user.userId);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) {
    logger.error('Error getting device', { error: err.message });
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/devices — create; name is AUTO-GENERATED
// Body only needs: location (optional), device_type (optional)
// ─────────────────────────────────────────────────────────────
exports.createDevice = async (req, res, next) => {
  try {
    const { location = 'Unset', device_type = 'camera' } = req.body;

    const device = await Device.create(
      req.user.userId,
      req.user.organization_id,
      location,
      device_type
    );

    res.status(201).json({ success: true, data: device });
  } catch (err) {
    logger.error('Error creating device', { error: err.message });
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/devices/:deviceId/activate — QR scan calls this
// ─────────────────────────────────────────────────────────────
exports.activateDevice = async (req, res, next) => {
  try {
    const device = await Device.activate(req.params.deviceId, req.user.userId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found or already deleted' });
    }
    logger.info(`Device activated: ${req.params.deviceId}`);
    res.json({ success: true, data: device, message: 'Device activated successfully' });
  } catch (err) {
    logger.error('Error activating device', { error: err.message });
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/devices/:deviceId/arm — "Start & Arm" button
// ─────────────────────────────────────────────────────────────
exports.armDevice = async (req, res, next) => {
  try {
    const device = await Device.setArmed(req.params.deviceId, req.user.userId, true);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device, message: 'Device armed — alerts active' });
  } catch (err) {
    logger.error('Error arming device', { error: err.message });
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/devices/:deviceId/disarm — "Stop & Disarm" button
// ─────────────────────────────────────────────────────────────
exports.disarmDevice = async (req, res, next) => {
  try {
    const device = await Device.setArmed(req.params.deviceId, req.user.userId, false);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device, message: 'Device disarmed — alerts off' });
  } catch (err) {
    logger.error('Error disarming device', { error: err.message });
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /api/devices/:deviceId — rename, location, settings
// ─────────────────────────────────────────────────────────────
exports.updateDevice = async (req, res, next) => {
  try {
    const device = await Device.update(req.params.deviceId, req.user.userId, req.body);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) {
    logger.error('Error updating device', { error: err.message });
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/devices/:deviceId — soft delete only
// ─────────────────────────────────────────────────────────────
exports.deleteDevice = async (req, res, next) => {
  try {
    const deleted = await Device.softDelete(req.params.deviceId, req.user.userId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) {
    logger.error('Error deleting device', { error: err.message });
    next(err);
  }
};
