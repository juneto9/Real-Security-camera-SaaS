import * as FileSystem from 'expo-file-system';
import api from './api';

/**
 * Upload a completed clip to DO Spaces via the VPS signed URL endpoint.
 * Files NEVER get deleted automatically. Storage fills = user buys more.
 *
 * @param {object} opts
 * @param {string} opts.localUri - local file:// path from expo-camera recording
 * @param {string} opts.deviceId
 * @param {string} opts.orgId
 * @param {string} opts.facing - 'front' | 'rear'
 * @param {string} opts.mode - 'dashcam' | 'security'
 * @param {string} opts.sessionId - links front+rear clips recorded at same time
 * @param {function} opts.onProgress - (pct: 0-100) => void
 */
export async function uploadClip({ localUri, deviceId, orgId, facing, mode, sessionId, onProgress }) {
  const filename = buildFilename({ deviceId, facing, mode, sessionId });

  // 1. Get a pre-signed upload URL from the VPS
  const { data } = await api.post('/api/recordings/upload-url', {
    deviceId,
    orgId,
    filename,
    facing,
    mode,
    sessionId,
    contentType: 'video/mp4',
  });

  const { uploadUrl, recordingId, spacesPath } = data;

  // 2. Upload directly to DO Spaces using the signed URL
  const uploadResult = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Upload failed with status ${uploadResult.status}`);
  }

  // 3. Confirm upload complete to VPS so it marks the recording as available
  await api.post('/api/recordings/confirm-upload', {
    recordingId,
    spacesPath,
  });

  return { recordingId, spacesPath, filename };
}

/**
 * Build a deterministic filename.
 * e.g. rsc_org7df7_devABC_rear_dashcam_sess1234_20260618_143022.mp4
 */
function buildFilename({ deviceId, facing, mode, sessionId }) {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 15); // 20260618_143022
  const shortDev = deviceId.slice(0, 8);
  const shortSess = sessionId.slice(0, 8);
  return `rsc_dev${shortDev}_${facing}_${mode}_sess${shortSess}_${ts}.mp4`;
}

/**
 * Generate a unique session ID for a recording session.
 * Front + rear clips get the same sessionId so they're linked in the DB.
 */
export function generateSessionId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check available local storage (for display in settings, not for auto-delete).
 */
export async function getLocalStorageInfo() {
  const info = await FileSystem.getFreeDiskStorageAsync();
  const total = await FileSystem.getTotalDiskCapacityAsync();
  return {
    freeBytes: info,
    totalBytes: total,
    freeGB: (info / 1e9).toFixed(1),
    totalGB: (total / 1e9).toFixed(1),
    usedPct: Math.round(((total - info) / total) * 100),
  };
}
