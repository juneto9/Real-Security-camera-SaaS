// recordings.js – clip management and cloud upload
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT || 'https://nyc3.digitaloceanspaces.com',
  region:   process.env.STORAGE_REGION   || 'nyc3',
  credentials: {
    accessKeyId:     process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
  },
  forcePathStyle: false,
});

// Helper to get orgId from req.user regardless of field name
const getOrgId = (req) =>
  req.user.organization_id || req.user.organizationId || req.user.org_id || null;

// GET /api/recordings — list recordings for org
router.get('/', async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const db = req.app.get('db');
    const { device_id, limit = 100, offset = 0 } = req.query;

    let query = `SELECT r.id, r.device_id, r.organization_id,
                        r.filename, r.url, r.size, r.created_at,
                        r.start_time, r.end_time, r.motion_detected,
                        d.name as camera_name
                 FROM recordings r
                 LEFT JOIN devices d ON r.device_id = d.id
                 WHERE r.organization_id = $1
                   AND (r.is_deleted IS NULL OR r.is_deleted = false)`;
    const params = [orgId];

    if (device_id) {
      params.push(device_id);
      query += ` AND r.device_id = $${params.length}`;
    }

    query += ` ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    console.error('GET recordings error:', e.message);
    res.json({ success: true, data: [] });
  }
});

// POST /api/recordings/upload — upload clip to DigitalOcean Spaces
router.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

    const filename = req.body.filename || `clip_${Date.now()}.webm`;
    const deviceId = req.body.device_id || null;
    const orgId    = getOrgId(req);
    const bucket   = process.env.STORAGE_BUCKET || 'real-security-camera-recordings';
    const region   = process.env.STORAGE_REGION || 'nyc3';
    const key      = `recordings/${orgId}/${deviceId || 'usb'}/${filename}`;
    const db       = req.app.get('db');

    let url = null;
    try {
      await s3.send(new PutObjectCommand({
        Bucket:      bucket,
        Key:         key,
        Body:        req.file.buffer,
        ContentType: req.file.mimetype || 'video/webm',
        ACL:         'public-read',
      }));
      url = `https://${bucket}.${region}.digitaloceanspaces.com/${key}`;
      console.log('Uploaded to Spaces:', url);
    } catch (spacesErr) {
      console.error('Spaces upload error:', spacesErr.message);
    }

    // Save to DB
    try {
      await db.query(
        `INSERT INTO recordings (organization_id, device_id, filename, url, s3_url, size, start_time, end_time, created_at)
         VALUES ($1, $2, $3, $4, $4, $5, NOW(), NOW(), NOW())`,
        [orgId, deviceId, filename, url, req.file.size]
      );
      console.log('Recording saved to DB');
    } catch (dbErr) {
      console.error('DB insert error:', dbErr.message);
    }

    if (url) {
      res.json({ success: true, data: { url, filename, size: req.file.size } });
    } else {
      res.status(207).json({ success: false, message: 'Spaces upload failed', data: { filename, size: req.file.size } });
    }
  } catch (e) {
    console.error('Upload error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/recordings/:id/url
router.get('/:id/url', async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const db    = req.app.get('db');
    const result = await db.query(
      'SELECT url, filename FROM recordings WHERE id = $1 AND organization_id = $2',
      [req.params.id, orgId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { url: result.rows[0].url } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/recordings/:id
router.delete('/:id', async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const db    = req.app.get('db');
    await db.query(
      'DELETE FROM recordings WHERE id = $1 AND organization_id = $2',
      [req.params.id, orgId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
