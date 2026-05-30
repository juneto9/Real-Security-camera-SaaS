// socket.js — WebRTC signaling server via Socket.io
// Handles peer-to-peer WebRTC negotiation between cameras and viewers

const logger = require('./utils/logger');

module.exports = function setupSocket(io, app) {
  // Track connected sockets: socketId -> { userId, orgId, deviceId, role }
  const connections = new Map();

  io.on('connection', (socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    // ── Auth ──────────────────────────────────────────────────────
    socket.on('auth', ({ token, deviceId, deviceName, role, organizationId, userId }) => {
      // Store connection info
      connections.set(socket.id, { userId, organizationId, deviceId, deviceName, role, socketId: socket.id });

      // Join org room so cameras and viewers in same org can find each other
      socket.join(`org:${organizationId}`);

      // If this is a camera, join its device room and mark online
      if (role === 'camera' && deviceId) {
        socket.join(`device:${deviceId}`);
        const activeStreams = app.get('activeStreams') || {};
        if (activeStreams[deviceId]) {
          activeStreams[deviceId].online = true;
          activeStreams[deviceId].socketId = socket.id;
          app.set('activeStreams', activeStreams);
        } else {
          // Auto-register if not already registered
          const streams = activeStreams;
          streams[deviceId] = { deviceId, deviceName, organizationId, userId, online: true, socketId: socket.id, streamType: 'camera', registeredAt: new Date().toISOString() };
          app.set('activeStreams', streams);
        }
        // Notify org that camera came online
        socket.to(`org:${organizationId}`).emit('camera:online', { deviceId, deviceName });
        logger.info('Camera online', { deviceId, deviceName });
      }

      socket.emit('auth:ok', { socketId: socket.id });
      logger.info('Socket authed', { role, deviceId, organizationId });
    });

    // ── WebRTC: Viewer requests to watch a camera ─────────────────
    // Viewer → Server → Camera
    socket.on('viewer:watch', ({ deviceId }) => {
      const conn = connections.get(socket.id);
      if (!conn) return;
      const activeStreams = app.get('activeStreams') || {};
      const stream = activeStreams[deviceId];
      if (!stream || !stream.online) {
        socket.emit('error', { message: 'Camera is offline' });
        return;
      }
      // Tell camera that a viewer wants to connect
      // Include viewer's socketId so camera can send offer back
      io.to(stream.socketId).emit('viewer:request', {
        viewerSocketId: socket.id,
        viewerOrgId: conn.organizationId,
      });
      logger.info('Viewer requesting stream', { deviceId, viewerSocketId: socket.id });
    });

    // ── WebRTC Signaling ──────────────────────────────────────────
    // Camera sends SDP offer to a specific viewer
    socket.on('webrtc:offer', ({ targetSocketId, offer }) => {
      io.to(targetSocketId).emit('webrtc:offer', {
        offer,
        fromSocketId: socket.id,
      });
    });

    // Viewer sends SDP answer back to camera
    socket.on('webrtc:answer', ({ targetSocketId, answer }) => {
      io.to(targetSocketId).emit('webrtc:answer', {
        answer,
        fromSocketId: socket.id,
      });
    });

    // ICE candidate exchange (both directions)
    socket.on('webrtc:ice', ({ targetSocketId, candidate }) => {
      io.to(targetSocketId).emit('webrtc:ice', {
        candidate,
        fromSocketId: socket.id,
      });
    });

    // ── Camera goes offline ───────────────────────────────────────
    socket.on('camera:offline', ({ deviceId }) => {
      const activeStreams = app.get('activeStreams') || {};
      if (activeStreams[deviceId]) {
        activeStreams[deviceId].online = false;
        app.set('activeStreams', activeStreams);
      }
      const conn = connections.get(socket.id);
      if (conn) socket.to(`org:${conn.organizationId}`).emit('camera:offline', { deviceId });
    });

    // ── Chat / Admin messages within org ─────────────────────────
    socket.on('admin:message', ({ message }) => {
      const conn = connections.get(socket.id);
      if (!conn) return;
      io.to(`org:${conn.organizationId}`).emit('admin:message', {
        message, from: conn.deviceName || 'Admin', timestamp: new Date().toISOString()
      });
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const conn = connections.get(socket.id);
      if (conn) {
        if (conn.role === 'camera' && conn.deviceId) {
          const activeStreams = app.get('activeStreams') || {};
          if (activeStreams[conn.deviceId]) {
            activeStreams[conn.deviceId].online = false;
            app.set('activeStreams', activeStreams);
          }
          socket.to(`org:${conn.organizationId}`).emit('camera:offline', { deviceId: conn.deviceId });
          logger.info('Camera offline', { deviceId: conn.deviceId });
        }
        connections.delete(socket.id);
      }
      logger.info('Socket disconnected', { socketId: socket.id });
    });
  });

  logger.info('Socket.io signaling server ready');
};
