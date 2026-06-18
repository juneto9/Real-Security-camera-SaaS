/**
 * RSC YOLOv8n Object Detector
 *
 * Runs YOLOv8n inference on a camera frame.
 * Input:  640x640 RGB tensor (normalized 0-1)
 * Output: Array of detections with class, confidence, bounding box
 *
 * YOLOv8n is significantly better than MobileNet/COCO-SSD:
 *   - Same 80 COCO classes but ~30fps vs ~15fps
 *   - Better small object detection (packages, pets at distance)
 *   - Higher confidence accuracy
 *   - 6MB vs 20MB model size
 */

import { getModels } from './modelLoader';

// COCO class names (80 classes — YOLOv8 standard)
export const COCO_CLASSES = [
  'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat',
  'traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat',
  'dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack',
  'umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball',
  'kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket',
  'bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple',
  'sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair',
  'couch','potted plant','bed','dining table','toilet','tv','laptop','mouse',
  'remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator',
  'book','clock','vase','scissors','teddy bear','hair drier','toothbrush',
];

// Security-relevant class groupings
export const SECURITY_CLASSES = {
  people: ['person'],
  vehicles: ['car', 'motorcycle', 'bus', 'truck', 'bicycle'],
  animals: ['dog', 'cat', 'bird', 'horse', 'cow', 'sheep'],
  packages: ['backpack', 'suitcase', 'handbag'],
  weapons: ['knife', 'scissors'],
};

const INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.35;
const NMS_THRESHOLD = 0.45;

/**
 * Preprocess a camera frame for YOLOv8 input.
 * react-native-vision-camera provides frames as typed arrays.
 */
function preprocessFrame(frameData, frameWidth, frameHeight) {
  // Resize to 640x640 and normalize to [0,1]
  // In production this uses GPU-accelerated resize via skia or reanimated
  const tensor = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  const scaleX = frameWidth / INPUT_SIZE;
  const scaleY = frameHeight / INPUT_SIZE;

  for (let y = 0; y < INPUT_SIZE; y++) {
    for (let x = 0; x < INPUT_SIZE; x++) {
      const srcX = Math.floor(x * scaleX);
      const srcY = Math.floor(y * scaleY);
      const srcIdx = (srcY * frameWidth + srcX) * 4; // RGBA
      const dstIdx = (y * INPUT_SIZE + x) * 3;       // RGB

      tensor[dstIdx]     = frameData[srcIdx]     / 255.0; // R
      tensor[dstIdx + 1] = frameData[srcIdx + 1] / 255.0; // G
      tensor[dstIdx + 2] = frameData[srcIdx + 2] / 255.0; // B
    }
  }

  return tensor;
}

/**
 * Non-maximum suppression — removes overlapping detections.
 */
function nms(detections, iouThreshold) {
  if (!detections.length) return [];
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const keep = [];

  for (const det of sorted) {
    let suppressed = false;
    for (const kept of keep) {
      if (kept.classId === det.classId && iou(det.bbox, kept.bbox) > iouThreshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) keep.push(det);
  }
  return keep;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Parse YOLOv8 output tensor.
 * YOLOv8 output shape: [1, 84, 8400] — 84 = 4 bbox + 80 classes
 */
function parseYoloOutput(outputData, frameWidth, frameHeight) {
  const detections = [];
  const numDetections = 8400;
  const numClasses = 80;

  for (let i = 0; i < numDetections; i++) {
    // Find max class confidence
    let maxConf = 0;
    let maxClass = 0;
    for (let c = 0; c < numClasses; c++) {
      const conf = outputData[4 * numDetections + c * numDetections + i];
      if (conf > maxConf) { maxConf = conf; maxClass = c; }
    }

    if (maxConf < CONFIDENCE_THRESHOLD) continue;

    // Bounding box (center format → corner format, normalized to frame)
    const cx = outputData[0 * numDetections + i] / INPUT_SIZE * frameWidth;
    const cy = outputData[1 * numDetections + i] / INPUT_SIZE * frameHeight;
    const w  = outputData[2 * numDetections + i] / INPUT_SIZE * frameWidth;
    const h  = outputData[3 * numDetections + i] / INPUT_SIZE * frameHeight;

    detections.push({
      classId: maxClass,
      className: COCO_CLASSES[maxClass] || 'unknown',
      confidence: maxConf,
      bbox: { x: cx - w/2, y: cy - h/2, w, h },
    });
  }

  return nms(detections, NMS_THRESHOLD);
}

/**
 * Run YOLOv8n detection on a camera frame.
 *
 * @param {object} frame - react-native-vision-camera Frame object
 * @returns {object} { detections, summary, securityAlerts }
 */
export async function detectObjects(frame) {
  const { detectionModel, loaded } = getModels();
  if (!loaded || !detectionModel) {
    return { detections: [], summary: null, securityAlerts: [] };
  }

  try {
    const preprocessed = preprocessFrame(
      frame.data,
      frame.width,
      frame.height
    );

    const output = await detectionModel.run([preprocessed]);
    const rawDetections = parseYoloOutput(output[0], frame.width, frame.height);

    // Build security-focused summary
    const summary = buildSummary(rawDetections);
    const securityAlerts = buildAlerts(rawDetections, summary);

    return { detections: rawDetections, summary, securityAlerts };

  } catch (err) {
    console.warn('[YOLOv8n] Inference error:', err.message);
    return { detections: [], summary: null, securityAlerts: [] };
  }
}

/**
 * Build human-readable summary from detections.
 * e.g. "2 people · 1 vehicle · 1 dog"
 */
export function buildSummary(detections) {
  if (!detections.length) return null;

  const counts = {};
  for (const det of detections) {
    counts[det.className] = (counts[det.className] || 0) + 1;
  }

  const parts = [];
  const people = counts['person'] || 0;
  if (people === 1) parts.push('1 person');
  else if (people > 1) parts.push(`${people} people`);

  for (const vehicle of SECURITY_CLASSES.vehicles) {
    if (counts[vehicle]) parts.push(`${counts[vehicle]} ${vehicle}`);
  }
  for (const animal of SECURITY_CLASSES.animals) {
    if (counts[animal]) parts.push(`${counts[animal]} ${animal}`);
  }
  for (const pkg of SECURITY_CLASSES.packages) {
    if (counts[pkg]) parts.push(`${counts[pkg]} ${pkg}`);
  }

  return parts.length ? parts.join(' · ') : null;
}

/**
 * Generate security alerts from detections.
 */
export function buildAlerts(detections, summary) {
  const alerts = [];
  const classNames = detections.map(d => d.className);

  if (classNames.includes('person')) {
    const count = classNames.filter(c => c === 'person').length;
    alerts.push({
      type: 'person',
      emoji: '🚶',
      message: count === 1 ? 'Person detected' : `${count} people detected`,
      severity: 'medium',
    });
  }

  if (SECURITY_CLASSES.vehicles.some(v => classNames.includes(v))) {
    alerts.push({
      type: 'vehicle',
      emoji: '🚗',
      message: 'Vehicle detected',
      severity: 'low',
    });
  }

  if (classNames.includes('knife') || classNames.includes('scissors')) {
    alerts.push({
      type: 'weapon',
      emoji: '⚠️',
      message: 'Potential weapon in frame',
      severity: 'high',
    });
  }

  if (SECURITY_CLASSES.packages.some(p => classNames.includes(p))) {
    alerts.push({
      type: 'package',
      emoji: '📦',
      message: 'Package / bag detected',
      severity: 'low',
    });
  }

  return alerts;
}
