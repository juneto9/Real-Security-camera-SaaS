/**
 * RSC AI Model Loader
 *
 * Loads YOLOv8n TFLite model bundled in assets/models/.
 * Uses @tensorflow/tfjs-react-native + react-native-fast-tflite.
 *
 * Models bundled:
 *   assets/models/yolov8n.tflite       — object detection (80 COCO classes)
 *   assets/models/yolov8n_pose.tflite  — pose estimation (17 keypoints)
 *   assets/models/blazeface.tflite     — face detection (MediaPipe)
 *
 * All models run fully on-device. No cloud calls, no API costs.
 * Works on free tier. Works offline.
 */

import { loadTFLiteModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';

let _detectionModel = null;
let _poseModel = null;
let _faceModel = null;
let _loadingPromise = null;

/**
 * Load all models once. Subsequent calls return cached instances.
 * Call this on app startup or before first camera frame.
 */
export async function loadModels() {
  if (_detectionModel && _poseModel && _faceModel) {
    return { detectionModel: _detectionModel, poseModel: _poseModel, faceModel: _faceModel };
  }

  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    try {
      // Resolve asset URIs so TFLite can load from the bundle
      const [detAsset, poseAsset, faceAsset] = await Asset.loadAsync([
        require('../../assets/models/yolov8n.tflite'),
        require('../../assets/models/yolov8n_pose.tflite'),
        require('../../assets/models/blazeface.tflite'),
      ]);

      [_detectionModel, _poseModel, _faceModel] = await Promise.all([
        loadTFLiteModel(detAsset.localUri),
        loadTFLiteModel(poseAsset.localUri),
        loadTFLiteModel(faceAsset.localUri),
      ]);

      console.log('[RSC AI] All models loaded');
      return {
        detectionModel: _detectionModel,
        poseModel: _poseModel,
        faceModel: _faceModel,
      };
    } catch (err) {
      console.error('[RSC AI] Model load failed:', err.message);
      _loadingPromise = null;
      throw err;
    }
  })();

  return _loadingPromise;
}

export function getModels() {
  return {
    detectionModel: _detectionModel,
    poseModel: _poseModel,
    faceModel: _faceModel,
    loaded: !!(_detectionModel && _poseModel && _faceModel),
  };
}
