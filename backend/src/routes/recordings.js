// recordings.js — clip management and cloud upload
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');
const path     = require('path');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const s3 = new S3Client({
  endpoint: process.env.SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com',
  region: process.env.SPACES_REGION || 'nyc3',
  credentials: {
    accessKeyId:     process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
  forcePathStyle: false,
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// GET /api/recordings — list recordings for org
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM recordings WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.user.organizationId]
    );
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.json({ success: true, data: [] });
  }
});

// POST /api/recordings/upload — upload clip to DigitalOcean Spaces
router.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

    const filename  = req.body.filename || `clip_${Date.now()}.webm`;
    const deviceId  = req.body.device_id || 'unknown';
    const orgId     = req.user.organizationId;
    const key       = `recordings/${orgId}/${deviceId}/${filename}`;
    const bucket    = process.env.SPACES_BUCKET || 'real-security-camera';

    // Upload to Spaces
    await s3.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        req.file.buffer,
      ContentType: req.file.mimetype || 'video/webm',
      ACL:         'private',
    }));

    const url = `https://${bucket}.${process.env.SPACES_REGION || 'nyc3'}.digitaloceanspaces.com/${key}`;

    // Save to DB
    try {
      await pool.query(
        `INSERT INTO recordings (organization_id, device_id, filename, url, size, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT DO NOTHING`,
        [orgId, deviceId, filename, url, req.file.size]
      );
    } catch {}

    res.json({ success: true, data: { url, filename, size: req.file.size } });
  } catch (e) {
    console.error('Upload error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/recordings/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM recordings WHERE id = $1 AND organization_id = $2', [req.params.id, req.user.organizationId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
