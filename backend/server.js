import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import authRoutes from './routes/auth.js';
import cameraRoutes from './routes/cameras.js';
import clipRoutes from './routes/clips.js';
import eventRoutes from './routes/events.js';
import liberationRoutes from './routes/liberation.js';
import orgRoutes from './routes/orgs.js';
import billingRoutes from './routes/billing.js';
import storeRoutes from './routes/store.js';
import entityRoutes from './routes/entities.js';
import adminRoutes from './routes/admin.js';
import subjectRoutes from './routes/subjects.js';
import notificationRoutes from './routes/notifications.js';
import livekitRoutes from './routes/livekit.js';

const app = express();
app.use(cors({ origin: '*', credentials: true }));

// Stripe webhooks MUST receive raw body before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use('/api/store/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use('/stamps', express.static('/opt/rsc-stamps'));

app.get('/health', (req, res) => res.json({ ok: true, service: 'rsc-api', version: '1.0.0' }));

app.use('/api/auth', authRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/clips', clipRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/liberation', liberationRoutes);
app.use('/api/orgs', orgRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/livekit', livekitRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', entityRoutes);

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const clients = new Map();
wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    try {
      const d = JSON.parse(msg);
      if (d.type === 'subscribe' && d.org_id) {
        if (!clients.has(d.org_id)) clients.set(d.org_id, new Set());
        clients.get(d.org_id).add(ws);
        ws.orgId = d.org_id;
      }
    } catch {}
  });
  ws.on('close', () => { if (ws.orgId && clients.has(ws.orgId)) clients.get(ws.orgId).delete(ws); });
});
export function broadcast(orgId, event) {
  if (!clients.has(orgId)) return;
  const msg = JSON.stringify(event);
  for (const ws of clients.get(orgId)) { if (ws.readyState === 1) ws.send(msg); }
}
httpServer.listen(process.env.PORT || 4000, () => console.log('RSC API running on port ' + (process.env.PORT || 4000)));
