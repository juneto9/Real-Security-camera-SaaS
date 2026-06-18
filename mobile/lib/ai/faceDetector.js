/**
 * RSC Face Detector — MediaPipe BlazeFace
 *
 * BlazeFace is purpose-built for mobile face detection:
 *   - <1ms on modern Android/iOS GPU
 *   - Detects faces at distance (up to 6 face sizes away)
 *   - 6 facial keypoints: eyes, ears, nose, mouth
 *   - Works in low light better than generic detectors
 *
 * Free tier: count faces, detect presence
 * Pro tier: match against enrolled Subjects via RSC cloud
 *
 * The "tease" mechanic:
 *   - Free user sees: "👤 Face detected — 2 people in frame"
 *   - Pro user sees:  "👤 Known: Marek · 👤 Unknown — 2nd visit today"
 */

import { getModels } from './modelLoader';
import api from '../api';

const FACE_CONFIDENCE_THRESHOLD = 0.75;
const FACE_MATCH_INTERVAL_MS = 5000; // only POST to cloud every 5s per face

let lastMatchTime = 0;
let _orgPlan = 'free';

export function setOrgPlan(plan) {
  _orgPlan = plan;
}

/**
 * Parse BlazeFace output.
 * Output: [scores, boxes] where boxes are [ymin, xmin, ymax, xmax, keypoints...]
 */
function parseBlazeFaceOutput(scores, boxes, frameWidth, frameHeight) {
  const faces = [];
  const numFaces = scores.length;

  for (let i = 0; i < numFaces; i++) {
    if (scores[i] < FACE_CONFIDENCE_THRESHOLD) continue;

    const ymin = boxes[i * 16]     * frameHeight;
    const xmin = boxes[i * 16 + 1] * frameWidth;
    const ymax = boxes[i * 16 + 2] * frameHeight;
    const xmax = boxes[i * 16 + 3] * frameWidth;

    // 6 facial keypoints (right eye, left eye, nose, mouth, right ear, left ear)
    const keypoints = [];
    for (let k = 0; k < 6; k++) {
      keypoints.push({
        x: boxes[i * 16 + 4 + k * 2]     * frameWidth,
        y: boxes[i * 16 + 4 + k * 2 + 1] * frameHeight,
      });
    }

    faces.push({
      score: scores[i],
      bbox: { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin },
      keypoints,
      centerX: (xmin + xmax) / 2 / frameWidth,
      centerY: (ymin + ymax) / 2 / frameHeight,
    });
  }

  return faces;
}

/**
 * Detect faces in a frame.
 * Returns faces array + AI label string for the clip badge.
 */
export async function detectFaces(frame) {
  const { faceModel, loaded } = getModels();
  if (!loaded || !faceModel) return { faces: [], faceLabel: null, faceAlerts: [] };

  try {
    const output = await faceModel.run([frame.preprocessed]);
    const faces = parseBlazeFaceOutput(output[0], output[1], frame.width, frame.height);

    if (!faces.length) return { faces: [], faceLabel: null, faceAlerts: [] };

    const count = faces.length;

    // Free tier label — count only, no identity
    let faceLabel = count === 1 ? '1 face detected' : `${count} faces detected`;
    let faceAlerts = [{
      type: 'faces',
      emoji: '👤',
      message: faceLabel,
      severity: 'medium',
      count,
    }];

    // Pro tier — attempt cloud face matching
    if (_orgPlan !== 'free' && _orgPlan !== 'free_tier') {
      const now = Date.now();
      if (now - lastMatchTime > FACE_MATCH_INTERVAL_MS) {
        lastMatchTime = now;
        const matchResult = await matchFacesWithCloud(faces, frame);
        if (matchResult) {
          faceLabel = matchResult.label;
          faceAlerts = matchResult.alerts;
        }
      }
    }

    return { faces, faceLabel, faceAlerts };

  } catch (err) {
    console.warn('[FaceDetector] Error:', err.message);
    return { faces: [], faceLabel: null, faceAlerts: [] };
  }
}

/**
 * Pro only: send face crops to RSC cloud for Subject matching.
 * The cloud uses face-api.js descriptors + AWS Rekognition fallback.
 */
async function matchFacesWithCloud(faces, frame) {
  try {
    // In production: crop face regions from frame as base64 JPEG
    // and send to /api/subjects/match
    // For now we send face count + bbox for server-side processing
    const res = await api.post('/api/subjects/match-mobile', {
      face_count: faces.length,
      faces: faces.map(f => ({
        bbox: f.bbox,
        center: { x: f.centerX, y: f.centerY },
        score: f.score,
      })),
    });

    if (res.data?.matches?.length) {
      const labels = res.data.matches.map(m =>
        m.subject_name ? `Known: ${m.subject_name}` : 'Unknown face'
      );
      const uniqueLabels = [...new Set(labels)];
      const unknownCount = labels.filter(l => l === 'Unknown face').length;

      return {
        label: uniqueLabels.join(' · '),
        alerts: [
          ...res.data.matches
            .filter(m => m.subject_name)
            .map(m => ({
              type: 'known_face',
              emoji: '✅',
              message: `Known: ${m.subject_name}`,
              severity: 'low',
              subjectId: m.subject_id,
            })),
          ...(unknownCount > 0 ? [{
            type: 'unknown_face',
            emoji: '❓',
            message: `${unknownCount} unknown face${unknownCount > 1 ? 's' : ''}`,
            severity: 'high',
          }] : []),
        ],
      };
    }
  } catch (e) {
    console.warn('[FaceDetector] Cloud match error:', e.message);
  }
  return null;
}
