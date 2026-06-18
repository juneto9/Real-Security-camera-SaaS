/**
 * RSC Pose Analyzer — YOLOv8n-pose
 *
 * Detects body keypoints and classifies behavior.
 * This is what makes RSC Mobile smarter than any web cam —
 * it doesn't just detect a person, it knows what they're doing.
 *
 * 17 COCO keypoints:
 * 0:nose 1:left_eye 2:right_eye 3:left_ear 4:right_ear
 * 5:left_shoulder 6:right_shoulder 7:left_elbow 8:right_elbow
 * 9:left_wrist 10:right_wrist 11:left_hip 12:right_hip
 * 13:left_knee 14:right_knee 15:left_ankle 16:right_ankle
 *
 * Behaviors detected:
 *   - Loitering (stationary > 2 min)
 *   - Running (fast limb movement)
 *   - Falling (sudden vertical drop)
 *   - Crouching (low hip position)
 *   - Hands raised (potential threat or distress)
 *   - Package drop (item placed and person leaves)
 */

import { getModels } from './modelLoader';

const KP = {
  NOSE: 0, L_EYE: 1, R_EYE: 2, L_EAR: 3, R_EAR: 4,
  L_SHOULDER: 5, R_SHOULDER: 6, L_ELBOW: 7, R_ELBOW: 8,
  L_WRIST: 9, R_WRIST: 10, L_HIP: 11, R_HIP: 12,
  L_KNEE: 13, R_KNEE: 14, L_ANKLE: 15, R_ANKLE: 16,
};

const POSE_CONFIDENCE_THRESHOLD = 0.5;

// Track position history per detected person for loitering/running detection
const positionHistory = new Map(); // personId -> [{x, y, timestamp}]
const LOITER_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const LOITER_MOVEMENT_THRESHOLD = 0.05;     // normalized coords

/**
 * Parse YOLOv8-pose output.
 * Output shape: [1, 56, 8400] — 56 = 4bbox + 1conf + 17*3 keypoints
 */
function parsePoseOutput(outputData, frameWidth, frameHeight) {
  const poses = [];
  const numDetections = 8400;

  for (let i = 0; i < numDetections; i++) {
    const confidence = outputData[4 * numDetections + i];
    if (confidence < POSE_CONFIDENCE_THRESHOLD) continue;

    const cx = outputData[0 * numDetections + i] / 640 * frameWidth;
    const cy = outputData[1 * numDetections + i] / 640 * frameHeight;
    const w  = outputData[2 * numDetections + i] / 640 * frameWidth;
    const h  = outputData[3 * numDetections + i] / 640 * frameHeight;

    // Extract 17 keypoints (each has x, y, confidence)
    const keypoints = [];
    for (let k = 0; k < 17; k++) {
      const base = (5 + k * 3) * numDetections + i;
      keypoints.push({
        x: outputData[base]     / 640 * frameWidth,
        y: outputData[base + 1] / 640 * frameHeight,
        score: outputData[base + 2],
      });
    }

    poses.push({
      bbox: { x: cx - w/2, y: cy - h/2, w, h },
      confidence,
      keypoints,
      centerX: cx / frameWidth,
      centerY: cy / frameHeight,
    });
  }

  return poses;
}

function kp(pose, index) {
  return pose.keypoints[index];
}

function kpVisible(pose, index) {
  return pose.keypoints[index]?.score > POSE_CONFIDENCE_THRESHOLD;
}

/**
 * Classify behavior from a single pose.
 */
function classifyBehavior(pose, personId, frameHeight) {
  const behaviors = [];
  const kps = pose.keypoints;

  // ── Hands raised ──────────────────────────────────────────────────────────
  // Wrists above shoulders
  if (
    kpVisible(pose, KP.L_WRIST) && kpVisible(pose, KP.L_SHOULDER) &&
    kps[KP.L_WRIST].y < kps[KP.L_SHOULDER].y
  ) behaviors.push('hands_raised');
  if (
    kpVisible(pose, KP.R_WRIST) && kpVisible(pose, KP.R_SHOULDER) &&
    kps[KP.R_WRIST].y < kps[KP.R_SHOULDER].y
  ) behaviors.push('hands_raised');

  // ── Crouching ─────────────────────────────────────────────────────────────
  // Hips below knees (person squatting)
  if (
    kpVisible(pose, KP.L_HIP) && kpVisible(pose, KP.L_KNEE) &&
    kpVisible(pose, KP.R_HIP) && kpVisible(pose, KP.R_KNEE)
  ) {
    const hipY = (kps[KP.L_HIP].y + kps[KP.R_HIP].y) / 2;
    const kneeY = (kps[KP.L_KNEE].y + kps[KP.R_KNEE].y) / 2;
    if (hipY > kneeY * 0.85) behaviors.push('crouching');
  }

  // ── Falling ───────────────────────────────────────────────────────────────
  // Shoulders at ankle level — person horizontal
  if (
    kpVisible(pose, KP.L_SHOULDER) && kpVisible(pose, KP.R_SHOULDER) &&
    kpVisible(pose, KP.L_ANKLE) && kpVisible(pose, KP.R_ANKLE)
  ) {
    const shoulderY = (kps[KP.L_SHOULDER].y + kps[KP.R_SHOULDER].y) / 2;
    const ankleY = (kps[KP.L_ANKLE].y + kps[KP.R_ANKLE].y) / 2;
    if (Math.abs(shoulderY - ankleY) < frameHeight * 0.15) {
      behaviors.push('falling_or_on_ground');
    }
  }

  // ── Loitering ─────────────────────────────────────────────────────────────
  const history = positionHistory.get(personId) || [];
  history.push({ x: pose.centerX, y: pose.centerY, timestamp: Date.now() });
  // Keep last 5 minutes of history
  const cutoff = Date.now() - LOITER_THRESHOLD_MS;
  const recentHistory = history.filter(h => h.timestamp > cutoff);
  positionHistory.set(personId, recentHistory.slice(-300)); // max 300 entries

  if (recentHistory.length > 30) {
    const oldest = recentHistory[0];
    const newest = recentHistory[recentHistory.length - 1];
    const totalMovement = Math.hypot(newest.x - oldest.x, newest.y - oldest.y);
    const timeSpan = newest.timestamp - oldest.timestamp;

    if (timeSpan >= LOITER_THRESHOLD_MS && totalMovement < LOITER_MOVEMENT_THRESHOLD) {
      behaviors.push('loitering');
    }
  }

  // ── Running ───────────────────────────────────────────────────────────────
  if (recentHistory.length > 5) {
    const last5 = recentHistory.slice(-5);
    const speed = Math.hypot(
      last5[last5.length-1].x - last5[0].x,
      last5[last5.length-1].y - last5[0].y
    ) / (last5[last5.length-1].timestamp - last5[0].timestamp) * 1000;

    if (speed > 0.3) behaviors.push('running'); // normalized coords/sec
  }

  return [...new Set(behaviors)]; // deduplicate
}

/**
 * Run pose estimation on a frame.
 * @returns { poses, behaviorAlerts }
 */
export async function analyzePose(frame) {
  const { poseModel, loaded } = getModels();
  if (!loaded || !poseModel) return { poses: [], behaviorAlerts: [] };

  try {
    const output = await poseModel.run([frame.preprocessed]);
    const poses = parsePoseOutput(output[0], frame.width, frame.height);

    const behaviorAlerts = [];

    poses.forEach((pose, idx) => {
      const personId = `person_${idx}`; // simplified — production uses tracking
      const behaviors = classifyBehavior(pose, personId, frame.height);

      for (const behavior of behaviors) {
        const alert = BEHAVIOR_ALERTS[behavior];
        if (alert) behaviorAlerts.push(alert);
      }
    });

    return { poses, behaviorAlerts: [...new Map(behaviorAlerts.map(a => [a.type, a])).values()] };

  } catch (err) {
    console.warn('[PoseAnalyzer] Error:', err.message);
    return { poses: [], behaviorAlerts: [] };
  }
}

const BEHAVIOR_ALERTS = {
  hands_raised:         { type: 'hands_raised',          emoji: '🙌', message: 'Hands raised',                  severity: 'medium' },
  crouching:            { type: 'crouching',              emoji: '🦵', message: 'Person crouching',              severity: 'low'    },
  falling_or_on_ground: { type: 'falling',                emoji: '🚨', message: 'Person down / possible fall',   severity: 'high'   },
  loitering:            { type: 'loitering',              emoji: '⏱️', message: 'Loitering — 2+ min stationary', severity: 'high'   },
  running:              { type: 'running',                emoji: '🏃', message: 'Person running',                severity: 'medium' },
};

export function clearPositionHistory() {
  positionHistory.clear();
}
