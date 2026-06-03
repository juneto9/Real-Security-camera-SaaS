const Device = require('../models/Device');
const logger = require('../utils/logger');
const db = require('../utils/database');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /api/devices
 * ?type=webcam   → only USB/webcam devices (for Link to Device dropdown)
 * ?type=camera   → only QR-paired mobile cameras
 * (no type param) → all confirmed devices, no pending_scan
 */
exports.getDevices = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const userId = req.user.userId || req.user.id;
    const orgId = req.user.organization_id;

    let queryText = `
      SELECT id, user_id, organization_id, name, location, device_type,
             rtsp_url, stream_key, status, is_active, last_seen, created_at, updated_at
      FROM devices
      WHERE (user_id = $1 OR organization_id = $2)
        AND (status IS NULL OR status != 'pending_scan')
        AND (deleted_at IS NULL)
    `;
    const params = [userId, orgId];

    if (type) {
      params.push(type);
      queryText += ` AND device_type = $${params.length}`;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), offset);

    const result = await db.query(queryText, params);

    res.json({ success: true, data: result.rows, total: result.rows.length, page, limit });
  } catch (err) {
    logger.error('Error getting devices', { error: err.message });
    next(err);
  }
};

exports.getDevice = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.deviceId, req.user.userId || req.user.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) {
    logger.error('Error getting device', { error: err.message });
    next(err);
  }
};

/**
 * POST /api/devices
 * Creates a device. Pass status: 'pending_scan' for QR pairing flow —
 * device won't appear in the cameras list until the phone scans and
 * calls PATCH /api/devices/:id with status: 'offline'
 */
exports.createDevice = async (req, res, next) => {
  try {
    const name = req.body.name || req.body.device_name;
    const { location, rtsp_url, status, device_type } = req.body;
    const userId = req.user.userId || req.user.id;
    const orgId = req.user.organization_id;

    if (!name || !location) {
      return res.status(400).json({ success: false, message: 'Name and location are required' });
    }

    const deviceId = uuidv4();
    const streamKey = uuidv4();
    const resolvedType = device_type || 'camera';
    const resolvedStatus = status || 'offline';

    const result = await db.query(
      `INSERT INTO devices
         (id, user_id, organization_id, name, location, device_type,
          rtsp_url, stream_key, status, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),NOW())
       RETURNING id, user_id, organization_id, name, location, device_type,
                 rtsp_url, stream_key, status, is_active, created_at`,
      [deviceId, userId, orgId, name, location, resolvedType,
       rtsp_url || '', streamKey, resolvedStatus]
    );

    logger.info('Device created', { deviceId, name, status: resolvedStatus, userId });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error creating device', { error: err.message });
    next(err);
  }
};

/**
 * PATCH /api/devices/:deviceId/confirm
 * Called by the mobile app after scanning the QR code.
 * Promotes device from 'pending_scan' → 'offline' so it appears in the Cameras tab.
 */
exports.confirmDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId || req.user.id;

    const result = await db.query(
      `UPDATE devices
       SET status = 'offline', updated_at = NOW()
       WHERE id = $1 AND status = 'pending_scan'
       RETURNING id, name, status`,
      [deviceId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Pending device not found' });
    }

    logger.info('Device confirmed via QR scan', { deviceId, userId });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error confirming device', { error: err.message });
    next(err);
  }
};

exports.updateDevice = async (req, res, next) => {
  try {
    const device = await Device.update(
      req.params.deviceId,
      req.user.userId || req.user.id,
      req.body
    );
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) {
    logger.error('Error updating device', { error: err.message });
    next(err);
  }
};

exports.deleteDevice = async (req, res, next) => {
  try {
    const deleted = await Device.softDelete(
      req.params.deviceId,
      req.user.userId || req.user.id
    );
    if (!deleted) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) {
    logger.error('Error deleting device', { error: err.message });
    next(err);
  }
};
