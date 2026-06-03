// backend/src/controllers/usagePatch.js
// PATCH /api/users/usage
// Called by web frontend after loadDevices() to sync real counts into users table
// so getBillingStatus() returns accurate numbers.

const { pool } = require('../utils/database');
const logger = require('../utils/logger');

const updateUsage = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user.userId;

    // Always recompute from real data — never trust client-sent numbers
    // 1. Camera count (confirmed devices only, no pending_scan)
    const camResult = await pool.query(
      `SELECT COUNT(*) FROM devices
       WHERE user_id = $1
         AND deleted_at IS NULL`,
      [userId]
    );
    const cameraCount = parseInt(camResult.rows[0].count, 10);

    // 2. SSIDs — distinct non-null locations across confirmed devices
    const ssidResult = await pool.query(
      `SELECT COUNT(DISTINCT location) FROM devices
       WHERE user_id = $1
         AND location IS NOT NULL AND location != ''
         AND deleted_at IS NULL`,
      [userId]
    );
    const ssidCount = parseInt(ssidResult.rows[0].count, 10);

    // 3. Storage — sum file_size bytes from recordings, convert to GB
    const storageResult = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(r.size, r.file_size_bytes, 0)), 0) AS total_bytes
       FROM recordings r
       JOIN devices d ON r.device_id = d.id
       WHERE d.user_id = $1`,
      [userId]
    );
    const storageGb = parseFloat(
      (parseFloat(storageResult.rows[0].total_bytes) / (1024 ** 3)).toFixed(4)
    );

    // 4. Liberations this month — motion events triggered this calendar month
    const libResult = await pool.query(
      `SELECT COUNT(*) FROM motion_events me
       JOIN devices d ON me.device_id = d.id
       WHERE d.user_id = $1
         AND me.created_at >= date_trunc('month', NOW())`,
      [userId]
    );
    const liberationsThisMonth = parseInt(libResult.rows[0].count, 10);

    // Write all computed values back to users table
    await pool.query(
      `UPDATE users
       SET cameras_count              = $1,
           ssids_count                = $2,
           storage_used_gb            = $3,
           liberations_used_this_month = $4,
           updated_at                 = NOW()
       WHERE id = $5`,
      [cameraCount, ssidCount, storageGb, liberationsThisMonth, userId]
    );

    logger.info('Usage synced', { userId, cameraCount, ssidCount, storageGb, liberationsThisMonth });

    res.json({
      success: true,
      data: {
        cameras:              cameraCount,
        ssids:                ssidCount,
        storage_gb:           storageGb,
        liberations_this_month: liberationsThisMonth,
      }
    });
  } catch (err) {
    logger.error('Error updating usage', { error: err.message });
    next(err);
  }
};

module.exports = { updateUsage };
