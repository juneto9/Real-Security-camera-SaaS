const db = require('../utils/database');
const logger = require('../utils/logger');

exports.getRecordings = async (req, res, next) => {
  try {
    const { device_id, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * parseInt(limit);
    const orgId = req.user.organization_id;

    let queryText = `
      SELECT r.id, r.device_id, r.organization_id,
             r.filename, r.url, r.s3_url, r.size,
             r.start_time, r.end_time, r.created_at,
             r.motion_detected, r.thumbnail_url,
             d.name as camera_name
      FROM recordings r
      LEFT JOIN devices d ON r.device_id = d.id
      WHERE r.organization_id = $1
        AND (r.is_deleted IS NULL OR r.is_deleted = false)`;

    const params = [orgId];

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
    const result = await db.query(
      `SELECT r.* FROM recordings r WHERE r.id = $1 AND r.organization_id = $2`,
      [req.params.recordingId, orgId]
    );
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
    const result = await db.query(
      `DELETE FROM recordings WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [req.params.recordingId, orgId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    logger.error('Error deleting recording', { error: err.message });
    next(err);
  }
};
