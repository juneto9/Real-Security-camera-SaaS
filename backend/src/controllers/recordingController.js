const db = require('../utils/database');
const logger = require('../utils/logger');

exports.getRecordings = async (req, res, next) => {
  try {
    const { device_id, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * parseInt(limit);
    const orgId = req.user.organization_id;
    const userId = req.user.userId || req.user.id;

    // Try org-based query first (newer schema), fall back to user-based
    let queryText, params;

    if (orgId) {
      queryText = `SELECT r.*, d.device_name as camera_name
                   FROM recordings r
                   LEFT JOIN devices d ON r.device_id = d.id
                   WHERE r.organization_id = $1`;
      params = [orgId];
    } else {
      queryText = `SELECT r.*, d.device_name as camera_name
                   FROM recordings r
                   LEFT JOIN devices d ON r.device_id = d.id
                   WHERE d.user_id = $1`;
      params = [userId];
    }

    if (device_id) {
      params.push(device_id);
      queryText += ` AND r.device_id = $${params.length}`;
    }

    queryText += ` ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), offset);

    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('Error getting recordings', { error: err.message });
    next(err);
  }
};

exports.getRecording = async (req, res, next) => {
  try {
    const orgId = req.user.organization_id;
    const userId = req.user.userId || req.user.id;

    let result;
    if (orgId) {
      result = await db.query(
        `SELECT r.* FROM recordings r WHERE r.id = $1 AND r.organization_id = $2`,
        [req.params.recordingId, orgId]
      );
    } else {
      result = await db.query(
        `SELECT r.* FROM recordings r JOIN devices d ON r.device_id = d.id WHERE r.id = $1 AND d.user_id = $2`,
        [req.params.recordingId, userId]
      );
    }

    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error getting recording', { error: err.message });
    next(err);
  }
};

exports.deleteRecording = async (req, res, next) => {
  try {
    const orgId = req.user.organization_id;
    const userId = req.user.userId || req.user.id;

    let result;
    if (orgId) {
      result = await db.query(
        `DELETE FROM recordings WHERE id = $1 AND organization_id = $2 RETURNING id`,
        [req.params.recordingId, orgId]
      );
    } else {
      result = await db.query(
        `DELETE FROM recordings USING devices
         WHERE recordings.device_id = devices.id
         AND recordings.id = $1 AND devices.user_id = $2
         RETURNING recordings.id`,
        [req.params.recordingId, userId]
      );
    }

    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    logger.error('Error deleting recording', { error: err.message });
    next(err);
  }
};
