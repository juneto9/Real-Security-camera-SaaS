// enrollment.js — QR code camera enrollment system
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');



// POST /api/enrollment/generate — admin generates a QR enrollment token
// Returns a token + URL that a camera device scans to auto-enroll
router.post('/generate', async (req, res) => {
  try {
    const { organizationId, userId } = req.user;
    const { cameraName, location, expiresIn = 24 } = req.body;

    // Generate a short-lived enrollment token
    const enrollToken = crypto.randomBytes(32).toString('hex');
    const expiresAt   = new Date(Date.now() + expiresIn * 60 * 60 * 1000);

    // Store in DB
    await req.app.get('db').query(`
      CREATE TABLE IF NOT EXISTS enrollment_tokens (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        organization_id UUID NOT NULL,
        created_by UUID NOT NULL,
        camera_name TEXT,
        location TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        device_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await req.app.get('db').query(
      `INSERT INTO enrollment_tokens (token, organization_id, created_by, camera_name, location, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [enrollToken, organizationId, userId, cameraName || 'New Camera', location || '', expiresAt]
    );

    // The enrollment URL — camera scans this QR and opens it
    const enrollUrl = `${process.env.APP_URL || 'https://real-security-camera-web-a4yq7.ondigitalocean.app'}/enroll/${enrollToken}`;

    res.json({ success: true, data: { token: enrollToken, url: enrollUrl, expiresAt, expiresIn } });
  } catch(e) {
    console.error('Enrollment generate error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/enrollment/claim/:token — camera device claims the token
// Returns a camera JWT + device info so camera can connect
router.get('/claim/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { deviceName, deviceType = 'mobile' } = req.query;

    const result = await req.app.get('db').query(
      `SELECT * FROM enrollment_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invalid or expired enrollment token' });
    }

    const enrollment = result.rows[0];

    // Create device record
    const finalName = deviceName || enrollment.camera_name || 'Enrolled Camera';
    const devResult = await req.app.get('db').query(
      `INSERT INTO devices (name, location, organization_id, is_active, device_type, created_at)
       VALUES ($1, $2, $3, TRUE, $4, NOW())
       RETURNING id, name, location, organization_id`,
      [finalName, enrollment.location, enrollment.organization_id, deviceType]
    );
    const device = devResult.rows[0];

    // Mark token as used
    await req.app.get('db').query(
      `UPDATE enrollment_tokens SET used = TRUE, device_id = $1 WHERE token = $2`,
      [device.id, token]
    );

    // Issue a camera JWT (long-lived, camera role)
    const cameraToken = jwt.sign({
      deviceId:       device.id,
      deviceName:     finalName,
      organizationId: enrollment.organization_id,
      role:           'camera',
      type:           'device',
    }, process.env.JWT_Secret || process.env.JWT_SECRET, { expiresIn: '365d' });

    res.json({
      success: true,
      data: {
        deviceId:       device.id,
        deviceName:     finalName,
        organizationId: enrollment.organization_id,
        cameraToken,
        apiUrl: process.env.API_URL || 'https://whale-app-hxokg.ondigitalocean.app',
      }
    });
  } catch(e) {
    console.error('Enrollment claim error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/enrollment/list — admin lists active tokens
router.get('/list', async (req, res) => {
  try {
    const result = await req.app.get('db').query(
      `SELECT id, camera_name, location, expires_at, used, device_id, created_at
       FROM enrollment_tokens
       WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.organizationId]
    );
    res.json({ success: true, data: result.rows });
  } catch(e) {
    res.json({ success: true, data: [] });
  }
});

// GET /api/enrollment/admins — get admin devices for org
router.get('/admins', async (req, res) => {
  try {
    const result = await req.app.get('db').query(
      `SELECT id, first_name, last_name, email, role, is_admin
       FROM users WHERE organization_id = $1
       ORDER BY created_at ASC LIMIT 10`,
      [req.user.organizationId]
    );
    res.json({ success: true, data: result.rows });
  } catch(e) {
    res.json({ success: true, data: [] });
  }
});

// POST /api/enrollment/set-admins — set which 2 users are admins
router.post('/set-admins', async (req, res) => {
  try {
    const { adminUserIds } = req.body; // array of 2 user IDs
    if (!adminUserIds || adminUserIds.length > 2) {
      return res.status(400).json({ success: false, message: 'Maximum 2 admin devices allowed' });
    }
    // Reset all to non-admin then set selected
    await req.app.get('db').query(`UPDATE users SET is_admin = FALSE WHERE organization_id = $1`, [req.user.organizationId]);
    for (const uid of adminUserIds) {
      await req.app.get('db').query(`UPDATE users SET is_admin = TRUE WHERE id = $1 AND organization_id = $2`, [uid, req.user.organizationId]);
    }
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
