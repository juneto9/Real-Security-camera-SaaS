/**
 * RSC AI Engine — Orchestrator
 *
 * Ties all AI modules together into a single interface.
 * This is what CameraScreen and the clip recorder call.
 *
 * Produces the clip badge string that appears on every recording:
 *   Free:  "🧠 2 people · 1 vehicle · Glass break"
 *   Pro:   "🧠 Known: Marek · Unknown face · 🏃 Running · 🐕 Dog barking"
 *
 * Web dashboard shows:
 *   Phone clips: full AI badge (from this engine)
 *   Web cam clips: "🔒 AI Analysis — Upgrade to Pro" (feature gate)
 */

import { loadModels, getModels } from './modelLoader';
import { detectObjects, buildSummary, buildAlerts } from './yoloDetector';
import { analyzePose } from './poseAnalyzer';
import { detectFaces, setOrgPlan } from './faceDetector';
import { audioClassifier } from './audioClassifier';

let _initialized = false;
let _orgPlan = 'free';
let _currentAlerts = [];
let _currentBadge = null;
let _onAIEvent = null;
let _frameCount = 0;
const DETECTION_EVERY_N_FRAMES = 5; // run AI every 5 frames (~6fps AI, 30fps video)

/**
 * Initialize the AI engine. Call once on app start.
 * @param {string} orgPlan - 'free' | 'pro' | 'business' | 'enterprise'
 */
export async function initAI(orgPlan = 'free') {
  if (_initialized) return;
  _orgPlan = orgPlan;
  setOrgPlan(orgPlan);

  console.log('[AIEngine] Loading models...');
  try {
    await loadModels();
    _initialized = true;
    console.log('[AIEngine] Ready');
  } catch (err) {
    console.warn('[AIEngine] Model load failed — AI features unavailable:', err.message);
  }
}

/**
 * Register callback for real-time AI events.
 * @param {function} callback - ({ badge, alerts, faces, objects, behaviors }) => void
 */
export function onAIEvent(callback) {
  _onAIEvent = callback;
}

/**
 * Process a camera frame through the full AI pipeline.
 * Called from CameraScreen's frame processor.
 *
 * @param {object} frame - react-native-vision-camera Frame
 */
export async function processFrame(frame) {
  if (!_initialized) return null;

  _frameCount++;
  if (_frameCount % DETECTION_EVERY_N_FRAMES !== 0) return _currentBadge;

  try {
    // Run all detectors in parallel for speed
    const [objResult, poseResult, faceResult] = await Promise.all([
      detectObjects(frame),
      analyzePose(frame),
      detectFaces(frame),
    ]);

    // Aggregate all alerts
    const allAlerts = [
      ...(objResult.securityAlerts || []),
      ...(poseResult.behaviorAlerts || []),
      ...(faceResult.faceAlerts || []),
    ];

    // Build the clip badge string
    const parts = [];

    // Object summary (YOLOv8n)
    if (objResult.summary) parts.push(objResult.summary);

    // Face summary
    if (faceResult.faceLabel) parts.push(faceResult.faceLabel);

    // Behavior alerts (pose)
    for (const alert of poseResult.behaviorAlerts) {
      parts.push(`${alert.emoji} ${alert.message}`);
    }

    _currentBadge = parts.length ? `🧠 ${parts.join(' · ')}` : null;
    _currentAlerts = allAlerts;

    // Emit to UI
    if (_onAIEvent && (parts.length || allAlerts.length)) {
      _onAIEvent({
        badge: _currentBadge,
        alerts: allAlerts,
        faces: faceResult.faces,
        objects: objResult.detections,
        behaviors: poseResult.poses,
      });
    }

    return _currentBadge;

  } catch (err) {
    console.warn('[AIEngine] Frame processing error:', err.message);
    return _currentBadge;
  }
}

/**
 * Start audio classification on a media stream.
 */
export function startAudioAI(stream) {
  audioClassifier.start(stream, (alert) => {
    _currentAlerts = [..._currentAlerts.filter(a => a.type !== alert.type), alert];
    _onAIEvent?.({
      badge: _currentBadge,
      alerts: _currentAlerts,
      audioAlert: alert,
    });
  });
}

export function stopAudioAI() {
  audioClassifier.stop();
}

/**
 * Get the current AI badge string (for clip metadata).
 */
export function getCurrentBadge() {
  return _currentBadge;
}

export function getCurrentAlerts() {
  return _currentAlerts;
}

export function isAIReady() {
  return _initialized;
}

export function getOrgPlan() {
  return _orgPlan;
}

/**
 * Build the web dashboard display string for a clip.
 * Phone clips: full AI metadata
 * Web cam clips: feature gate message
 *
 * @param {object} clip - clip record from DB
 * @param {string} plan - org plan
 * @returns {object} { badge, locked, upgradeMessage }
 */
export function buildClipAIDisplay(clip, plan = 'free') {
  // Phone-recorded clips always show full AI
  if (clip.source === 'mobile' || clip.ai_badge) {
    return {
      badge: clip.ai_badge || '🧠 AI Analysis',
      locked: false,
      upgradeMessage: null,
    };
  }

  // Web cam clips — gate based on plan
  if (plan === 'free') {
    return {
      badge: null,
      locked: true,
      upgradeMessage: '🔒 AI Analysis — RSC Mobile only',
    };
  }

  if (plan === 'pro') {
    return {
      badge: null,
      locked: true,
      upgradeMessage: '🔒 AI Analysis — Upgrade to Business',
    };
  }

  return {
    badge: clip.ai_badge || '🧠 AI Processing...',
    locked: false,
    upgradeMessage: null,
  };
}
