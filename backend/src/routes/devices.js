// routes/devices.js
// Fixed routes — arm, disarm, activate, pending all added

const express          = require('express');
const router           = express.Router();
const deviceController = require('../controllers/deviceController');
const authMiddleware   = require('../middleware/auth');

// All routes require a valid JWT
router.use(authMiddleware);

// ── Listings ──────────────────────────────────────────────────
// GET  /api/devices           — qr_activated + non-deleted only
router.get('/',            deviceController.getDevices);

// GET  /api/devices/pending   — not yet activated (QR flow / admin)
// IMPORTANT: must be defined BEFORE /:deviceId or Express matches
// the literal string "pending" as a deviceId parameter
router.get('/pending',     deviceController.getPendingDevices);

// ── Single device CRUD ────────────────────────────────────────
// GET    /api/devices/:deviceId
router.get('/:deviceId',          deviceController.getDevice);

// POST   /api/devices             — create (name is auto-generated)
router.post('/',                  deviceController.createDevice);

// PUT    /api/devices/:deviceId   — rename, location, settings
router.put('/:deviceId',          deviceController.updateDevice);

// DELETE /api/devices/:deviceId   — soft delete
router.delete('/:deviceId',       deviceController.deleteDevice);

// ── State changes ─────────────────────────────────────────────
// POST /api/devices/:deviceId/activate  — after QR code scan
router.post('/:deviceId/activate', deviceController.activateDevice);

// POST /api/devices/:deviceId/arm       — "Start & Arm" button
router.post('/:deviceId/arm',      deviceController.armDevice);

// POST /api/devices/:deviceId/disarm    — "Stop & Disarm" button
router.post('/:deviceId/disarm',   deviceController.disarmDevice);

module.exports = router;
