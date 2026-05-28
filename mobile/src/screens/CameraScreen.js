import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Dimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Brightness from 'expo-brightness';
import { useKeepAwake } from 'expo-keep-awake';
import api from '../api';

const { width, height } = Dimensions.get('window');
const MOTION_THRESHOLD = 0.15;
const MOTION_COOLDOWN = 10000;

export default function CameraScreen({ route }) {
  const { device } = route.params || {};
  const [permission, requestPermission] = useCameraPermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [motionDetected, setMotionDetected] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [nightVisionAuto, setNightVisionAuto] = useState(true);
  const [status, setStatus] = useState('Monitoring...');
  const [motionCount, setMotionCount] = useState(0);
  const cameraRef = useRef(null);
  const lastMotionTime = useRef(0);
  const motionCooldownRef = useRef(false);

  useKeepAwake();

  useEffect(() => {
    if (nightVisionAuto) {
      checkBrightnessForNightVision();
      const interval = setInterval(checkBrightnessForNightVision, 30000);
      return () => clearInterval(interval);
    }
  }, [nightVisionAuto]);

  const checkBrightnessForNightVision = async () => {
    try {
      const { status: brightStatus } = await Brightness.requestPermissionsAsync();
      if (brightStatus === 'granted') {
        const brightness = await Brightness.getBrightnessAsync();
        const shouldEnableTorch = brightness < 0.3;
        setTorchOn(shouldEnableTorch);
        if (shouldEnableTorch) setStatus('Night vision active 🌙');
        else setStatus('Monitoring...');
      }
    } catch (err) {
      console.log('Brightness check error:', err);
    }
  };

  const handleMotionDetected = async () => {
    if (motionCooldownRef.current) return;
    motionCooldownRef.current = true;

    setMotionDetected(true);
    setMotionCount(c => c + 1);
    setStatus('⚠️ Motion detected!');

    try {
      await api.post('/api/motion/detect', {
        device_id: device?.id,
        confidence: 85,
        stream_key: device?.stream_key,
      });

      // Start 30-second recording
      if (cameraRef.current && !isRecording) {
        setIsRecording(true);
        setStatus('🔴 Recording 30s clip...');
        setTimeout(async () => {
          setIsRecording(false);
          setStatus('Monitoring...');
        }, 30000);
      }
    } catch (err) {
      console.log('Motion report error:', err);
    }

    setTimeout(() => {
      setMotionDetected(false);
      motionCooldownRef.current = false;
      if (!isRecording) setStatus('Monitoring...');
    }, MOTION_COOLDOWN);
  };

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission required</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        enableTorch={torchOn}
        onCameraReady={() => setStatus('Camera ready - Monitoring...')}
      >
        {/* Status overlay */}
        <View style={styles.overlay}>
          <View style={[styles.statusBar, motionDetected && styles.statusBarAlert]}>
            <View style={[styles.recordDot, isRecording && styles.recordDotActive]} />
            <Text style={styles.statusText}>{status}</Text>
          </View>

          {/* Device info */}
          {device && (
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{device.device_name || 'Camera'}</Text>
              <Text style={styles.deviceLocation}>{device.location || ''}</Text>
            </View>
          )}

          {/* Motion counter */}
          <View style={styles.motionCounter}>
            <Text style={styles.motionCountText}>Motion events: {motionCount}</Text>
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.controlBtn, torchOn && styles.controlBtnActive]}
              onPress={() => { setTorchOn(!torchOn); setNightVisionAuto(false); }}
            >
              <Text style={styles.controlIcon}>{torchOn ? '🔦' : '💡'}</Text>
              <Text style={styles.controlText}>{torchOn ? 'Torch ON' : 'Torch OFF'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlBtn, nightVisionAuto && styles.controlBtnActive]}
              onPress={() => setNightVisionAuto(!nightVisionAuto)}
            >
              <Text style={styles.controlIcon}>🌙</Text>
              <Text style={styles.controlText}>Auto Night {nightVisionAuto ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.controlBtn}
              onPress={handleMotionDetected}
            >
              <Text style={styles.controlIcon}>⚡</Text>
              <Text style={styles.controlText}>Test Motion</Text>
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  text: { color: '#fff', fontSize: 16, textAlign: 'center', margin: 20 },
  button: { backgroundColor: '#00ff88', padding: 16, borderRadius: 8, margin: 20 },
  buttonText: { color: '#000', fontWeight: 'bold', textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 16 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)', padding: 12,
    borderRadius: 8, marginTop: 40,
  },
  statusBarAlert: { backgroundColor: 'rgba(255,50,50,0.8)' },
  recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#666', marginRight: 8 },
  recordDotActive: { backgroundColor: '#ff0000' },
  statusText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  deviceInfo: { alignItems: 'center' },
  deviceName: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  deviceLocation: { color: '#aaa', fontSize: 12 },
  motionCounter: {
    backgroundColor: 'rgba(0,0,0,0.6)', padding: 8,
    borderRadius: 6, alignSelf: 'flex-start'
  },
  motionCountText: { color: '#00ff88', fontSize: 12 },
  controls: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingBottom: 20,
  },
  controlBtn: {
    alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 12, borderRadius: 8, minWidth: 80,
  },
  controlBtnActive: { backgroundColor: 'rgba(0,255,136,0.3)', borderWidth: 1, borderColor: '#00ff88' },
  controlIcon: { fontSize: 24 },
  controlText: { color: '#fff', fontSize: 10, marginTop: 4, textAlign: 'center' },
});
