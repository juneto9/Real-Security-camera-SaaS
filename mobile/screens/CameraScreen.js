import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, Dimensions, Platform, AppState,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { useAuth } from '../AuthContext';
import { connectAndPublish, disconnectRooms, startEgressRecording, stopEgressRecording } from '../lib/livekit';
import { generateSessionId } from '../lib/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SW, height: SH } = Dimensions.get('window');

// Clip lengths in seconds, by mode
const DASHCAM_CLIPS = [
  { label: '30s', value: 30 },
  { label: '1m',  value: 60 },
  { label: '5m',  value: 300 },
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
];
const SECURITY_CLIPS = [
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '1m',  value: 60 },
  { label: '3m',  value: 180 },
  { label: '5m',  value: 300 },
];

export default function CameraScreen({ navigation }) {
  useKeepAwake(); // prevent screen sleep while camera is active

  const { user, org } = useAuth();

  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  // Camera state
  const [mode, setMode] = useState('dashcam');           // 'dashcam' | 'security'
  const [pipFacing, setPipFacing] = useState('front');   // which camera is in the PiP (small) view
  const [nightVision, setNightVision] = useState(false);
  const [clipLength, setClipLength] = useState(60);      // seconds
  const [isLive, setIsLive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [streamStatus, setStreamStatus] = useState({ rear: 'idle', front: 'idle' });
  const [clipCount, setClipCount] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  const [showClipPicker, setShowClipPicker] = useState(false);
  const [showModeInfo, setShowModeInfo] = useState(false);

  const roomsRef = useRef(null);
  const clipTimerRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // Restore saved clip length preference
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem('rsc_clip_length');
      const savedMode = await AsyncStorage.getItem('rsc_cam_mode');
      if (saved) setClipLength(parseInt(saved, 10));
      if (savedMode) setMode(savedMode);
    })();
  }, []);

  // Handle app going to background — keep streams alive
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      // streams continue via LiveKit even in background
      // recording continues via egress on the server side
    });
    return () => sub.remove();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
    };
  }, []);

  const requestPermissions = async () => {
    const cam = await requestCamPermission();
    const mic = await requestMicPermission();
    return cam.granted && mic.granted;
  };

  const handleStateChange = useCallback(({ camera, state }) => {
    setStreamStatus((prev) => ({ ...prev, [camera]: state }));
  }, []);

  const startCamera = async () => {
    const ok = await requestPermissions();
    if (!ok) {
      Alert.alert('Permissions Required', 'Camera and microphone access are needed to stream.');
      return;
    }
    if (!org?.id || !user?.id) {
      Alert.alert('Not Ready', 'Organization info not loaded. Try logging out and back in.');
      return;
    }

    try {
      const newSessionId = generateSessionId();
      setSessionId(newSessionId);
      setIsLive(true);
      setStreamStatus({ rear: 'connecting', front: 'connecting' });

      const rooms = await connectAndPublish({
        orgId: org.id,
        deviceId: user.id, // use user ID as device ID for phone cameras
        userId: user.id,
        onStateChange: handleStateChange,
      });
      roomsRef.current = rooms;

      // Start server-side egress recording
      await startEgressRecording({
        orgId: org.id,
        deviceId: user.id,
        clipLength,
        mode,
      });

      setIsRecording(true);
      setClipCount(0);
      startClipCounter();
    } catch (e) {
      console.error('Camera start error:', e);
      setIsLive(false);
      setStreamStatus({ rear: 'idle', front: 'idle' });
      Alert.alert('Stream Error', e.message || 'Could not connect to RSC cloud. Check your connection.');
    }
  };

  const stopAll = async () => {
    clearInterval(clipTimerRef.current);
    try {
      if (isRecording && user?.id) {
        await stopEgressRecording({ deviceId: user.id });
      }
      if (roomsRef.current) {
        await disconnectRooms(roomsRef.current);
        roomsRef.current = null;
      }
    } catch (e) {
      console.warn('Stop error:', e);
    }
    setIsLive(false);
    setIsRecording(false);
    setStreamStatus({ rear: 'idle', front: 'idle' });
    setSessionId(null);
  };

  // Track clip count based on clip length timer
  const startClipCounter = () => {
    clearInterval(clipTimerRef.current);
    clipTimerRef.current = setInterval(() => {
      setClipCount((c) => c + 1);
    }, clipLength * 1000);
  };

  const swapCameras = () => {
    setPipFacing((f) => (f === 'front' ? 'rear' : 'front'));
  };

  const setClipLengthAndSave = async (val) => {
    setClipLength(val);
    setShowClipPicker(false);
    await AsyncStorage.setItem('rsc_clip_length', String(val));
  };

  const setModeAndSave = async (m) => {
    setMode(m);
    await AsyncStorage.setItem('rsc_cam_mode', m);
    // Reset clip length to mode default
    const defaultClip = m === 'dashcam' ? 60 : 30;
    setClipLength(defaultClip);
    await AsyncStorage.setItem('rsc_clip_length', String(defaultClip));
  };

  const clipOptions = mode === 'dashcam' ? DASHCAM_CLIPS : SECURITY_CLIPS;
  const mainFacing = pipFacing === 'front' ? 'back' : 'front';
  const pipFacingExpo = pipFacing === 'front' ? 'front' : 'back';

  const nightStyle = nightVision ? {
    filter: Platform.OS === 'ios' ? undefined : undefined, // applied via overlay
  } : {};

  return (
    <View style={s.root}>
      {/* ── Main Camera Feed ── */}
      <View style={s.mainCam}>
        {(camPermission?.granted) ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing={mainFacing}
            videoQuality="1080p"
            mode="video"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.permWall]}>
            <Text style={s.permText}>Camera permission needed</Text>
          </View>
        )}

        {/* Night Vision Overlay */}
        {nightVision && (
          <View style={s.nightOverlay} pointerEvents="none" />
        )}

        {/* Status Bar Top */}
        <View style={s.topBar}>
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
            <Text style={s.backBtnText}>←</Text>
          </TouchableOpacity>

          <View style={s.statusPills}>
            {isLive && (
              <View style={s.livePill}>
                <View style={s.liveDot} />
                <Text style={s.liveText}>LIVE</Text>
              </View>
            )}
            {isRecording && (
              <View style={s.recPill}>
                <Text style={s.recText}>⬤ REC</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[s.nvBtn, nightVision && s.nvBtnActive]}
            onPress={() => setNightVision((v) => !v)}
          >
            <Text style={s.nvIcon}>🌙</Text>
          </TouchableOpacity>
        </View>

        {/* Clip counter */}
        {isRecording && (
          <View style={s.clipCounter}>
            <Text style={s.clipCounterText}>
              {clipCount} clip{clipCount !== 1 ? 's' : ''} saved · {formatClip(clipLength)} each
            </Text>
          </View>
        )}

        {/* Stream status */}
        <View style={s.streamStatus}>
          <Text style={s.streamStatusText}>
            ↑ Rear: {streamStatus.rear}  |  Front: {streamStatus.front}
          </Text>
        </View>
      </View>

      {/* ── PiP Camera (corner) ── */}
      <TouchableOpacity style={s.pip} onPress={swapCameras} activeOpacity={0.85}>
        {camPermission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing={pipFacingExpo}
            videoQuality="720p"
            mode="video"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111' }]} />
        )}
        {nightVision && <View style={s.pipNightOverlay} pointerEvents="none" />}
        <View style={s.pipLabel}>
          <Text style={s.pipLabelText}>{pipFacing === 'front' ? '👁 FRONT' : '🔒 REAR'}</Text>
        </View>
        <View style={s.pipSwapHint}>
          <Text style={s.pipSwapHintText}>tap to swap</Text>
        </View>
      </TouchableOpacity>

      {/* ── Bottom Controls ── */}
      <View style={s.controls}>

        {/* Mode Toggle */}
        <View style={s.modeRow}>
          {['dashcam', 'security'].map((m) => (
            <TouchableOpacity
              key={m}
              style={[s.modeBtn, mode === m && s.modeBtnActive]}
              onPress={() => !isLive && setModeAndSave(m)}
            >
              <Text style={[s.modeBtnText, mode === m && s.modeBtnTextActive]}>
                {m === 'dashcam' ? '🚗 Dashcam' : '🏠 Security'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Clip Length */}
        <TouchableOpacity
          style={s.clipRow}
          onPress={() => !isLive && setShowClipPicker((v) => !v)}
        >
          <Text style={s.clipRowText}>
            Clip length: <Text style={s.clipRowVal}>{formatClip(clipLength)}</Text>
            {!isLive && <Text style={s.clipRowEdit}> ✏️</Text>}
          </Text>
        </TouchableOpacity>

        {/* Clip Picker */}
        {showClipPicker && !isLive && (
          <View style={s.clipPicker}>
            {clipOptions.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[s.clipOpt, clipLength === opt.value && s.clipOptActive]}
                onPress={() => setClipLengthAndSave(opt.value)}
              >
                <Text style={[s.clipOptText, clipLength === opt.value && s.clipOptTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Main Action Button */}
        <TouchableOpacity
          style={[s.mainBtn, isLive ? s.mainBtnStop : s.mainBtnStart]}
          onPress={isLive ? stopAll : startCamera}
        >
          <Text style={s.mainBtnText}>
            {isLive ? '⬛ Stop Streaming' : '▶ Start Streaming'}
          </Text>
        </TouchableOpacity>

        <Text style={s.cloudNote}>☁️ Always saving to RSC Cloud · Never auto-deleted</Text>
      </View>
    </View>
  );
}

function formatClip(secs) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${secs / 60}m`;
  return `${secs / 3600}h`;
}

const PIP_W = 120;
const PIP_H = 160;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // Main camera fills full screen
  mainCam: { flex: 1, backgroundColor: '#000' },

  nightOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 255, 80, 0.12)',
  },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backBtn: { padding: 8 },
  backBtnText: { color: '#fff', fontSize: 22 },
  statusPills: { flexDirection: 'row', gap: 8 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#E02020', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  recPill: {
    backgroundColor: '#111', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  recText: { color: '#E02020', fontWeight: '700', fontSize: 12 },
  nvBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  nvBtnActive: { backgroundColor: 'rgba(0,255,80,0.3)' },
  nvIcon: { fontSize: 18 },

  clipCounter: {
    position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center',
  },
  clipCounterText: {
    color: 'rgba(255,255,255,0.7)', fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  streamStatus: {
    position: 'absolute', top: Platform.OS === 'ios' ? 110 : 90,
    left: 0, right: 0, alignItems: 'center',
  },
  streamStatusText: {
    color: 'rgba(255,255,255,0.5)', fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
  },

  // PiP overlay
  pip: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : 100,
    right: 14,
    width: PIP_W, height: PIP_H,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 2, borderColor: '#E02020',
    backgroundColor: '#111',
  },
  pipNightOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,255,80,0.12)',
  },
  pipLabel: {
    position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center',
  },
  pipLabelText: {
    color: '#fff', fontSize: 10, fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
  },
  pipSwapHint: {
    position: 'absolute', bottom: 5, left: 0, right: 0, alignItems: 'center',
  },
  pipSwapHintText: {
    color: 'rgba(255,255,255,0.5)', fontSize: 9,
  },

  // Bottom controls
  controls: {
    backgroundColor: 'rgba(10,10,10,0.95)',
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    paddingHorizontal: 20, paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
  },
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  modeBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 8,
    borderWidth: 1, borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  modeBtnActive: { borderColor: '#E02020', backgroundColor: 'rgba(224,32,32,0.1)' },
  modeBtnText: { color: '#666', fontWeight: '600', fontSize: 14 },
  modeBtnTextActive: { color: '#E02020' },

  clipRow: {
    alignItems: 'center', paddingVertical: 8, marginBottom: 4,
  },
  clipRowText: { color: '#888', fontSize: 13 },
  clipRowVal: { color: '#fff', fontWeight: '600' },
  clipRowEdit: { color: '#E02020' },

  clipPicker: {
    flexDirection: 'row', gap: 8, justifyContent: 'center',
    marginBottom: 12, flexWrap: 'wrap',
  },
  clipOpt: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 16, borderWidth: 1, borderColor: '#2a2a2a',
  },
  clipOptActive: { borderColor: '#E02020', backgroundColor: 'rgba(224,32,32,0.15)' },
  clipOptText: { color: '#666', fontSize: 13 },
  clipOptTextActive: { color: '#E02020', fontWeight: '700' },

  mainBtn: {
    borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 6, marginBottom: 10,
  },
  mainBtnStart: { backgroundColor: '#E02020' },
  mainBtnStop: { backgroundColor: '#222', borderWidth: 1, borderColor: '#E02020' },
  mainBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },

  cloudNote: {
    color: '#333', fontSize: 11, textAlign: 'center',
  },

  permWall: { justifyContent: 'center', alignItems: 'center' },
  permText: { color: '#888', fontSize: 16 },
});
