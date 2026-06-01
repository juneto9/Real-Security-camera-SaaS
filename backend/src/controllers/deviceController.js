const Device = require('../models/Device');
const logger = require('../utils/logger');
const db = require('../utils/database');

exports.getDevices = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const result = await Device.getByUserId(req.user.userId, parseInt(limit), (page - 1) * limit);
    res.json({ success: true, data: result.data, total: result.total, page, limit });
  } catch (err) {
    logger.error('Error getting devices', { error: err.message });
    next(err);
  }
};

// GET /api/devices/discover
// Returns a flat array combining:
//   1. Agent-discovered devices from discovery_reports table
//   2. Registered devices for this user
// Flat array keeps frontend working exactly as before
exports.discoverDevices = async (req, res, next) => {
  try {
    const orgId = req.user.organization_id || req.user.organizationId || req.user.org_id;
    const userId = req.user.userId;

    const results = [];

    // 1. Pull latest agent discovery report from DB (survives restarts)
    try {
      const reportResult = await db.query(
        `SELECT agent_ip, count, discovered_at, devices
         FROM discovery_reports
         WHERE org_id = $1
         ORDER BY discovered_at DESC
         LIMIT 1`,
        [orgId]
      );
      if (reportResult.rows.length > 0) {
        const report = reportResult.rows[0];
        const deviceList = Array.isArray(report.devices) ? report.devices : [];
        deviceList.forEach(d => results.push({
          ...d,
          source: d.source || 'agent',
          lastSeen: report.discovered_at,
        }));
      }
    } catch (dbErr) {
      // discovery_reports table may not exist yet — don't crash
      logger.warn('Could not read discovery_reports', { error: dbErr.message });
    }

    // 2. Also return registered devices for this user
    const registered = await Device.getByUserId(userId, 50, 0);
    registered.data.forEach(d => results.push({ ...d, source: 'registered' }));

    res.json({ success: true, data: results, total: results.length });
  } catch (err) {
    logger.error('Error discovering devices', { error: err.message });
    next(err);
  }
};

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

exports.createDevice = async (req, res, next) => {
  try {
    const { name, location, rtsp_url } = req.body;
    if (!name || !location) {
      return res.status(400).json({ success: false, message: 'Name and location are required' });
    }
    const device = await Device.create(
      req.user.userId,
      req.user.organization_id,
      name,
      location,
      rtsp_url || ''
    );
    res.status(201).json({ success: true, data: device });
  } catch (err) {
    logger.error('Error creating device', { error: err.message });
    next(err);
  }
};

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
