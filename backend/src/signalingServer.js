/**
 * signalingServer.js
 * ─────────────────────────────────────────────────────────────────────────
 * WebRTC Signaling Server via Socket.io
 *
 * Roles:
 *   camera  – a device (phone, PC webcam via USB tab, any device on LAN/WAN)
 *             that pushes a video stream
 *   viewer  – a browser admin watching one or more streams
 *
 * Flow:
 *   1. Camera connects → emits 'auth' with deviceId + role:'camera'
 *      Server stores socketId → deviceId mapping, emits camera:online to all
 *      viewers in the same org
 *      AUTO-ENROLL: if deviceId not in DB, creates device record automatically
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
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./utils/logger');
const db = require('./utils/database');

// In-memory registry
const orgRooms = new Map();
const socketMeta = new Map();
const deviceSocketMap = new Map();

function getOrCreateRoom(orgId) {
  if (!orgRooms.has(orgId)) {
    orgRooms.set(orgId, { cameras: new Map(), viewers: new Set() });
  }
  return orgRooms.get(orgId);
}

// ── Auto-enroll: insert device into DB if not already there ──────────────
async function autoEnrollDevice({ deviceId, deviceName, orgId, userId }) {
  try {
    // Check if device already exists
    const existing = await db.query(
      `SELECT id FROM devices WHERE id = $1`,
      [deviceId]
    );
    if (existing.rows.length > 0) {
      // Device exists — make sure it's marked active
      await db.query(
        `UPDATE devices SET is_active = true, last_heartbeat = NOW(), updated_at = NOW() WHERE id = $1`,
        [deviceId]
      );
      logger.info('Auto-enroll: device already registered, updated heartbeat', { deviceId });
      return { enrolled: false, deviceId };
    }

    // Device not in DB — auto-register it
    const streamKey = require('crypto').randomUUID();
    await db.query(
      `INSERT INTO devices (id, user_id, device_name, location, device_type, stream_key, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'mobile', $5, true, NOW(), NOW())`,
      [deviceId, userId, deviceName || `Phone Camera`, 'Auto-enrolled via app', streamKey]
    );

    logger.info('Auto-enroll: new device registered', { deviceId, deviceName, orgId, userId });
    return { enrolled: true, deviceId, deviceName };
  } catch (err) {
    logger.error('Auto-enroll error', { error: err.message, deviceId });
    return { enrolled: false, error: err.message };
  }
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

  // ── Auth middleware ────────────────────────────────────────────────────
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

  // ── Connection ─────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    // Intercept ALL incoming packets at the lowest level
    socket.conn.on('packet', (packet) => {
      if (packet.type === 2) {
        try {
          const data = JSON.parse(packet.data);
          logger.info('RAW PACKET', { socketId: socket.id, event: data[0], type: packet.type });
        } catch {}
      }
    });

    // ── auth ──────────────────────────────────────────────────────────────
    socket.on('auth', async (data) => {
      const { role, deviceId, deviceName, organizationId, userId } = data || {};

      const orgId = organizationId
        || socket.jwtPayload?.organizationId
        || socket.jwtPayload?.org_id
        || 'default';

      const resolvedUserId = userId
        || socket.jwtPayload?.userId
        || socket.jwtPayload?.id;

      const meta = {
        role: role || 'viewer',
        deviceId: deviceId || null,
        deviceName: deviceName || 'Unknown',
        organizationId: orgId,
        userId: resolvedUserId,
        socketId: socket.id,
      };

      socketMeta.set(socket.id, meta);
      socket.join(`org:${orgId}`);

      if (role === 'camera' && deviceId) {
        const room = getOrCreateRoom(orgId);
        room.cameras.set(deviceId, socket.id);
        deviceSocketMap.set(deviceId, socket.id);

        // ── AUTO-ENROLL ──────────────────────────────────────────────────
        // Runs async — doesn't block the socket response
        autoEnrollDevice({
          deviceId,
          deviceName: deviceName || 'Phone Camera',
          orgId,
          userId: resolvedUserId,
        }).then(result => {
          if (result.enrolled) {
            // Notify all viewers in org that a NEW device was auto-enrolled
            io.to(`org:${orgId}`).emit('device:enrolled', {
              deviceId,
              deviceName: deviceName || 'Phone Camera',
              source: 'auto',
              message: `${deviceName || 'A phone'} was automatically enrolled`,
            });
            logger.info('Auto-enroll: notified org of new device', { deviceId, orgId });
          }
          // Confirm auth back to the camera
          socket.emit('camera:auth', {
            success: true,
            deviceId,
            enrolled: result.enrolled,
            message: result.enrolled ? 'Auto-enrolled successfully' : 'Device recognized',
          });
        }).catch(err => {
          logger.error('Auto-enroll failed', { error: err.message });
          socket.emit('camera:auth', { success: true, deviceId, enrolled: false });
        });
        // ── END AUTO-ENROLL ──────────────────────────────────────────────

        // Notify all viewers this camera is online
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

    // ── viewer:watch ───────────────────────────────────────────────────────
    socket.on('viewer:watch', ({ deviceId }) => {
      const cameraSocketId = deviceSocketMap.get(deviceId);
      if (!cameraSocketId) {
        socket.emit('stream:error', { deviceId, message: 'Camera not online' });
        logger.warn('viewer:watch — camera not found', { deviceId, viewerSocket: socket.id });
        return;
      }
      logger.info('Viewer requesting stream', {
        deviceId, cameraSocket: cameraSocketId, viewerSocket: socket.id,
      });
      io.to(cameraSocketId).emit('viewer:request', {
        viewerSocketId: socket.id, deviceId,
      });
    });

    // ── WebRTC relay ───────────────────────────────────────────────────────
    socket.on('webrtc:offer', ({ targetSocketId, offer }) => {
      if (!targetSocketId) return;
      io.to(targetSocketId).emit('webrtc:offer', { offer, fromSocketId: socket.id });
    });

    socket.on('webrtc:answer', ({ targetSocketId, answer }) => {
      if (!targetSocketId) return;
      io.to(targetSocketId).emit('webrtc:answer', { answer, fromSocketId: socket.id });
    });

    socket.on('webrtc:ice', ({ targetSocketId, candidate }) => {
      if (!targetSocketId || !candidate) return;
      io.to(targetSocketId).emit('webrtc:ice', { candidate, fromSocketId: socket.id });
    });

    // ── camera:command ─────────────────────────────────────────────────────
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

    // ── motion:detected ────────────────────────────────────────────────────
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

    // ── camera:offline (explicit) ──────────────────────────────────────────
    socket.on('camera:offline', ({ deviceId }) => {
      handleCameraOffline(socket, deviceId || socketMeta.get(socket.id)?.deviceId);
    });

    // ── disconnect ─────────────────────────────────────────────────────────
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

  // ── Helper: handle camera going offline ───────────────────────────────
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

  // ── REST helper: active streams snapshot ──────────────────────────────
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
