/**
 * RSC AI Overlay
 *
 * Renders real-time AI detections on top of the camera feed.
 * Bounding boxes, behavior labels, face badges, audio alerts.
 *
 * This is what makes users feel like the phone is way smarter
 * than the web cam — they can SEE the AI working in real time.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');

function BoundingBox({ detection, frameWidth, frameHeight, color = '#E02020' }) {
  const { bbox, className, confidence } = detection;

  // Scale bbox from frame coords to screen coords
  const scaleX = SW / frameWidth;
  const scaleY = SH / frameHeight;

  const left   = bbox.x * scaleX;
  const top    = bbox.y * scaleY;
  const width  = bbox.w * scaleX;
  const height = bbox.h * scaleY;

  const pct = Math.round(confidence * 100);

  return (
    <View style={[s.bbox, { left, top, width, height, borderColor: color }]}>
      <View style={[s.bboxLabel, { backgroundColor: color }]}>
        <Text style={s.bboxLabelText}>{className} {pct}%</Text>
      </View>
    </View>
  );
}

function AlertToast({ alert, index }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [alert]);

  const bgColor = {
    critical: 'rgba(220,38,38,0.95)',
    high: 'rgba(220,38,38,0.85)',
    medium: 'rgba(234,88,12,0.85)',
    low: 'rgba(22,163,74,0.8)',
  }[alert.severity] || 'rgba(0,0,0,0.8)';

  return (
    <Animated.View style={[s.toast, { opacity, bottom: 100 + index * 52, backgroundColor: bgColor }]}>
      <Text style={s.toastText}>{alert.emoji} {alert.message}</Text>
      {alert.confidence && (
        <Text style={s.toastConf}>{Math.round(alert.confidence * 100)}%</Text>
      )}
    </Animated.View>
  );
}

export default function AIOverlay({
  detections = [],
  faces = [],
  alerts = [],
  badge = null,
  frameWidth = SW,
  frameHeight = SH,
  visible = true,
}) {
  if (!visible) return null;

  // Color by class type
  const boxColor = (className) => {
    if (className === 'person') return '#E02020';
    if (['car','truck','bus','motorcycle'].includes(className)) return '#f59e0b';
    if (['dog','cat'].includes(className)) return '#10b981';
    return '#6366f1';
  };

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Bounding boxes */}
      {detections.map((det, i) => (
        <BoundingBox
          key={`det_${i}`}
          detection={det}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          color={boxColor(det.className)}
        />
      ))}

      {/* Face boxes */}
      {faces.map((face, i) => (
        <BoundingBox
          key={`face_${i}`}
          detection={{ ...face, className: 'face', confidence: face.score }}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          color="#a78bfa"
        />
      ))}

      {/* AI Badge — top center */}
      {badge && (
        <View style={s.badgeWrap}>
          <View style={s.badge}>
            <Text style={s.badgeText} numberOfLines={1}>{badge}</Text>
          </View>
        </View>
      )}

      {/* Alert toasts — bottom */}
      {alerts.slice(0, 3).map((alert, i) => (
        <AlertToast key={`alert_${alert.type}_${i}`} alert={alert} index={i} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  bbox: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 4,
  },
  bboxLabel: {
    position: 'absolute',
    top: -20,
    left: -1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bboxLabelText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },

  badgeWrap: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(224,32,32,0.5)',
    maxWidth: SW - 40,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },

  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toastText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
  },
  toastConf: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    marginLeft: 8,
  },
});
