// recordings.js — clip management and cloud upload
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path     = require('path');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// Reuse app's database pool via app locals or create compatible pool
let _pool = null;
const getPool = () => {
  if (!_pool) {
    const { Pool } = require('pg');
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return _pool;
};

// Log Spaces config on startup (keys masked)
console.log('Spaces config:', {
  endpoint: process.env.STORAGE_ENDPOINT || process.env.SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com',
  region:   process.env.STORAGE_REGION   || process.env.SPACES_REGION   || 'nyc3',
  bucket:   process.env.STORAGE_BUCKET   || process.env.SPACES_BUCKET   || 'real-security-camera',
  hasKey:   !!(process.env.STORAGE_ACCESS_KEY || process.env.SPACES_KEY),
  hasSecret:!!(process.env.STORAGE_SECRET_KEY || process.env.SPACES_SECRET),
});

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT || process.env.SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com',
  region: process.env.STORAGE_REGION || process.env.SPACES_REGION || 'nyc3',
  credentials: {
    accessKeyId:     process.env.STORAGE_ACCESS_KEY || process.env.SPACES_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY || process.env.SPACES_SECRET,
  },
  forcePathStyle: false,
});



// GET /api/recordings — list recordings for org
router.get('/', async (req, res) => {
  try {
    const result = await getPool().query(
      'SELECT * FROM recordings WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.user.organizationId]
    );
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.json({ success: true, data: [] });
  }
});

// Ensure recordings table exists
const ensureTable = async () => {
  try {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS recordings (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        organization_id UUID,
        device_id UUID,
        filename TEXT,
        url TEXT,
        size BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch(e) { console.log('Table create error:', e.message); }
};
ensureTable();

// POST /api/recordings/upload — upload clip to DigitalOcean Spaces
router.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

    const filename  = req.body.filename || `clip_${Date.now()}.webm`;
    const deviceId  = req.body.device_id || null;
    const orgId     = req.user.organizationId;
    const bucket    = process.env.STORAGE_BUCKET || process.env.SPACES_BUCKET || 'real-security-camera';
    const region    = process.env.STORAGE_REGION  || process.env.SPACES_REGION  || 'nyc3';
    const key       = `recordings/${orgId}/${deviceId||'usb'}/${filename}`;

    let url = null;

    // Try Spaces upload — fail gracefully if not configured
    try {
      await s3.send(new PutObjectCommand({
        Bucket:      bucket,
        Key:         key,
        Body:        req.file.buffer,
        ContentType: req.file.mimetype || 'video/webm',
        ACL:         'private',
      }));
      url = `https://${bucket}.${region}.digitaloceanspaces.com/${key}`;
      console.log('Uploaded to Spaces:', url);
    } catch(spacesErr) {
      console.error('Spaces upload error:', spacesErr.message);
      // Still save record with null URL so DB knows about the clip
      url = null;
    }

    // Save to DB regardless of Spaces success
    try {
      await getPool().query(
        `INSERT INTO recordings (organization_id, device_id, filename, url, size, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [orgId, deviceId, filename, url, req.file.size]
      );
    } catch(dbErr) {
      console.error('DB insert error:', dbErr.message, dbErr.code);
      // Try to create table and retry
      try {
        await getPool().query(`CREATE TABLE IF NOT EXISTS recordings (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, organization_id UUID, device_id UUID, filename TEXT, url TEXT, size BIGINT, created_at TIMESTAMPTZ DEFAULT NOW())`);
        await getPool().query(`INSERT INTO recordings (organization_id, device_id, filename, url, size, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`, [orgId, deviceId, filename, url, req.file.size]);
        console.log('DB insert retry succeeded');
      } catch(retryErr) { console.error('DB retry error:', retryErr.message); }
    }

    if (url) {
      res.json({ success: true, data: { url, filename, size: req.file.size } });
    } else {
      res.status(207).json({ success: false, message: 'Spaces upload failed — check STORAGE credentials', data: { filename, size: req.file.size } });
    }
  } catch (e) {
    console.error('Upload error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/recordings/:id
router.delete('/:id', async (req, res) => {
  try {
    await getPool().query('DELETE FROM recordings WHERE id = $1 AND organization_id = $2', [req.params.id, req.user.organizationId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
