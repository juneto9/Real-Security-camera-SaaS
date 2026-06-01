/**
 * rtspRelay.js
 * ────────────────────────────────────────────────────────────────
 * Manages WebSocket relay between stream agents (local PC) and
 * viewers (browser/mobile anywhere in the world).
 *
 * Flow:
 *   1. Stream agent connects → registers with orgId
 *   2. Viewer requests stream → backend tells agent via socket
 *   3. Agent starts FFmpeg locally → sends fMP4 chunks to backend
 *   4. Backend relays chunks to viewer
 *   5. Viewer plays via MSE (Media Source Extensions)
 */

const logger = require('./utils/logger');

// orgId → agentSocketId
const orgAgents = new Map();

// deviceId → Set of viewer socketIds
const deviceViewers = new Map();

function initRelay(io) {
  // Use a separate namespace to keep relay traffic isolated
  const relay = io.of('/relay');

  // Auth middleware for relay namespace
  // Agents use JWT token, viewers use JWT token
  // Both must be authenticated
  relay.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No auth token'));
      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this_in_production';
      const decoded = jwt.verify(token, secret);
      socket.jwtPayload = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token: ' + err.message));
    }
  });

  relay.on('connection', (socket) => {
    logger.info('Relay socket connected', { socketId: socket.id });

    // ── Agent registers ──────────────────────────────────────────
    socket.on('agent:register', ({ orgId, role }) => {
      if (role !== 'stream-agent') return;
      orgAgents.set(orgId, socket.id);
      socket.orgId = orgId;
      socket.role  = 'agent';
      socket.join(`agent:${orgId}`);
      logger.info('Stream agent registered', { orgId, socketId: socket.id });

      // Tell agent about any pending viewer requests
      const pending = pendingRequests.get(orgId) || [];
      pending.forEach(req => {
        socket.emit('relay:viewer-wants', req);
      });
      pendingRequests.delete(orgId);
    });

    // ── Viewer requests a stream ─────────────────────────────────
    socket.on('viewer:request-stream', ({ deviceId, orgId }) => {
      socket.deviceId = deviceId;
      socket.orgId    = orgId;
      socket.role     = 'viewer';

      if (!deviceViewers.has(deviceId)) deviceViewers.set(deviceId, new Set());
      deviceViewers.get(deviceId).add(socket.id);

      socket.join(`viewers:${deviceId}`);

      logger.info('Viewer requesting stream', { deviceId, orgId, viewerSocket: socket.id });

      // Find agent for this org
      const agentSocketId = orgAgents.get(orgId);
      if (agentSocketId) {
        relay.to(agentSocketId).emit('relay:viewer-wants', {
          deviceId,
          viewerSocketId: socket.id,
        });
      } else {
        // No agent connected yet — queue request
        if (!pendingRequests.has(orgId)) pendingRequests.set(orgId, []);
        pendingRequests.get(orgId).push({ deviceId, viewerSocketId: socket.id });

        socket.emit('relay:waiting-for-agent', {
          message: 'Stream agent not connected. Make sure stream-agent.js is running on your local network.',
        });
        logger.warn('No agent for org', { orgId });
      }
    });

    // ── Agent sends stream ready confirmation ────────────────────
    socket.on('relay:stream-ready', ({ deviceId, viewerSocketId, mimeType, deviceName }) => {
      relay.to(viewerSocketId).emit('relay:stream-ready', { deviceId, mimeType, deviceName });
      logger.info('Stream ready relayed to viewer', { deviceId, viewerSocketId });
    });

    // ── Agent sends video chunk → relay to all viewers ───────────
    socket.on('relay:stream-chunk', ({ deviceId, chunk, isInit, timestamp }) => {
      // Relay to all viewers watching this device
      relay.to(`viewers:${deviceId}`).emit('relay:stream-chunk', {
        deviceId, chunk, isInit, timestamp,
      });
    });

    // ── Agent reports stream ended ───────────────────────────────
    socket.on('relay:stream-ended', ({ deviceId, viewerSocketId }) => {
      relay.to(viewerSocketId).emit('relay:stream-ended', { deviceId });
    });

    // ── Agent reports stream error ───────────────────────────────
    socket.on('relay:stream-error', ({ deviceId, viewerSocketId, message }) => {
      if (viewerSocketId) {
        relay.to(viewerSocketId).emit('relay:stream-error', { deviceId, message });
      } else {
        relay.to(`viewers:${deviceId}`).emit('relay:stream-error', { deviceId, message });
      }
      logger.error('Stream relay error', { deviceId, message });
    });

    // ── Agent status update ──────────────────────────────────────
    socket.on('agent:status', ({ orgId, activeStreams }) => {
      logger.info('Agent status', { orgId, activeStreams });
    });

    // ── Viewer stops watching ────────────────────────────────────
    socket.on('viewer:stop-stream', ({ deviceId }) => {
      removeViewer(socket, deviceId, relay);
    });

    // ── Disconnect cleanup ───────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.info('Relay socket disconnected', { socketId: socket.id, role: socket.role, reason });

      if (socket.role === 'agent' && socket.orgId) {
        orgAgents.delete(socket.orgId);
        logger.info('Stream agent disconnected', { orgId: socket.orgId });
      } else if (socket.role === 'viewer' && socket.deviceId) {
        removeViewer(socket, socket.deviceId, relay);
      }
    });
  });

  // ── Helper: remove viewer ──────────────────────────────────────
  function removeViewer(socket, deviceId, relay) {
    const viewers = deviceViewers.get(deviceId);
    if (viewers) {
      viewers.delete(socket.id);
      if (viewers.size === 0) deviceViewers.delete(deviceId);
    }

    // Tell agent this viewer left
    if (socket.orgId) {
      const agentSocketId = orgAgents.get(socket.orgId);
      if (agentSocketId) {
        relay.to(agentSocketId).emit('relay:viewer-left', {
          deviceId,
          viewerSocketId: socket.id,
        });
      }
    }
  }

  // Pending viewer requests when no agent is connected yet
  const pendingRequests = new Map();

  logger.info('RTSP relay server initialized on /relay namespace');
  return relay;
}

// ── REST endpoint helpers (called from server.js) ─────────────────
function getAgentStatus(orgId) {
  return {
    connected: orgAgents.has(orgId),
    agentSocketId: orgAgents.get(orgId) || null,
  };
}

module.exports = { initRelay, getAgentStatus };
