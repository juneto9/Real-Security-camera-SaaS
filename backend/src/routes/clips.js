import multer from 'multer';
import { uploadToSpaces, deleteFromSpaces, getSignedClipUrl } from '../utils/spaces.js';
import path from 'path';
import fs from 'fs';
import { broadcast } from '../server.js';
import { Router } from 'express';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
const router = Router();

// GET — list clips (exclude soft-deleted; ?trash=1 for recycle bin)
router.get('/', requireAuth, async (req, res) => {
  const { camera_id, limit=50, trash } = req.query;
  try {
    let sql = 'SELECT * FROM clips WHERE org_id=$1';
    const p = [req.orgId];
    if (trash === '1') {
      sql += ' AND deleted_at IS NOT NULL';
    } else {
      sql += ' AND deleted_at IS NULL';
    }
    if (camera_id) { p.push(camera_id); sql += ' AND camera_id=$' + p.length; }
    sql += ' ORDER BY created_at DESC LIMIT $' + (p.length + 1);
    p.push(limit);
    res.json(await query(sql, p));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET storage summary
router.get('/storage', requireAuth, async (req, res) => {
  try {
    const [row] = await query(
      'SELECT COALESCE(SUM(file_size_mb),0) as total_mb, COUNT(*) as count FROM clips WHERE org_id=$1 AND deleted_at IS NULL',
      [req.orgId]
    );
    const [trash] = await query(
      'SELECT COALESCE(SUM(file_size_mb),0) as total_mb, COUNT(*) as count FROM clips WHERE org_id=$1 AND deleted_at IS NOT NULL',
      [req.orgId]
    );
    res.json({ active_mb: parseFloat(row.total_mb), active_count: parseInt(row.count), trash_mb: parseFloat(trash.total_mb), trash_count: parseInt(trash.count) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST — create clip record
router.post('/', requireAuth, async (req, res) => {
  const { camera_id, camera_name, file_url, file_size_mb, duration_sec, triggered_by, ai_label } = req.body;
  try {
    const [clip] = await query(
      'INSERT INTO clips (org_id,camera_id,camera_name,file_url,file_size_mb,duration_sec,triggered_by,ai_label) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.orgId, camera_id, camera_name, file_url, file_size_mb, duration_sec||15, triggered_by||'motion', ai_label]
    );
    try { broadcast(req.orgId, { type: 'clip:create', id: clip.id, data: clip }); } catch {}
    res.status(201).json(clip);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PATCH — acknowledge
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const [c] = await query('UPDATE clips SET acknowledged=$3 WHERE id=$1 AND org_id=$2 RETURNING *', [req.params.id, req.orgId, req.body.acknowledged]);
    res.json(c);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE — soft delete (recycle bin, 25 days)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await query('UPDATE clips SET deleted_at=NOW() WHERE id=$1 AND org_id=$2', [req.params.id, req.orgId]);
    res.json({ ok: true, trashed: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /bulk-delete
router.post('/bulk-delete', requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'No ids' });
  try {
    await query('UPDATE clips SET deleted_at=NOW() WHERE id=ANY($1) AND org_id=$2', [ids, req.orgId]);
    res.json({ ok: true, count: ids.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /restore/:id
router.post('/restore/:id', requireAuth, async (req, res) => {
  try {
    await query('UPDATE clips SET deleted_at=NULL WHERE id=$1 AND org_id=$2', [req.params.id, req.orgId]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /purge — hard delete items trashed > 25 days
router.post('/purge', requireAuth, async (req, res) => {
  try {
    const result = await query(
      "DELETE FROM clips WHERE org_id=$1 AND deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '25 days'",
      [req.orgId]
    );
    res.json({ ok: true, purged: result.rowCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// File upload
const uploadDir = '/opt/rsc-uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage: multerStorage, limits: { fileSize: 200 * 1024 * 1024 } });

async function generateThumbnail(videoPath, orgId, videoFilename) {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const thumbFilename = videoFilename.replace(/\.[^.]+$/, '') + '-thumb.jpg';
    const thumbPath = path.join('/opt/rsc-uploads', thumbFilename);
    // Extract frame at 1 second
    await execFileAsync('ffmpeg', [
      '-ss', '1', '-i', videoPath,
      '-vframes', '1', '-q:v', '5',
      '-vf', 'scale=320:-1',
      '-y', thumbPath
    ]);
    // Upload thumbnail to Spaces
    const spacesThumbKey = `clips/${orgId}/thumbs/${thumbFilename}`;
    await uploadToSpaces(thumbPath, spacesThumbKey, 'image/jpeg');
    fs.unlink(thumbPath, () => {});
    return `https://${process.env.SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${spacesThumbKey}`;
  } catch(e) {
    console.error('[thumbnail] generation failed:', e.message);
    return null;
  }
}

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    // Storage enforcement — check plan limit before uploading
    const org = await queryOne('SELECT storage_gb FROM organizations WHERE id=$1', [req.orgId]);
    const storageRow = await queryOne('SELECT COALESCE(SUM(file_size_mb)/1024.0, 0) as gb FROM clips WHERE org_id=$1 AND deleted_at IS NULL', [req.orgId]);
    const usedGb = parseFloat(storageRow?.gb || 0);
    const limitGb = org?.storage_gb || 2;
    if (usedGb >= limitGb) {
      // Hard cap — reject upload
      fs.unlink(req.file.path, () => {});
      return res.status(402).json({
        error: 'Storage limit exceeded',
        used_gb: usedGb.toFixed(2),
        limit_gb: limitGb,
        message: `You've used ${usedGb.toFixed(1)} GB of your ${limitGb} GB limit. Upgrade your plan or delete old clips.`
      });
    }

    const fileUrl = 'https://api.realsecuritycamera.com/api/clips/file/' + req.file.filename;
    const spacesKey = `clips/${req.orgId}/${req.file.filename}`;
    try {
      await uploadToSpaces(req.file.path, spacesKey, req.file.mimetype || 'video/webm');
      const spacesUrl = `https://${process.env.SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${spacesKey}`;
      const fileSizeMb = Math.round((req.file.size / (1024*1024)) * 100) / 100;
      // Generate thumbnail in background — don't block response
      const thumbnailUrl = await generateThumbnail(req.file.path, req.orgId, req.file.filename);
      fs.unlink(req.file.path, () => {});
      res.json({ file_url: spacesUrl, thumbnail_url: thumbnailUrl, filename: req.file.filename, storage: 'spaces', file_size_mb: fileSizeMb });
    } catch(spacesErr) {
      console.error('[spaces] Upload failed, falling back to local:', spacesErr.message);
      const fileSizeMbLocal = Math.round((req.file.size / (1024*1024)) * 100) / 100;
      res.json({ file_url: fileUrl, filename: req.file.filename, storage: 'local', file_size_mb: fileSizeMbLocal });
    }
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/file/:filename', async (req, res) => {
  const fp = path.join('/opt/rsc-uploads', req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(fp);
});


// GET /api/clips/signed/:filename — get signed URL for private Spaces clip
router.get('/signed/:filename', requireAuth, async (req, res) => {
  try {
    const spacesKey = `clips/${req.orgId}/${req.params.filename}`;
    const url = await getSignedClipUrl(spacesKey, 3600);
    res.json({ url, expires_in: 3600 });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/clips/signed-urls — get signed URLs for multiple clips at once
router.post('/signed-urls', requireAuth, async (req, res) => {
  try {
    const { keys } = req.body; // array of Spaces keys or full URLs
    if (!Array.isArray(keys) || keys.length === 0) return res.json({});
    const result = {};
    await Promise.all(keys.map(async (key) => {
      try {
        // Extract key from full URL if needed
        const spacesKey = key.includes('digitaloceanspaces.com')
          ? key.split('.com/')[1]
          : key;
        // Verify org owns this clip
        if (!spacesKey.startsWith('clips/' + req.orgId + '/')) return;
        result[key] = await getSignedClipUrl(spacesKey, 3600);
      } catch(e) {
        console.error('[signed-urls] error for key:', key, e.message);
      }
    }));
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
