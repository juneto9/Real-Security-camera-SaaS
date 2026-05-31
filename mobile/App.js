/**
 * Real Security Camera — Mobile App
 * React Native / Expo
 *
 * Screens:
 *   Login / Register
 *   Dashboard (tabs: Cameras | Camera | Clips | Events)
 *   CameraScreen  — phone as security camera (broadcaster)
 *   ViewerScreen  — watch a remote camera live (WebRTC viewer)
 */

import { registerRootComponent } from 'expo';
import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, FlatList, ScrollView,
  KeyboardAvoidingView, Platform, Switch, Dimensions,
  AppState, Vibration,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, CameraType, FlashMode } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import { KeepAwake } from 'expo-keep-awake';
import { Accelerometer } from 'expo-sensors';
import { Audio } from 'expo-av';
import axios from 'axios';
import { io } from 'socket.io-client';

// ─── Constants ────────────────────────────────────────────────────
const API_URL = 'https://whale-app-hxokg.ondigitalocean.app';
const { width: SW, height: SH } = Dimensions.get('window');

const C = {
  bg:      '#0a0a0a',
  card:    '#141414',
  border:  '#222',
  green:   '#00ff88',
  red:     '#ff4444',
  blue:    '#4488ff',
  gold:    '#ffd700',
  text:    '#ffffff',
  sub:     '#666666',
  darkGreen: '#003322',
};

// ─── API Client ───────────────────────────────────────────────────
const api = axios.create({ baseURL: API_URL, timeout: 15000 });
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Notification Setup ───────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// ─── Helpers ──────────────────────────────────────────────────────
function decodeToken(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob ? atob(payload) : Buffer.from(payload, 'base64').toString());
  } catch { return {}; }
}

async function sendLocalNotification(title, body) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null,
  });
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════
function LoginScreen({ navigation, onLogin }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  const login = async () => {
    if (!email || !password) return Alert.alert('Error', 'Enter email and password');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login', { email, password });
      const token = res.data.data.accessToken;
      await AsyncStorage.setItem('accessToken', token);
      onLogin(token);
    } catch (e) {
      Alert.alert('Login Failed', e.response?.data?.message || 'Check credentials');
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={s.center} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={s.appTitle}>🔒 Real Security Camera</Text>
      <Text style={s.appSub}>Enterprise Security System</Text>
      <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.sub}
        value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.sub}
        value={password} onChangeText={setPassword} secureTextEntry />
      <TouchableOpacity style={s.btnGreen} onPress={login} disabled={loading}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnGreenTxt}>Login</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Register')}>
        <Text style={s.link}>Don't have an account? Register</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REGISTER SCREEN
// ═══════════════════════════════════════════════════════════════════
function RegisterScreen({ navigation, onLogin }) {
  const [form, setForm] = useState({
    email: '', password: '', first_name: '', last_name: '', org_name: '',
  });
  const [loading, setLoading] = useState(false);

  const register = async () => {
    if (!form.email || !form.password || !form.first_name || !form.last_name)
      return Alert.alert('Error', 'Fill all fields');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/register', form);
      const token = res.data.data.accessToken;
      await AsyncStorage.setItem('accessToken', token);
      onLogin(token);
    } catch (e) {
      Alert.alert('Failed', e.response?.data?.message || 'Try again');
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={s.center} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={s.appTitle}>🔒 Real Security Camera</Text>
      <Text style={s.appSub}>Create Account</Text>
      {[
        { key: 'first_name', label: 'First Name' },
        { key: 'last_name',  label: 'Last Name' },
        { key: 'email',      label: 'Email', keyboard: 'email-address', cap: 'none' },
        { key: 'org_name',   label: 'Organization Name' },
      ].map(f => (
        <TextInput key={f.key} style={s.input} placeholder={f.label} placeholderTextColor={C.sub}
          value={form[f.key]} onChangeText={v => setForm(p => ({ ...p, [f.key]: v }))}
          keyboardType={f.keyboard || 'default'} autoCapitalize={f.cap || 'words'} />
      ))}
      <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.sub}
        value={form.password} onChangeText={v => setForm(p => ({ ...p, password: v }))} secureTextEntry />
      <TouchableOpacity style={s.btnGreen} onPress={register} disabled={loading}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnGreenTxt}>Create Account</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={s.link}>Already have an account? Login</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CAMERA SCREEN — Phone as Security Camera
// ═══════════════════════════════════════════════════════════════════
function CameraScreen({ user, socket, devices }) {
  const [hasPermission,  setHasPermission]  = useState(null);
  const [facing,         setFacing]         = useState(CameraType.back);
  const [recording,      setRecording]      = useState(false);
  const [armed,          setArmed]          = useState(false);
  const [isLinked,       setIsLinked]       = useState(false);
  const [linkedDevice,   setLinkedDevice]   = useState(null);
  const [recordMode,     setRecordMode]     = useState('security'); // 'security' | 'dashcam'
  const [clipDuration,   setClipDuration]   = useState(60);
  const [motionEnabled,  setMotionEnabled]  = useState(true);
  const [soundEnabled,   setSoundEnabled]   = useState(true);
  const [nightVision,    setNightVision]    = useState(false);
  const [statusMsg,      setStatusMsg]      = useState('Ready');
  const [events,         setEvents]         = useState([]);
  const [viewers,        setViewers]        = useState(0);

  const cameraRef    = useRef(null);
  const socketRef    = useRef(null);
  const isArmedRef   = useRef(false);
  const recordingRef = useRef(false);
  const pcsRef       = useRef({});
  const accelSub     = useRef(null);
  const lastMotion   = useRef(0);

  // Request permissions
  useEffect(() => {
    (async () => {
      const cam = await Camera.requestCameraPermissionsAsync();
      const mic = await Camera.requestMicrophonePermissionsAsync();
      const med = await MediaLibrary.requestPermissionsAsync();
      const notif = await Notifications.requestPermissionsAsync();
      setHasPermission(cam.granted && mic.granted);
    })();
  }, []);

  // Auto-link to first device
  useEffect(() => {
    if (devices.length > 0 && !linkedDevice) {
      setLinkedDevice(devices[0]);
    }
  }, [devices]);

  // Connect camera socket when linked
  useEffect(() => {
    if (!linkedDevice || !user) return;
    connectCameraSocket();
    return () => disconnectCameraSocket();
  }, [linkedDevice]);

  const connectCameraSocket = async () => {
    const token = await AsyncStorage.getItem('accessToken');
    if (!token) return;

    const s = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    s.on('connect', () => {
      console.log('📡 Camera socket connected:', s.id);
      s.emit('auth', {
        deviceId: linkedDevice.id,
        deviceName: linkedDevice.device_name || linkedDevice.name,
        role: 'camera',
        organizationId: user.organizationId,
        userId: user.userId,
      });
      setIsLinked(true);
      setStatusMsg('🟢 Online — ready');
    });

    s.on('viewer:request', async ({ viewerSocketId }) => {
      console.log('📺 Viewer requesting stream:', viewerSocketId);
      setViewers(v => v + 1);
      setStatusMsg('👁 Viewer connected');
      // Note: WebRTC from React Native requires react-native-webrtc
      // For now emit a placeholder — full WebRTC in Phase 2
      s.emit('camera:online', {
        deviceId: linkedDevice.id,
        deviceName: linkedDevice.device_name,
      });
    });

    s.on('camera:command', ({ command, params }) => {
      console.log('📡 Command received:', command, params);
      if (command === 'arm') handleRemoteArm(params);
      if (command === 'disarm') handleRemoteDisarm();
    });

    s.on('disconnect', () => {
      setIsLinked(false);
      setStatusMsg('⚠️ Disconnected — reconnecting...');
    });

    socketRef.current = s;
  };

  const disconnectCameraSocket = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  const handleRemoteArm = (params = {}) => {
    if (params.clipDuration) setClipDuration(params.clipDuration);
    if (params.motionEnabled !== undefined) setMotionEnabled(params.motionEnabled);
    if (params.soundEnabled !== undefined) setSoundEnabled(params.soundEnabled);
    armCamera();
  };

  const handleRemoteDisarm = () => {
    disarmCamera();
  };

  // ── Arm / Disarm ──────────────────────────────────────────────
  const armCamera = () => {
    setArmed(true);
    isArmedRef.current = true;
    setStatusMsg('🟢 Armed — monitoring...');
    if (motionEnabled) startMotionDetection();
    sendLocalNotification('Real Security Camera', 'Camera armed — monitoring started');
    Vibration.vibrate(200);
  };

  const disarmCamera = () => {
    setArmed(false);
    isArmedRef.current = false;
    stopMotionDetection();
    if (recordingRef.current) stopRecording();
    setStatusMsg('🟢 Online — ready');
    Vibration.vibrate(100);
  };

  // ── Motion Detection (Accelerometer) ─────────────────────────
  const startMotionDetection = () => {
    Accelerometer.setUpdateInterval(500);
    accelSub.current = Accelerometer.addListener(({ x, y, z }) => {
      if (!isArmedRef.current) return;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (magnitude > 1.3 && now - lastMotion.current > 30000) {
        lastMotion.current = now;
        triggerAlert('motion');
      }
    });
  };

  const stopMotionDetection = () => {
    if (accelSub.current) {
      accelSub.current.remove();
      accelSub.current = null;
    }
  };

  // ── Alert Trigger ─────────────────────────────────────────────
  const triggerAlert = async (type) => {
    const event = {
      id: Date.now(),
      type,
      time: new Date().toLocaleTimeString(),
      deviceName: linkedDevice?.device_name || 'Phone Camera',
      clip_url: null,
      clip_pending: true,
    };
    setEvents(ev => [event, ...ev].slice(0, 50));
    setStatusMsg(`⚠️ ${type === 'motion' ? 'Motion' : 'Sound'} detected! Recording...`);
    Vibration.vibrate([0, 200, 100, 200]);
    sendLocalNotification(
      '🚨 Security Alert',
      `${type === 'motion' ? 'Motion' : 'Sound'} detected — ${linkedDevice?.device_name || 'Camera'}`
    );

    // Emit to server
    if (socketRef.current) {
      socketRef.current.emit('motion:detected', {
        deviceId: linkedDevice?.id,
        type,
        timestamp: new Date().toISOString(),
      });
    }

    // Start recording
    if (!recordingRef.current) {
      await startRecording(event.id);
    }
  };

  // ── Recording ─────────────────────────────────────────────────
  const startRecording = async (eventId = null) => {
    if (!cameraRef.current || recordingRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    setStatusMsg('🔴 Recording...');

    try {
      const video = await cameraRef.current.recordAsync({
        maxDuration: clipDuration,
        quality: '720p',
        mute: false,
      });

      recordingRef.current = false;
      setRecording(false);
      setStatusMsg(isArmedRef.current ? '🟢 Armed — monitoring...' : '🟢 Online — ready');

      if (video?.uri) {
        await saveClip(video.uri, eventId);
      }
    } catch (e) {
      recordingRef.current = false;
      setRecording(false);
      console.log('Recording error:', e.message);
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && recordingRef.current) {
      cameraRef.current.stopRecording();
    }
  };

  const saveClip = async (uri, eventId) => {
    try {
      // Save to media library
      await MediaLibrary.saveToLibraryAsync(uri);

      // Upload to backend
      const filename = `clip_${linkedDevice?.id}_${Date.now()}.mp4`;
      const formData = new FormData();
      formData.append('clip', {
        uri,
        name: filename,
        type: 'video/mp4',
      });
      formData.append('deviceId', linkedDevice?.id || '');
      formData.append('organizationId', user?.organizationId || '');
      formData.append('filename', filename);
      if (eventId) formData.append('eventId', String(eventId));

      const res = await api.post('/api/recordings/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });

      if (res.data?.url && eventId) {
        setEvents(ev => ev.map(e =>
          e.id === eventId ? { ...e, clip_url: res.data.url, clip_pending: false } : e
        ));
      }
      setStatusMsg('☁️ Clip uploaded');
    } catch (e) {
      console.log('Save clip error:', e.message);
      setStatusMsg('⬇️ Saved locally');
    }
  };

  // ── Render ────────────────────────────────────────────────────
  if (hasPermission === null) {
    return <View style={s.center}><ActivityIndicator color={C.green} size="large" /></View>;
  }

  if (hasPermission === false) {
    return (
      <View style={s.center}>
        <Text style={{ color: C.red, fontSize: 18, textAlign: 'center', margin: 20 }}>
          Camera & microphone permission required.{'\n'}Please enable in Settings.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {armed && <KeepAwake />}

      {/* Camera Preview */}
      <View style={{ flex: 1, position: 'relative' }}>
        <Camera
          ref={cameraRef}
          style={{ flex: 1 }}
          type={facing}
          flashMode={FlashMode.off}
        >
          {/* Night Vision Overlay */}
          {nightVision && (
            <View style={{
              ...StyleSheet.absoluteFillObject,
              backgroundColor: 'rgba(0,20,0,0.5)',
            }} />
          )}

          {/* Status Bar */}
          <View style={{
            position: 'absolute', top: 50, left: 0, right: 0,
            flexDirection: 'row', justifyContent: 'space-between',
            paddingHorizontal: 16,
          }}>
            <View style={{
              backgroundColor: 'rgba(0,0,0,0.7)',
              paddingHorizontal: 12, paddingVertical: 6,
              borderRadius: 20,
              flexDirection: 'row', alignItems: 'center', gap: 6,
            }}>
              <View style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: isLinked ? C.green : C.red,
              }} />
              <Text style={{ color: C.text, fontSize: 12 }}>
                {isLinked ? 'LIVE' : 'OFFLINE'}
              </Text>
              {viewers > 0 && (
                <Text style={{ color: C.gold, fontSize: 12 }}>👁 {viewers}</Text>
              )}
            </View>
            {recording && (
              <View style={{
                backgroundColor: 'rgba(255,0,0,0.8)',
                paddingHorizontal: 12, paddingVertical: 6,
                borderRadius: 20, flexDirection: 'row', alignItems: 'center',
              }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', marginRight: 6 }} />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>REC</Text>
              </View>
            )}
          </View>

          {/* Status Message */}
          <View style={{
            position: 'absolute', bottom: 20, left: 0, right: 0,
            alignItems: 'center',
          }}>
            <Text style={{
              color: C.text, fontSize: 13,
              backgroundColor: 'rgba(0,0,0,0.6)',
              paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12,
            }}>
              {statusMsg}
            </Text>
          </View>
        </Camera>
      </View>

      {/* Controls */}
      <View style={{ backgroundColor: C.card, padding: 16 }}>

        {/* Device selector */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ color: C.sub, fontSize: 12 }}>
            📍 {linkedDevice?.device_name || 'No device linked'}
          </Text>
          <TouchableOpacity onPress={() => setFacing(f =>
            f === CameraType.back ? CameraType.front : CameraType.back
          )}>
            <Text style={{ color: C.blue, fontSize: 13 }}>🔄 Flip</Text>
          </TouchableOpacity>
        </View>

        {/* Mode Tabs */}
        <View style={{ flexDirection: 'row', backgroundColor: C.bg, borderRadius: 8, padding: 3, marginBottom: 12 }}>
          {[
            { id: 'security', label: '🔒 Security' },
            { id: 'dashcam',  label: '🚗 Dashcam' },
          ].map(m => (
            <TouchableOpacity key={m.id}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center',
                backgroundColor: recordMode === m.id ? C.green : 'transparent',
              }}
              onPress={() => setRecordMode(m.id)}
            >
              <Text style={{ color: recordMode === m.id ? '#000' : C.sub, fontWeight: '600', fontSize: 13 }}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Clip Duration */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: C.sub, fontSize: 12, alignSelf: 'center' }}>Clip Duration</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[30, 60, 300, 900].map(d => (
              <TouchableOpacity key={d}
                style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
                  backgroundColor: clipDuration === d ? C.green : C.bg,
                  borderWidth: 1, borderColor: clipDuration === d ? C.green : C.border,
                }}
                onPress={() => setClipDuration(d)}
              >
                <Text style={{ color: clipDuration === d ? '#000' : C.text, fontSize: 11 }}>
                  {d < 60 ? `${d}s` : `${d/60}m`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Toggles Row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 }}>
          {[
            { label: '👁 Motion', value: motionEnabled, onChange: setMotionEnabled },
            { label: '🔊 Sound',  value: soundEnabled,  onChange: setSoundEnabled  },
            { label: '🌙 Night',  value: nightVision,   onChange: setNightVision   },
          ].map(t => (
            <View key={t.label} style={{ alignItems: 'center' }}>
              <Switch
                value={t.value}
                onValueChange={t.onChange}
                trackColor={{ false: C.border, true: C.green }}
                thumbColor={t.value ? '#fff' : C.sub}
              />
              <Text style={{ color: C.sub, fontSize: 10, marginTop: 4 }}>{t.label}</Text>
            </View>
          ))}
        </View>

        {/* Main Action Button */}
        {!armed ? (
          <TouchableOpacity style={[s.btnGreen, { marginBottom: 8 }]} onPress={armCamera}>
            <Text style={s.btnGreenTxt}>🟢 Start Monitoring</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[s.btnRed, { marginBottom: 8 }]} onPress={disarmCamera}>
            <Text style={s.btnRedTxt}>🔴 Stop Monitoring</Text>
          </TouchableOpacity>
        )}

        {/* Manual Record Button */}
        {armed && (
          <TouchableOpacity
            style={{
              borderWidth: 1,
              borderColor: recording ? C.red : C.border,
              borderRadius: 8, padding: 12, alignItems: 'center',
            }}
            onPress={() => recording ? stopRecording() : startRecording()}
          >
            <Text style={{ color: recording ? C.red : C.text, fontSize: 13 }}>
              {recording ? '⏹ Stop Recording' : '⏺ Record Now'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CAMERAS TAB — View enrolled cameras, watch live
// ═══════════════════════════════════════════════════════════════════
function CamerasTab({ user, socket, devices, onlineMap, navigation }) {
  const [loading, setLoading] = useState(false);

  if (devices.length === 0) {
    return (
      <View style={[s.center, { backgroundColor: C.bg }]}>
        <Text style={{ fontSize: 48 }}>📷</Text>
        <Text style={{ color: C.text, fontSize: 18, marginTop: 16 }}>No cameras enrolled</Text>
        <Text style={{ color: C.sub, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>
          Add cameras from the web dashboard or use the + button
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12 }}
      data={devices}
      keyExtractor={d => d.id}
      renderItem={({ item: d }) => {
        const online = onlineMap[d.id]?.online || d.is_active;
        return (
          <View style={[s.card, { marginBottom: 12 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <View>
                <Text style={{ color: C.text, fontWeight: 'bold', fontSize: 15 }}>
                  {d.device_name || d.name}
                </Text>
                <Text style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>
                  📍 {d.location || 'No location'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? C.green : C.border }} />
                  <Text style={{ color: online ? C.green : C.sub, fontSize: 12 }}>
                    {online ? 'Online' : 'Offline'}
                  </Text>
                </View>
                <Text style={{ color: C.sub, fontSize: 10, marginTop: 4 }}>
                  🔒 Security Cam
                </Text>
              </View>
            </View>

            {/* Camera preview placeholder */}
            <View style={{
              height: 120, backgroundColor: '#0a0a0a', borderRadius: 8,
              justifyContent: 'center', alignItems: 'center', marginBottom: 10,
              borderWidth: 1, borderColor: C.border,
            }}>
              {online ? (
                <TouchableOpacity
                  onPress={() => navigation.navigate('LiveViewer', { device: d })}
                  style={{ alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 32 }}>▶</Text>
                  <Text style={{ color: C.green, fontSize: 13, marginTop: 4 }}>Tap to Watch Live</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <Text style={{ fontSize: 32 }}>📷</Text>
                  <Text style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>Offline</Text>
                </>
              )}
            </View>

            <TouchableOpacity
              style={{
                backgroundColor: online ? C.green : C.border,
                borderRadius: 8, padding: 10, alignItems: 'center',
              }}
              onPress={() => online && navigation.navigate('LiveViewer', { device: d })}
              disabled={!online}
            >
              <Text style={{ color: online ? '#000' : C.sub, fontWeight: 'bold', fontSize: 13 }}>
                {online ? '▶ Watch Live' : 'Camera Offline'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
// CLIPS TAB
// ═══════════════════════════════════════════════════════════════════
function ClipsTab({ user }) {
  const [clips,   setClips]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadClips(); }, []);

  const loadClips = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/recordings');
      setClips(res.data.data || []);
    } catch (e) { console.log('Clips error:', e.message); }
    setLoading(false);
  };

  const deleteClip = async (id) => {
    Alert.alert('Delete Clip', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/api/recordings/${id}`);
          setClips(c => c.filter(x => x.id !== id));
        } catch (e) { Alert.alert('Error', 'Delete failed'); }
      }},
    ]);
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.green} /></View>;

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12 }}
      data={clips}
      keyExtractor={c => c.id}
      ListEmptyComponent={
        <View style={s.center}>
          <Text style={{ fontSize: 48 }}>🎬</Text>
          <Text style={{ color: C.text, fontSize: 18, marginTop: 16 }}>No clips yet</Text>
          <Text style={{ color: C.sub, marginTop: 8 }}>Start monitoring to record clips</Text>
        </View>
      }
      renderItem={({ item: clip }) => (
        <View style={[s.card, { marginBottom: 8, flexDirection: 'row', alignItems: 'center' }]}>
          <View style={{
            width: 60, height: 60, backgroundColor: '#0a0a0a', borderRadius: 6,
            justifyContent: 'center', alignItems: 'center', marginRight: 12,
          }}>
            <Text style={{ fontSize: 24 }}>🎬</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
              {clip.filename}
            </Text>
            <Text style={{ color: C.sub, fontSize: 11, marginTop: 2 }}>
              {new Date(clip.created_at).toLocaleString()} • {formatSize(clip.size)}
            </Text>
          </View>
          <TouchableOpacity onPress={() => deleteClip(clip.id)} style={{ padding: 8 }}>
            <Text style={{ color: C.red, fontSize: 16 }}>🗑</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
// EVENTS TAB
// ═══════════════════════════════════════════════════════════════════
function EventsTab({ events }) {
  const todayEvents = events.filter(e => {
    const today = new Date().toDateString();
    return new Date(e.id).toDateString() === today;
  });

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12 }}
      data={todayEvents}
      keyExtractor={e => String(e.id)}
      ListHeaderComponent={
        <View style={{ marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: 'bold' }}>
            Today's Events
          </Text>
          <View style={{
            backgroundColor: C.red, borderRadius: 12,
            paddingHorizontal: 8, paddingVertical: 2,
          }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
              {todayEvents.length}
            </Text>
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={s.center}>
          <Text style={{ fontSize: 48 }}>🔔</Text>
          <Text style={{ color: C.text, fontSize: 18, marginTop: 16 }}>No events today</Text>
          <Text style={{ color: C.sub, marginTop: 8 }}>Events appear when motion or sound is detected</Text>
        </View>
      }
      renderItem={({ item: e }) => (
        <View style={[s.card, { marginBottom: 8, flexDirection: 'row', alignItems: 'center' }]}>
          <Text style={{ fontSize: 24, marginRight: 12 }}>
            {e.type === 'motion' ? '👁' : '🔊'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: 'bold', fontSize: 13 }}>
              {e.type === 'motion' ? 'Motion Detected' : 'Sound Detected'}
            </Text>
            <Text style={{ color: C.green, fontSize: 12 }}>{e.deviceName}</Text>
            <Text style={{ color: C.sub, fontSize: 11, marginTop: 2 }}>{e.time}</Text>
          </View>
          {e.clip_url ? (
            <View style={{
              backgroundColor: C.darkGreen, borderRadius: 6,
              paddingHorizontal: 8, paddingVertical: 4,
              borderWidth: 1, borderColor: C.green,
            }}>
              <Text style={{ color: C.green, fontSize: 11 }}>▶ Clip</Text>
            </View>
          ) : e.clip_pending ? (
            <Text style={{ color: C.sub, fontSize: 11 }}>⏳</Text>
          ) : null}
        </View>
      )}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN DASHBOARD — Bottom Tab Navigator
// ═══════════════════════════════════════════════════════════════════
function Dashboard({ user, onLogout, navigation }) {
  const [devices,   setDevices]   = useState([]);
  const [onlineMap, setOnlineMap] = useState({});
  const [events,    setEvents]    = useState([]);
  const [socket,    setSocket]    = useState(null);

  useEffect(() => {
    loadDevices();
    connectViewerSocket();
    return () => socket?.disconnect();
  }, []);

  const loadDevices = async () => {
    try {
      const res = await api.get('/api/devices');
      setDevices(res.data.data || []);
    } catch (e) { console.log('Devices error:', e.message); }
  };

  const connectViewerSocket = async () => {
    const token = await AsyncStorage.getItem('accessToken');
    if (!token) return;

    const s = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    s.on('connect', () => {
      s.emit('auth', {
        userId: user.userId,
        organizationId: user.organizationId,
        role: 'viewer',
      });
    });

    s.on('camera:online', ({ deviceId, deviceName }) => {
      setOnlineMap(m => ({ ...m, [deviceId]: { online: true, name: deviceName } }));
    });

    s.on('camera:offline', ({ deviceId }) => {
      setOnlineMap(m => ({ ...m, [deviceId]: { online: false } }));
    });

    s.on('motion:detected', (data) => {
      const event = {
        id: Date.now(),
        type: data.type || 'motion',
        time: new Date().toLocaleTimeString(),
        deviceName: data.deviceName || 'Camera',
        clip_url: null,
        clip_pending: false,
      };
      setEvents(ev => [event, ...ev].slice(0, 100));
      sendLocalNotification(
        '🚨 Security Alert',
        `${event.type === 'motion' ? 'Motion' : 'Sound'} detected — ${event.deviceName}`
      );
    });

    setSocket(s);
  };

  const addEvent = (e) => setEvents(ev => [e, ...ev].slice(0, 100));

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: '#111', borderTopColor: C.border },
        tabBarActiveTintColor: C.green,
        tabBarInactiveTintColor: C.sub,
        tabBarLabel: route.name,
      })}
    >
      <Tab.Screen name="Camera" options={{ tabBarIcon: () => <Text>📷</Text> }}>
        {() => (
          <CameraScreen
            user={user}
            socket={socket}
            devices={devices}
            onEvent={addEvent}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Cameras" options={{ tabBarIcon: () => <Text>👁</Text> }}>
        {() => (
          <CamerasTab
            user={user}
            socket={socket}
            devices={devices}
            onlineMap={onlineMap}
            navigation={navigation}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Clips" options={{ tabBarIcon: () => <Text>🎬</Text> }}>
        {() => <ClipsTab user={user} />}
      </Tab.Screen>
      <Tab.Screen name="Events" options={{
        tabBarIcon: () => <Text>🔔</Text>,
        tabBarBadge: events.length > 0 ? events.length : undefined,
      }}>
        {() => <EventsTab events={events} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════
function App() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(null);
  const [user,  setUser]  = useState(null);

  useEffect(() => {
    AsyncStorage.getItem('accessToken').then(t => {
      if (t) {
        setToken(t);
        setUser(decodeToken(t));
      }
      setReady(true);
    });
  }, []);

  const handleLogin = (newToken) => {
    setToken(newToken);
    setUser(decodeToken(newToken));
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('accessToken');
    setToken(null);
    setUser(null);
  };

  if (!ready) {
    return (
      <View style={s.center}>
        <Text style={s.appTitle}>🔒 Real Security Camera</Text>
        <ActivityIndicator color={C.green} style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <>
            <Stack.Screen name="Login">
              {props => <LoginScreen {...props} onLogin={handleLogin} />}
            </Stack.Screen>
            <Stack.Screen name="Register">
              {props => <RegisterScreen {...props} onLogin={handleLogin} />}
            </Stack.Screen>
          </>
        ) : (
          <>
            <Stack.Screen name="Dashboard">
              {props => (
                <Dashboard {...props} user={user} onLogout={handleLogout} />
              )}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const s = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: C.bg,
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  appTitle: {
    color: C.green, fontSize: 26, fontWeight: 'bold', textAlign: 'center', marginBottom: 4,
  },
  appSub: {
    color: C.sub, fontSize: 13, textAlign: 'center', marginBottom: 28,
  },
  input: {
    backgroundColor: '#1a1a1a', color: C.text,
    padding: 14, borderRadius: 8, marginBottom: 10,
    fontSize: 15, borderWidth: 1, borderColor: C.border, width: '100%',
  },
  btnGreen: {
    backgroundColor: C.green, padding: 15,
    borderRadius: 8, alignItems: 'center', width: '100%', marginBottom: 10,
  },
  btnGreenTxt: { color: '#000', fontSize: 15, fontWeight: 'bold' },
  btnRed: {
    backgroundColor: C.red, padding: 15,
    borderRadius: 8, alignItems: 'center', width: '100%', marginBottom: 10,
  },
  btnRedTxt: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  link: { color: C.green, textAlign: 'center', marginTop: 8, fontSize: 14 },
  card: {
    backgroundColor: C.card, borderRadius: 10,
    padding: 14, borderWidth: 1, borderColor: C.border,
  },
});

registerRootComponent(App);
