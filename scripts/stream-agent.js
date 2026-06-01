/**
 * Real Security Camera — Stream Relay Agent
 * ──────────────────────────────────────────
 * Runs on your LOCAL network alongside the discovery agent.
 * Pulls RTSP streams from local IP cameras and relays them
 * to the backend via WebSocket so viewers anywhere can watch.
 *
 * Install: npm install axios socket.io-client
 * Run:     node stream-agent.js
 * Or:      RSC_EMAIL=x RSC_PASSWORD=y node stream-agent.js
 *
 * How it works:
 *   1. Logs into backend, gets token + orgId
 *   2. Fetches enrolled devices with RTSP URLs
 *   3. For each device, spawns FFmpeg to pull RTSP locally
 *   4. FFmpeg outputs raw H264 frames via stdout pipe
 *   5. Agent chunks frames and sends to backend via Socket.io
 *   6. Backend relays chunks to any viewer watching that device
 *   7. Browser reassembles chunks and plays via MSE (Media Source Extensions)
 */

const { spawn }  = require('child_process');
// Use @ffmpeg-installer/ffmpeg if system ffmpeg not available
let FFMPEG_PATH = 'ffmpeg';
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  FFMPEG_PATH = ffmpegInstaller.path;
  console.log('  Using bundled FFmpeg:', FFMPEG_PATH);
} catch(e) {
  console.log('  Using system FFmpeg');
}
const axios      = require('axios');
const { io }     = require('socket.io-client');
const os         = require('os');

const API_URL    = 'https://whale-app-hxokg.ondigitalocean.app';
const EMAIL      = process.env.RSC_EMAIL    || 'newtest@example.com';
const PASSWORD   = process.env.RSC_PASSWORD || 'TestPassword123!';
const CHUNK_SIZE = 65536; // 64KB chunks

let token   = process.env.RSC_TOKEN  || '';
let orgId   = process.env.RSC_ORG_ID || '';
let socket  = null;

// Active streams: deviceId → { ffmpeg, viewers: Set }
const activeStreams = new Map();

// ── Auth ──────────────────────────────────────────────────────────
async function authenticate() {
  try {
    const res = await axios.post(`${API_URL}/api/auth/login`, { email: EMAIL, password: PASSWORD });
    token = res.data.data.accessToken;
    orgId = res.data.data.user.organization_id || res.data.data.user.org_id;
    console.log('✅ Authenticated | orgId:', orgId);
    return true;
  } catch (e) {
    console.error('❌ Auth failed:', e.response?.data?.message || e.message);
    return false;
  }
}

// ── Connect to backend relay socket ──────────────────────────────
function connectSocket() {
  return new Promise((resolve, reject) => {
    console.log('🔌 Connecting to relay server...');

    socket = io(API_URL + '/relay', {
      auth: { token },  // token set after authenticate()
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 3000,
    });

    socket.on('connect', () => {
      console.log('✅ Connected to relay server');
      // Register as a stream agent
      socket.emit('agent:register', { orgId, role: 'stream-agent' });
      resolve(socket);
    });

    socket.on('connect_error', (err) => {
      console.error('❌ Socket connection error:', err.message);
      reject(err);
    });

    // Backend tells agent a viewer wants to watch a device
    socket.on('relay:viewer-wants', ({ deviceId, viewerSocketId }) => {
      console.log(`👁  Viewer ${viewerSocketId} wants stream for device ${deviceId}`);
      startStreamForDevice(deviceId, viewerSocketId);
    });

    // Backend tells agent viewer stopped watching
    socket.on('relay:viewer-left', ({ deviceId, viewerSocketId }) => {
      console.log(`👋 Viewer ${viewerSocketId} left device ${deviceId}`);
      removeViewer(deviceId, viewerSocketId);
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Disconnected from relay server:', reason);
      // Stop all streams on disconnect
      for (const [deviceId] of activeStreams) {
        stopStream(deviceId);
      }
    });

    socket.on('reconnect', () => {
      console.log('🔄 Reconnected — re-registering agent');
      socket.emit('agent:register', { orgId, role: 'stream-agent' });
    });
  });
}

// ── Fetch devices with RTSP URLs ─────────────────────────────────
async function getDevicesWithRTSP() {
  try {
    const res = await axios.get(`${API_URL}/api/devices`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return (res.data.data || []).filter(d => d.rtsp_url && d.rtsp_url.startsWith('rtsp://'));
  } catch (e) {
    console.error('❌ Failed to fetch devices:', e.message);
    return [];
  }
}

// ── Start FFmpeg stream for a device ─────────────────────────────
async function startStreamForDevice(deviceId, viewerSocketId) {
  // If stream already running, just add this viewer
  if (activeStreams.has(deviceId)) {
    const stream = activeStreams.get(deviceId);
    stream.viewers.add(viewerSocketId);
    console.log(`  ➕ Added viewer to existing stream for ${deviceId} (${stream.viewers.size} viewers)`);
    // Send stream info to new viewer
    socket.emit('relay:stream-ready', {
      deviceId,
      viewerSocketId,
      mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    });
    return;
  }

  // Look up RTSP URL for this device
  const devices = await getDevicesWithRTSP();
  const device = devices.find(d => d.id === deviceId);

  if (!device) {
    console.error(`  ❌ No RTSP URL for device ${deviceId}`);
    socket.emit('relay:stream-error', {
      deviceId, viewerSocketId,
      message: 'No RTSP URL configured for this camera'
    });
    return;
  }

  console.log(`  🎥 Starting FFmpeg for ${device.name} → ${device.rtsp_url.replace(/:([^:@]+)@/, ':***@')}`);

  const viewers = new Set([viewerSocketId]);
  activeStreams.set(deviceId, { viewers, ffmpeg: null, deviceName: device.name });

  // FFmpeg: RTSP → fragmented MP4 (fMP4) for MSE streaming
  const ffmpeg = spawn(FFMPEG_PATH, [
    '-rtsp_transport', 'tcp',
    '-i', device.rtsp_url,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-c:a', 'aac',
    '-ar', '44100',
    '-b:a', '64k',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
    '-frag_duration', '500000',  // 0.5 second fragments
    'pipe:1',  // output to stdout
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  activeStreams.get(deviceId).ffmpeg = ffmpeg;

  // Send initialization segment first (moov box)
  let initSent = false;
  let buffer = Buffer.alloc(0);

  ffmpeg.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Send chunks to all current viewers via backend relay
    if (buffer.length >= CHUNK_SIZE || (!initSent && buffer.length > 1000)) {
      const viewers = activeStreams.get(deviceId)?.viewers;
      if (viewers && viewers.size > 0) {
        socket.emit('relay:stream-chunk', {
          deviceId,
          chunk: buffer.toString('base64'),
          isInit: !initSent,
          timestamp: Date.now(),
        });
        initSent = true;
      }
      buffer = Buffer.alloc(0);
    }
  });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('frame=') && !msg.includes('error')) return; // progress, skip
    if (msg.includes('error') || msg.includes('Error')) {
      console.error(`  ⚠️  FFmpeg: ${msg.slice(0, 150)}`);
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`  📴 FFmpeg closed for ${device.name} (code ${code})`);
    const stream = activeStreams.get(deviceId);
    if (stream) {
      // Notify all viewers stream ended
      stream.viewers.forEach(vId => {
        socket.emit('relay:stream-ended', { deviceId, viewerSocketId: vId });
      });
      activeStreams.delete(deviceId);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`  ❌ FFmpeg error for ${device.name}:`, err.message);
    socket.emit('relay:stream-error', {
      deviceId,
      message: `FFmpeg error: ${err.message}. Is FFmpeg installed? Run: npm install @ffmpeg-installer/ffmpeg`
    });
    activeStreams.delete(deviceId);
  });

  // Notify viewer stream is starting
  socket.emit('relay:stream-ready', {
    deviceId,
    viewerSocketId,
    mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    deviceName: device.name,
  });

  console.log(`  ✅ Stream started for ${device.name}`);
}

// ── Remove viewer from stream ─────────────────────────────────────
function removeViewer(deviceId, viewerSocketId) {
  const stream = activeStreams.get(deviceId);
  if (!stream) return;
  stream.viewers.delete(viewerSocketId);
  console.log(`  Stream ${deviceId}: ${stream.viewers.size} viewers remaining`);
  // Stop stream if no viewers left
  if (stream.viewers.size === 0) {
    console.log(`  🛑 No viewers left — stopping stream for ${deviceId}`);
    stopStream(deviceId);
  }
}

// ── Stop a stream ─────────────────────────────────────────────────
function stopStream(deviceId) {
  const stream = activeStreams.get(deviceId);
  if (!stream) return;
  if (stream.ffmpeg) {
    try { stream.ffmpeg.kill('SIGKILL'); } catch(e) {}
  }
  activeStreams.delete(deviceId);
  console.log(`  🛑 Stream stopped for ${deviceId}`);
}

// ── Status report every 30 seconds ───────────────────────────────
function startStatusReporting() {
  setInterval(() => {
    const streams = Array.from(activeStreams.entries()).map(([id, s]) => ({
      deviceId: id,
      deviceName: s.deviceName,
      viewers: s.viewers.size,
    }));
    socket.emit('agent:status', { orgId, activeStreams: streams });
    if (streams.length > 0) {
      console.log(`📊 Active streams: ${streams.map(s => `${s.deviceName}(${s.viewers}v)`).join(', ')}`);
    }
  }, 30000);
}

// ── Main ──────────────────────────────────────────────────────────
async function start() {
  console.log('📡 Real Security Camera — Stream Relay Agent');
  console.log('═════════════════════════════════════════════');
  console.log('  Relays local IP camera streams to remote viewers');
  console.log(`  Backend: ${API_URL}`);
  console.log('');

  if (!token) {
    const ok = await authenticate();
    if (!ok) process.exit(1);
  }

  // List available RTSP devices
  const devices = await getDevicesWithRTSP();
  if (devices.length === 0) {
    console.log('⚠️  No devices with RTSP URLs found.');
    console.log('  Run the discovery agent first to detect and enroll IP cameras.');
  } else {
    console.log(`📹 Found ${devices.length} RTSP device(s):`);
    devices.forEach(d => console.log(`  • ${d.name} → ${d.rtsp_url.replace(/:([^:@]+)@/, ':***@')}`));
  }
  console.log('');
  console.log('⏳ Waiting for viewer requests...');

  await connectSocket();
  startStatusReporting();
}

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down stream relay agent...');
  for (const [deviceId] of activeStreams) stopStream(deviceId);
  if (socket) socket.disconnect();
  process.exit(0);
});

start().catch(console.error);
