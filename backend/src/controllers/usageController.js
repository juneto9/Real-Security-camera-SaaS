const db = require('../utils/database');
const logger = require('../utils/logger');

// Plan definitions — single source of truth
const PLANS = {
  free:       { cameras: 2,  ssids: 1,  storage_gb: 5,   liberations_mo: 1,  admins: 1 },
  pro:        { cameras: 10, ssids: 3,  storage_gb: 50,  liberations_mo: 3,  admins: 2 },
  business:   { cameras: 25, ssids: 10, storage_gb: 250, liberations_mo: 10, admins: 5 },
  enterprise: { cameras: 50, ssids: 50, storage_gb: 1024,liberations_mo: null, admins: 10 },
};

/**
 * GET /api/usage
 * Returns live usage counters aggregated from real DB data.
 * The web dashboard Subscription panel reads this to populate
 * Cameras X/Y · SSIDs X/Y · Storage X.XX GB/Y GB · Liberations X/mo / Y/mo
 */
exports.getUsage = async (req, res, next) => {
  try {
    const orgId = req.user.organization_id;
    const userId = req.user.userId || req.user.id;

    // 1. Confirmed cameras (exclude pending_scan)
    const camResult = await db.query(
      `SELECT COUNT(*) FROM devices
       WHERE organization_id = $1
         AND (status IS NULL OR status != 'pending_scan')
         AND (deleted_at IS NULL)`,
      [orgId]
    );
    const cameraCount = parseInt(camResult.rows[0].count, 10);

    // 2. Storage: sum file_size from recordings belonging to this org's devices
    //    file_size is stored in bytes in the DB
    const storageResult = await db.query(
      `SELECT COALESCE(SUM(r.file_size), 0) AS total_bytes
       FROM recordings r
       JOIN devices d ON r.device_id = d.id
       WHERE d.organization_id = $1`,
      [orgId]
    );
    const totalBytes = parseFloat(storageResult.rows[0].total_bytes);
    const storageGb = totalBytes / (1024 ** 3);

    // 3. SSIDs — count distinct WiFi networks/locations registered
    //    We treat distinct non-null 'location' values as SSIDs until a
    //    dedicated ssids table exists.
    const ssidResult = await db.query(
      `SELECT COUNT(DISTINCT location) AS ssid_count
       FROM devices
       WHERE organization_id = $1
         AND location IS NOT NULL
         AND location != ''
         AND (status IS NULL OR status != 'pending_scan')
         AND (deleted_at IS NULL)`,
      [orgId]
    );
    const ssidCount = parseInt(ssidResult.rows[0].ssid_count, 10);

    // 4. Liberations this month — motions events where a recording was
    //    manually saved / exported (recording_type = 'manual' or flagged)
    //    Until liberation tracking is formal, count motion events this calendar month.
    const libResult = await db.query(
      `SELECT COUNT(*) AS lib_count
       FROM motion_events me
       JOIN devices d ON me.device_id = d.id
       WHERE d.organization_id = $1
         AND me.created_at >= date_trunc('month', NOW())`,
      [orgId]
    );
    const liberationCount = parseInt(libResult.rows[0].lib_count, 10);

    // 5. Plan limits — read from organizations table if it exists,
    //    fall back to 'pro' default so the UI always has numbers to show.
    let planName = 'pro';
    try {
      const planResult = await db.query(
        `SELECT plan FROM organizations WHERE id = $1`,
        [orgId]
      );
      if (planResult.rows[0]?.plan) planName = planResult.rows[0].plan;
    } catch (_) {
      // organizations table may not have a plan column yet — keep default
    }

    const limits = PLANS[planName] || PLANS.pro;

    res.json({
      success: true,
      data: {
        plan: planName,
        usage: {
          cameras:     cameraCount,
          ssids:       ssidCount,
          storage_gb:  parseFloat(storageGb.toFixed(4)),
          liberations: liberationCount,
        },
        limits: {
          cameras:          limits.cameras,
          ssids:            limits.ssids,
          storage_gb:       limits.storage_gb,
          liberations_mo:   limits.liberations_mo,   // null = unlimited
          admins:           limits.admins,
        },
      },
    });
  } catch (err) {
    logger.error('Error getting usage', { error: err.message });
    next(err);
  }
};
