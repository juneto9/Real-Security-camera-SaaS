import express from 'express';
import { requireAuth } from '../middleware/auth.js';
const router = express.Router();
const LK_TOKEN_URL = 'https://livekit.realsecuritycamera.com/livekit-token';
const LK_URL = 'wss://livekit.realsecuritycamera.com';
const activeEgress = new Map();
router.post('/token', requireAuth, async (req, res) => {
  try {
    const { identity, room, canPublish = false, canSubscribe = true } = req.body;
    if (!identity || !room) return res.status(400).json({ error: 'identity and room required' });
    const r = await fetch(LK_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity, room, canPublish, canSubscribe }) });
    const data = await r.json();
    res.json({ token: data.token, url: LK_URL });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/egress/start', requireAuth, async (req, res) => {
  const { roomName, deviceId, clipLength = 60, mode = 'security' } = req.body;
  if (deviceId) activeEgress.set(deviceId, { roomName, startedAt: Date.now(), clipLength, mode });
  res.json({ ok: true, egressId: null });
});
router.post('/egress/stop', requireAuth, async (req, res) => {
  activeEgress.delete(req.body?.deviceId);
  res.json({ ok: true });
});
export default router;
