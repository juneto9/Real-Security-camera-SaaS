/**
 * signalingServer.js
 * ─────────────────────────────────────────────────────────────────
 * WebRTC Signaling Server via Socket.io
 *
 * Roles:
 *   camera  — a device (phone, PC webcam via USB tab, any device on LAN/WAN)
 *             that pushes a video stream
 *   viewer  — a browser admin watching one or more streams
 *
 * Flow:
 *   1. Camera connects → emits 'auth' with deviceId + role:'camera'
 *      Server stores socketId → deviceId mapping, emits camera:online to all
 *      viewers in the same org
 *
 *   2. Viewer connects → emits 'auth' with role:'viewer'
 *      Server stores viewer socket in org room
 *
 *   3. Viewer wants to watch → emits 'viewer:watch' {deviceId}
 *      Server looks up camera socketId, emits 'viewer:request' to that camera
 *
 *   4. Camera creates WebRTC offer → emits 'webrtc:offer' {targetSocketId, offer}
 *      Server relays to viewer
 *
 *   5. Viewer sends answer → emits 'webrtc:answer' {targetSocketId, answer}
 *      Server relays to camera
 *
 *   6. Both sides exchange ICE → emits 'webrtc:ice' {targetSocketId, candidate}
 *      Server relays to target
 *
 *   7. Peer connection established — media flows P2P (or via TURN)
 *
 * Supports multiple viewers watching the same camera simultaneously.
 * Each viewer gets a dedicated RTCPeerConnection on the camera side.
 *
 * Also handles:
 *   - /api/streaming/streams  REST endpoint (active streams list)
 *   - camera:command          viewer → camera remote control
 *   - motion:detected         camera → all org viewers
 *   - disconnect cleanup
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./utils/logger');

// In-memory registry (survives reconnects within session)
// orgId → { cameras: Map<deviceId, socketId>, viewers: Set<socketId> }
const orgRooms = new Map();

// socketId → { role, deviceId, organizationId, userId, deviceName, socketId }
const socketMeta = new Map();

// deviceId → socketId (quick reverse lookup)
const deviceSocketMap = new Map();

function getOrCreateRoom(orgId) {
  if (!orgRooms.has(orgId)) {
    orgRooms.set(orgId, { cameras: new Map(), viewers: new Set() });
  }
  return orgRooms.get(orgId);
}

function initSignaling(httpServer, corsOrigins) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Auth middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No auth token'));
      const secret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this_in_production';
      const decoded = jwt.verify(token, secret);
      socket.jwtPayload = decoded;
      next();
    } catch (err) {
      logger.warn('Socket auth failed', { error: err.message });
      next(new Error('Invalid token'));
    }
  });

  // ── Connection ───────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    // Intercept ALL incoming packets at the lowest level
    socket.conn.on('packet', (packet) => {
      if (packet.type === 2) { // type 2 = EVENT
        try {
          const data = JSON.parse(packet.data);
          logger.info('RAW PACKET', { socketId: socket.id, event: data[0], type: packet.type });
        } catch {}
      }
    });

    // ── auth ─────────────────────────────────────────────────
    // Sent by both cameras and viewers right after connect
    socket.on('auth', (data) => {
      const { role, deviceId, deviceName, organizationId, userId } = data || {};

      // Use client-provided orgId first (camera sends it explicitly),
      // fall back to JWT, then 'default'
      const orgId = organizationId
        || socket.jwtPayload?.organizationId
        || socket.jwtPayload?.org_id
        || 'default';

      const meta = {
        role: role || 'viewer',
        deviceId: deviceId || null,
        deviceName: deviceName || 'Unknown',
        organizationId: orgId,
        userId: userId || socket.jwtPayload?.userId,
        socketId: socket.id,
      };

      socketMeta.set(socket.id, meta);
      socket.join(`org:${orgId}`);

      if (role === 'camera' && deviceId) {
        const room = getOrCreateRoom(orgId);
        room.cameras.set(deviceId, socket.id);
        deviceSocketMap.set(deviceId, socket.id);

        // Notify all viewers in this org that this camera is online
        socket.to(`org:${orgId}`).emit('camera:online', {
          deviceId,
          deviceName: deviceName || 'Camera',
          socketId: socket.id,
        });

        logger.info('Camera registered', { deviceId, deviceName, orgId, socketId: socket.id });

      } else {
        // viewer
        const room = getOrCreateRoom(orgId);
        room.viewers.add(socket.id);
        logger.info('Viewer registered', { userId: meta.userId, orgId, socketId: socket.id });
      }
    });

    // ── viewer:watch ─────────────────────────────────────────
    // Viewer wants to start watching a specific device
    socket.on('viewer:watch', ({ deviceId }) => {
      const cameraSocketId = deviceSocketMap.get(deviceId);
      if (!cameraSocketId) {
        socket.emit('stream:error', { deviceId, message: 'Camera not online' });
        logger.warn('viewer:watch — camera not found', { deviceId, viewerSocket: socket.id });
        return;
      }

      logger.info('Viewer requesting stream', {
        deviceId,
        cameraSocket: cameraSocketId,
        viewerSocket: socket.id,
      });

      // Tell the camera a viewer wants its stream
      io.to(cameraSocketId).emit('viewer:request', {
        viewerSocketId: socket.id,
        deviceId,
      });
    });

    // ── WebRTC relay ─────────────────────────────────────────
    // All three events are simple point-to-point relays

    socket.on('webrtc:offer', ({ targetSocketId, offer }) => {
      if (!targetSocketId) return;
      io.to(targetSocketId).emit('webrtc:offer', {
        offer,
        fromSocketId: socket.id,
      });
    });

    socket.on('webrtc:answer', ({ targetSocketId, answer }) => {
      if (!targetSocketId) return;
      io.to(targetSocketId).emit('webrtc:answer', {
        answer,
        fromSocketId: socket.id,
      });
    });

    socket.on('webrtc:ice', ({ targetSocketId, candidate }) => {
      if (!targetSocketId || !candidate) return;
      io.to(targetSocketId).emit('webrtc:ice', {
        candidate,
        fromSocketId: socket.id,
      });
    });

    // ── camera:command ───────────────────────────────────────
    // Viewer sends a command to a camera (start, stop, arm, etc.)
    socket.on('camera:command', ({ deviceId, command, params }) => {
      const cameraSocketId = deviceSocketMap.get(deviceId);
      logger.info('camera:command received', {
        deviceId, command,
        cameraSocketId: cameraSocketId || 'NOT FOUND',
        fromSocket: socket.id,
        deviceMapSize: deviceSocketMap.size,
        allDevices: Array.from(deviceSocketMap.keys()),
      });
      if (!cameraSocketId) {
        logger.warn('camera:command — no camera socket for deviceId', { deviceId });
        return;
      }
      io.to(cameraSocketId).emit('camera:command', { command, params, fromSocketId: socket.id });
      logger.info('Camera command relayed', { deviceId, command, cameraSocketId });
    });

    // ── motion:detected ──────────────────────────────────────
    // Camera reports motion — relay to all viewers in org
    socket.on('motion:detected', (data) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      socket.to(`org:${meta.organizationId}`).emit('motion:detected', {
        ...data,
        deviceId: meta.deviceId,
        deviceName: meta.deviceName,
        timestamp: new Date().toISOString(),
      });
    });

    // ── camera:offline (explicit) ─────────────────────────────
    socket.on('camera:offline', ({ deviceId }) => {
      handleCameraOffline(socket, deviceId || socketMeta.get(socket.id)?.deviceId);
    });

    // ── disconnect ───────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;

      logger.info('Socket disconnected', { socketId: socket.id, role: meta.role, reason });

      if (meta.role === 'camera' && meta.deviceId) {
        handleCameraOffline(socket, meta.deviceId);
      } else if (meta.organizationId) {
        const room = orgRooms.get(meta.organizationId);
        if (room) room.viewers.delete(socket.id);
      }

      socketMeta.delete(socket.id);
    });
  });

  // ── Helper: handle camera going offline ─────────────────────
  function handleCameraOffline(socket, deviceId) {
    if (!deviceId) return;
    const meta = socketMeta.get(socket.id);
    const orgId = meta?.organizationId;

    deviceSocketMap.delete(deviceId);

    if (orgId) {
      const room = orgRooms.get(orgId);
      if (room) room.cameras.delete(deviceId);
      socket.to(`org:${orgId}`).emit('camera:offline', { deviceId });
    }

    logger.info('Camera offline', { deviceId, orgId });
  }

  // ── REST helper: active streams snapshot ────────────────────
  // Used by GET /api/streaming/streams
  function getActiveStreams() {
    const streams = [];
    for (const [deviceId, socketId] of deviceSocketMap.entries()) {
      const meta = socketMeta.get(socketId);
      if (meta) {
        streams.push({
          deviceId,
          deviceName: meta.deviceName,
          organizationId: meta.organizationId,
          socketId,
          online: true,
        });
      }
    }
    return streams;
  }

  logger.info('Socket.io signaling server initialized');
  return { io, getActiveStreams };
}

module.exports = { initSignaling };
