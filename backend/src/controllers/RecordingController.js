const db = require('../utils/database');

exports.getRecordings = async (req, res, next) => {
  try {
    const { device_id, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT r.* FROM recordings r
      JOIN devices d ON r.device_id = d.id
      WHERE d.user_id = $1`;
    const params = [req.user.id];

    if (device_id) { query += ` AND r.device_id = $2`; params.push(device_id); }
    query += ` ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.getRecording = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT r.* FROM recordings r JOIN devices d ON r.device_id = d.id
       WHERE r.id = $1 AND d.user_id = $2`,
      [req.params.recordingId, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Recording not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

exports.deleteRecording = async (req, res, next) => {
  try {
    const result = await db.query(
      `DELETE FROM recordings r USING devices d
       WHERE r.device_id = d.id AND r.id = $1 AND d.user_id = $2 RETURNING r.id`,
      [req.params.recordingId, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Recording not found' });
    res.json({ success: true, message: 'Recording deleted' });
  } catch (err) { next(err); }
};