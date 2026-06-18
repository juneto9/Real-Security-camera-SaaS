import { Room, RoomEvent, Track, createLocalVideoTrack, createLocalAudioTrack } from '@livekit/react-native';
import api from './api';

export const LIVEKIT_URL = 'wss://livekit.realsecuritycamera.com';

/**
 * Fetch a LiveKit token from the RSC VPS token server.
 * identity: unique string for this phone+facing combo
 * roomName: org-scoped room e.g. "org_7df7ca93_device_abc123"
 * canPublish: true for camera phones, false for admin viewers
 */
export async function fetchLiveKitToken({ identity, roomName, canPublish = true }) {
  const res = await api.post('/api/livekit/token', {
    identity,
    room: roomName,
    canPublish,
    canSubscribe: true,
  });
  return res.data.token;
}

/**
 * Build a room name scoped to the org and device.
 * Front and rear cameras share the same room — they're separate tracks.
 */
export function buildRoomName(orgId, deviceId) {
  return `org_${orgId}_device_${deviceId}`;
}

/**
 * Connect to LiveKit and publish dual tracks (front + rear).
 * Returns { room, frontTrack, rearTrack, audioTrack }
 *
 * Because mobile OS cannot open two camera sessions simultaneously,
 * we publish:
 *   - rearTrack: expo-camera rear video track (primary)
 *   - frontTrack: expo-camera front video track (secondary / PiP)
 *
 * LiveKit handles multiplexing both to the server.
 * Admin dashboard subscribes to both tracks independently.
 * LiveKit Egress records each track as a separate file to DO Spaces.
 */
export async function connectAndPublish({ orgId, deviceId, userId, onStateChange }) {
  const roomName = buildRoomName(orgId, deviceId);

  // Two identities — one per camera facing — in the same room
  const rearIdentity = `${userId}_${deviceId}_rear`;
  const frontIdentity = `${userId}_${deviceId}_front`;

  const [rearToken, frontToken] = await Promise.all([
    fetchLiveKitToken({ identity: rearIdentity, roomName, canPublish: true }),
    fetchLiveKitToken({ identity: frontIdentity, roomName, canPublish: true }),
  ]);

  // Primary room for rear camera + audio
  const rearRoom = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      facingMode: 'environment', // rear
      resolution: { width: 1280, height: 720, frameRate: 30 },
    },
  });

  // Secondary room for front camera (no audio to avoid echo)
  const frontRoom = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      facingMode: 'user', // front
      resolution: { width: 1280, height: 720, frameRate: 30 },
    },
  });

  rearRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
    onStateChange?.({ camera: 'rear', state });
  });
  frontRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
    onStateChange?.({ camera: 'front', state });
  });

  await Promise.all([
    rearRoom.connect(LIVEKIT_URL, rearToken),
    frontRoom.connect(LIVEKIT_URL, frontToken),
  ]);

  await Promise.all([
    rearRoom.localParticipant.enableCameraAndMicrophone(),
    frontRoom.localParticipant.enableCameraAndMicrophone(),
  ]);

  return { rearRoom, frontRoom };
}

/**
 * Disconnect both rooms cleanly.
 */
export async function disconnectRooms({ rearRoom, frontRoom }) {
  try {
    if (rearRoom) await rearRoom.disconnect();
    if (frontRoom) await frontRoom.disconnect();
  } catch (e) {
    console.warn('LiveKit disconnect error:', e);
  }
}

/**
 * Request LiveKit Egress recording start from the VPS.
 * Records both tracks to DO Spaces as separate files.
 * clipLength: seconds per clip (e.g. 30, 60, 300, 900, 1800)
 * mode: 'dashcam' | 'security'
 */
export async function startEgressRecording({ orgId, deviceId, clipLength, mode }) {
  const roomName = buildRoomName(orgId, deviceId);
  const res = await api.post('/api/livekit/egress/start', {
    roomName,
    deviceId,
    clipLength,
    mode,
  });
  return res.data;
}

/**
 * Stop active egress recording for this device.
 */
export async function stopEgressRecording({ deviceId }) {
  const res = await api.post('/api/livekit/egress/stop', { deviceId });
  return res.data;
}
