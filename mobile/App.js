/**
 * Real Security Camera — Mobile App v3
 * Complete: Camera + WebRTC + Admin + Discovery + Themes
 *
 * TODO: ENABLE PAYWALL BEFORE PRODUCTION DEPLOY
 * Search "PAYWALL" to find all gated features
 */

import { registerRootComponent } from 'expo';
import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, FlatList, ScrollView,
  KeyboardAvoidingView, Platform, Switch, Dimensions,
  Vibration, Modal, SafeAreaView, StatusBar, Image,
  RefreshControl, PanResponder,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Accelerometer } from 'expo-sensors';
import { Audio } from 'expo-av';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  RTCPeerConnection, RTCIceCandidate, RTCSessionDescription,
  MediaStream, mediaDevices,
} from 'react-native-webrtc';
import Zeroconf from 'react-native-zeroconf';

// ─── Constants ────────────────────────────────────────────────────
const API_URL = 'https://whale-app-hxokg.ondigitalocean.app';
const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ─── Theme Definitions ────────────────────────────────────────────
const THEMES = {
  operator: {
    name: '🟢 Operator',
    bg: '#050505',
    card: '#0f0f0f',
    border: '#1a1a1a',
    primary: '#00ff88',
    secondary: '#003322',
    text: '#ffffff',
    sub: '#555555',
    red: '#ff3333',
    blue: '#00aaff',
    gold: '#ffd700',
    danger: '#ff4444',
    radius: 6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    cardShadow: { shadowColor: '#00ff88', shadowOpacity: 0.08, shadowRadius: 8 },
  },
  life360: {
    name: '🔵 Life360',
    bg: '#f0f2f5',
    card: '#ffffff',
    border: '#e0e0e0',
    primary: '#1a73e8',
    secondary: '#e8f0fe',
    text: '#1a1a1a',
    sub: '#888888',
    red: '#ea4335',
    blue: '#1a73e8',
    gold: '#fbbc04',
    danger: '#ea4335',
    radius: 16,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    cardShadow: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  },
  bubble: {
    name: '🍎 Bubble iOS',
    bg: '#f2f2f7',
    card: 'rgba(255,255,255,0.85)',
    border: 'rgba(0,0,0,0.06)',
    primary: '#007aff',
    secondary: '#e3f0ff',
    text: '#000000',
    sub: '#8e8e93',
    red: '#ff3b30',
    blue: '#007aff',
    gold: '#ff9500',
    danger: '#ff3b30',
    radius: 22,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-light',
    cardShadow: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, elevation: 2 },
  },
  custom: {
    name: '🎨 Custom',
    bg: '#0a0a0a',
    card: '#141414',
    border: '#222',
    primary: '#00ff88',
    secondary: '#003322',
    text: '#ffffff',
    sub: '#666',
    red: '#ff4444',
    blue: '#4488ff',
    gold: '#ffd700',
    danger: '#ff4444',
    radius: 10,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    cardShadow: {},
  },
};

// ─── Theme Context ────────────────────────────────────────────────
const ThemeContext = createContext(THEMES.operator);
const useTheme = () => useContext(ThemeContext);

// ─── API Client ───────────────────────────────────────────────────
const api = axios.create({ baseURL: API_URL, timeout: 15000 });
api.interceptors.request.use(async cfg => {
  const t = await AsyncStorage.getItem('accessToken');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true,
  }),
});

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// ─── Helpers ──────────────────────────────────────────────────────
function decodeJWT(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const pad = b64 + '=='.slice(0, (4 - b64.length % 4) % 4);
    return JSON.parse(atob(pad));
  } catch { return {}; }
}

async function notify(title, body) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    });
  } catch {}
}

// MAC OUI database for device identification
const OUI_MAP = {
  // Apple (iOS)
  '00:03:93': 'iOS', '00:0A:27': 'iOS', '00:0A:95': 'iOS',
  '00:1C:B3': 'iOS', '00:1E:52': 'iOS', '00:1F:5B': 'iOS',
  '00:21:E9': 'iOS', '00:23:12': 'iOS', '00:23:32': 'iOS',
  '00:23:6C': 'iOS', '00:25:00': 'iOS', '00:26:08': 'iOS',
  '00:26:B9': 'iOS', '04:0C:CE': 'iOS', '04:15:52': 'iOS',
  '04:26:65': 'iOS', '04:4B:ED': 'iOS', '04:52:F3': 'iOS',
  '04:54:53': 'iOS', '04:69:F8': 'iOS', '04:D3:CF': 'iOS',
  // Samsung (Android)
  '00:07:AB': 'Android', '00:12:47': 'Android', '00:15:99': 'Android',
  '00:17:D5': 'Android', '00:1A:8A': 'Android', '00:1B:98': 'Android',
  '00:1D:25': 'Android', '00:1E:E2': 'Android', '00:21:19': 'Android',
  '00:23:39': 'Android', '00:23:D6': 'Android', '00:24:54': 'Android',
  '00:25:66': 'Android', '00:26:37': 'Android', '04:18:0F': 'Android',
  // Google (Android)
  '00:1A:11': 'Android', 'F4:F5:D8': 'Android', '3C:5A:B4': 'Android',
  // Hikvision IP Camera
  '00:12:17': 'IPCamera', '44:19:B6': 'IPCamera', '4C:BD:8F': 'IPCamera',
  'BC:AD:28': 'IPCamera', 'C0:56:E3': 'IPCamera',
  // Dahua IP Camera
  '00:12:45': 'IPCamera', '28:57:BE': 'IPCamera', '34:E1:D0': 'IPCamera',
  'E0:50:8B': 'IPCamera',
  // Reolink
  'B4:A3:82': 'IPCamera', 'EC:71:DB': 'IPCamera',
  // Axis
  '00:40:8C': 'IPCamera', 'AC:CC:8E': 'IPCamera',
};

function identifyDevice(mac) {
  if (!mac) return 'Unknown';
  const prefix = mac.substring(0,8).toUpperCase();
  return OUI_MAP[prefix] || 'Unknown';
}

// ═══════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════
function ThemedCard({ children, style }) {
  const T = useTheme();
  return (
    <View style={[{
      backgroundColor: T.card,
      borderRadius: T.radius,
      borderWidth: 1,
      borderColor: T.border,
      padding: 14,
      ...T.cardShadow,
    }, style]}>
      {children}
    </View>
  );
}

function ThemedButton({ label, onPress, variant='primary', style, disabled }) {
  const T = useTheme();
  const bg = variant==='primary' ? T.primary
    : variant==='danger' ? T.danger
    : variant==='outline' ? 'transparent'
    : T.card;
  const color = variant==='primary' ? (T.name.includes('Operator') ? '#000' : '#fff')
    : variant==='danger' ? '#fff'
    : variant==='outline' ? T.primary
    : T.text;
  return (
    <TouchableOpacity
      style={[{
        backgroundColor: bg,
        borderRadius: T.radius,
        padding: 13,
        alignItems: 'center',
        borderWidth: variant==='outline' ? 1.5 : 0,
        borderColor: variant==='outline' ? T.primary : 'transparent',
        opacity: disabled ? 0.5 : 1,
      }, style]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={{ color, fontSize: 14, fontWeight: '700', fontFamily: T.fontFamily }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function StatusBadge({ online }) {
  const T = useTheme();
  return (
    <View style={{ flexDirection:'row', alignItems:'center', gap:5 }}>
      <View style={{ width:8, height:8, borderRadius:4,
        backgroundColor: online ? T.primary : T.border }} />
      <Text style={{ color: online ? T.primary : T.sub, fontSize:12, fontWeight:'600' }}>
        {online ? 'Online' : 'Offline'}
      </Text>
    </View>
  );
}

// In-app toast notification
function Toast({ message, visible }) {
  const T = useTheme();
  if (!visible) return null;
  return (
    <View style={{
      position:'absolute', bottom:100, left:16, right:16,
      backgroundColor: T.primary,
      borderRadius: T.radius,
      padding:14,
      flexDirection:'row', alignItems:'center', gap:10,
      shadowColor:'#000', shadowOpacity:0.3, shadowRadius:10,
      zIndex:999,
    }}>
      <Text style={{ fontSize:20 }}>🚨</Text>
      <Text style={{ color: T.name.includes('Operator') ? '#000' : '#fff',
        fontWeight:'bold', flex:1, fontSize:13 }}>
        {message}
      </Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AUTH SCREENS
// ═══════════════════════════════════════════════════════════════════
function LoginScreen({ navigation, onLogin }) {
  const T = useTheme();
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [busy,  setBusy]  = useState(false);

  const login = async () => {
    if (!email||!pass) return Alert.alert('Error','Enter email and password');
    setBusy(true);
    try {
      const r = await api.post('/api/auth/login', { email, password: pass });
      const tok = r.data.data.accessToken;
      await AsyncStorage.setItem('accessToken', tok);
      onLogin(tok);
    } catch(e) { Alert.alert('Login Failed', e.response?.data?.message||'Check credentials'); }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex:1, backgroundColor:T.bg, justifyContent:'center',
        alignItems:'center', padding:28 }}
      behavior={Platform.OS==='ios'?'padding':'height'}>
      <StatusBar barStyle={T.bg==='#f0f2f5'||T.bg==='#f2f2f7'?'dark-content':'light-content'}/>
      <Text style={{ fontSize:56, marginBottom:8 }}>🔒</Text>
      <Text style={{ color:T.primary, fontSize:26, fontWeight:'bold',
        textAlign:'center', fontFamily:T.fontFamily }}>
        Real Security Camera
      </Text>
      <Text style={{ color:T.sub, fontSize:13, textAlign:'center', marginBottom:32 }}>
        Enterprise Security System
      </Text>
      <TextInput style={[inputStyle(T), {marginBottom:10,width:'100%'}]}
        placeholder="Email" placeholderTextColor={T.sub}
        value={email} onChangeText={setEmail}
        keyboardType="email-address" autoCapitalize="none"/>
      <TextInput style={[inputStyle(T), {marginBottom:20,width:'100%'}]}
        placeholder="Password" placeholderTextColor={T.sub}
        value={pass} onChangeText={setPass} secureTextEntry/>
      <ThemedButton label={busy ? '...' : 'Login'} onPress={login}
        disabled={busy} style={{width:'100%',marginBottom:12}}/>
      <TouchableOpacity onPress={()=>navigation.navigate('Register')}>
        <Text style={{ color:T.primary, textAlign:'center', fontSize:14 }}>
          Don't have an account? Register
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

function RegisterScreen({ navigation, onLogin }) {
  const T = useTheme();
  const [form, setForm] = useState({
    email:'', password:'', first_name:'', last_name:'', org_name:'',
  });
  const [busy, setBusy] = useState(false);

  const register = async () => {
    if (!form.email||!form.password||!form.first_name||!form.last_name)
      return Alert.alert('Error','Fill all fields');
    setBusy(true);
    try {
      const r = await api.post('/api/auth/register', form);
      const tok = r.data.data.accessToken;
      await AsyncStorage.setItem('accessToken', tok);
      onLogin(tok);
    } catch(e) { Alert.alert('Failed', e.response?.data?.message||'Try again'); }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex:1, backgroundColor:T.bg, justifyContent:'center',
        alignItems:'center', padding:28 }}
      behavior={Platform.OS==='ios'?'padding':'height'}>
      <Text style={{ color:T.primary, fontSize:22, fontWeight:'bold',
        marginBottom:24, fontFamily:T.fontFamily }}>
        🔒 Create Account
      </Text>
      {[
        {k:'first_name',p:'First Name'},
        {k:'last_name', p:'Last Name'},
        {k:'email',     p:'Email',    kb:'email-address', cap:'none'},
        {k:'org_name',  p:'Organization Name'},
      ].map(f=>(
        <TextInput key={f.k} style={[inputStyle(T),{marginBottom:10,width:'100%'}]}
          placeholder={f.p} placeholderTextColor={T.sub}
          value={form[f.k]} onChangeText={v=>setForm(p=>({...p,[f.k]:v}))}
          keyboardType={f.kb||'default'} autoCapitalize={f.cap||'words'}/>
      ))}
      <TextInput style={[inputStyle(T),{marginBottom:20,width:'100%'}]}
        placeholder="Password" placeholderTextColor={T.sub}
        value={form.password} onChangeText={v=>setForm(p=>({...p,password:v}))}
        secureTextEntry/>
      <ThemedButton label={busy?'...':'Create Account'} onPress={register}
        disabled={busy} style={{width:'100%',marginBottom:12}}/>
      <TouchableOpacity onPress={()=>navigation.navigate('Login')}>
        <Text style={{ color:T.primary, textAlign:'center', fontSize:14 }}>
          Already have an account? Login
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CAMERA TAB — Phone as Security Camera
// ═══════════════════════════════════════════════════════════════════
function CameraTab({ user, devices, onEvent }) {
  const T = useTheme();
  const [camPerm, reqCam] = useCameraPermissions();
  const [micPerm, reqMic] = useMicrophonePermissions();

  const [facing,        setFacing]        = useState('back');
  const [recording,     setRecording]     = useState(false);
  const [armed,         setArmed]         = useState(false);
  const [isOnline,      setIsOnline]      = useState(false);
  const [linkedDevice,  setLinkedDevice]  = useState(null);
  const [recordMode,    setRecordMode]    = useState('security');
  const [clipDuration,  setClipDuration]  = useState(60);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [soundEnabled,  setSoundEnabled]  = useState(true);
  const [nightVision,   setNightVision]   = useState(false);
  const [nightVisionPro,setNightVisionPro]= useState(false);
  const [statusMsg,     setStatusMsg]     = useState('Ready');
  const [viewers,       setViewers]       = useState(0);
  const [showSettings,  setShowSettings]  = useState(false);
  const [toast,         setToast]         = useState('');
  const [toastVisible,  setToastVisible]  = useState(false);

  const cameraRef    = useRef(null);
  const camSocketRef = useRef(null);
  const isArmedRef   = useRef(false);
  const recordingRef = useRef(false);
  const accelRef     = useRef(null);
  const soundRecRef  = useRef(null);
  const alertRef     = useRef(false);
  const lastAlertRef = useRef(0);
  const executeRef   = useRef(null);
  const pcsRef       = useRef({});
  const localStreamRef = useRef(null);

  useEffect(() => {
    if (devices.length > 0 && !linkedDevice) setLinkedDevice(devices[0]);
  }, [devices]);

  useEffect(() => {
    if (!linkedDevice || !user) return;
    connectCameraSocket();
    startMDNSAdvertise();
    return () => {
      camSocketRef.current?.disconnect();
      stopMotionDet(); stopSoundDet();
    };
  }, [linkedDevice]);

  // Always-current executor ref
  useEffect(() => {
    executeRef.current = (cmd, params={}) => {
      if (cmd==='arm') {
        if (params.clipDuration) setClipDuration(params.clipDuration);
        if (params.motionEnabled!==undefined) setMotionEnabled(params.motionEnabled);
        if (params.soundEnabled!==undefined)  setSoundEnabled(params.soundEnabled);
        doArm();
      }
      if (cmd==='disarm') doDisarm();
    };
  });

  const showToast = (msg) => {
    setToast(msg); setToastVisible(true);
    setTimeout(()=>setToastVisible(false), 14000);
  };

  // ── mDNS Advertise (so other devices can discover this phone) ──
  const startMDNSAdvertise = () => {
    try {
      const zc = new Zeroconf();
      zc.publishService(
        '_realsecurity._tcp.',
        'tcp',
        '',
        `RSC_${linkedDevice?.id?.substring(0,8)||'phone'}`,
        8080,
        { deviceId: linkedDevice?.id||'', orgId: user?.organizationId||'' }
      );
    } catch(e) { console.log('mDNS advertise error:', e.message); }
  };

  // ── Camera Socket ─────────────────────────────────────────────
  const connectCameraSocket = async () => {
    const token = await AsyncStorage.getItem('accessToken');
    if (!token) return;
    const s = io(API_URL, { auth:{ token }, transports:['websocket','polling'] });
    camSocketRef.current = s;

    s.on('connect', () => {
      s.emit('auth', {
        deviceId: linkedDevice.id,
        deviceName: linkedDevice.device_name||linkedDevice.name,
        role: 'camera',
        organizationId: user.organizationId,
        userId: user.userId,
      });
      setIsOnline(true);
      setStatusMsg('🟢 Online — ready');
    });

    s.on('camera:command', ({ command, params }) => {
      if (executeRef.current) executeRef.current(command, params||{});
    });

    s.on('viewer:request', async ({ viewerSocketId }) => {
      setViewers(v=>v+1);
      await sendWebRTCOffer(s, viewerSocketId);
    });

    s.on('webrtc:answer', async ({ answer, fromSocketId }) => {
      const pc = pcsRef.current[fromSocketId];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    s.on('webrtc:ice', ({ candidate, fromSocketId }) => {
      const pc = pcsRef.current[fromSocketId];
      if (pc && candidate) pc.addIceCandidate(new RTCIceCandidate(candidate));
    });

    s.on('disconnect', () => {
      setIsOnline(false);
      setViewers(0);
      setStatusMsg('⚠️ Reconnecting...');
    });
  };

  // ── WebRTC Broadcaster ────────────────────────────────────────
  const getLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await mediaDevices.getUserMedia({
        video: { facingMode: facing, width: 1280, height: 720 },
        audio: true,
      });
      localStreamRef.current = stream;
      return stream;
    } catch(e) {
      console.log('getUserMedia error:', e.message);
      return null;
    }
  };

  const sendWebRTCOffer = async (socket, viewerSocketId) => {
    const stream = await getLocalStream();
    if (!stream) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcsRef.current[viewerSocketId] = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('webrtc:ice', {
        targetSocketId: viewerSocketId,
        candidate: e.candidate,
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState==='disconnected'||pc.connectionState==='closed') {
        setViewers(v=>Math.max(0,v-1));
        delete pcsRef.current[viewerSocketId];
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc:offer', { targetSocketId: viewerSocketId, offer });
  };

  // ── Arm / Disarm ──────────────────────────────────────────────
  const doArm = () => {
    setArmed(true); isArmedRef.current = true;
    setStatusMsg('🟢 Armed — monitoring...');
    activateKeepAwakeAsync();
    if (motionEnabled) startMotionDet();
    if (soundEnabled)  startSoundDet();
    notify('Real Security Camera', '📡 Camera armed — monitoring active');
    Vibration.vibrate(200);
    if (recordMode==='dashcam'||recordMode==='loop') startRecording();
  };

  const doDisarm = () => {
    setArmed(false); isArmedRef.current = false;
    stopMotionDet(); stopSoundDet();
    if (recordingRef.current) stopRecording();
    deactivateKeepAwake();
    setStatusMsg('🟢 Online — ready');
    Vibration.vibrate([0,100,50,100]);
  };

  // ── Motion Detection ──────────────────────────────────────────
  const startMotionDet = () => {
    Accelerometer.setUpdateInterval(400);
    accelRef.current = Accelerometer.addListener(({ x, y, z }) => {
      if (!isArmedRef.current || alertRef.current) return;
      const mag = Math.sqrt(x*x + y*y + z*z);
      if (mag > 1.4 && Date.now()-lastAlertRef.current > clipDuration*1000+2000) {
        triggerAlert('motion');
      }
    });
  };

  const stopMotionDet = () => {
    accelRef.current?.remove();
    accelRef.current = null;
  };

  // ── Sound Detection ───────────────────────────────────────────
  const startSoundDet = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );
      soundRecRef.current = recording;
      const intv = setInterval(async () => {
        if (!isArmedRef.current||alertRef.current) return;
        try {
          const status = await recording.getStatusAsync();
          if (status.metering && status.metering > -28) triggerAlert('sound');
        } catch {}
      }, 800);
      recording._intv = intv;
    } catch(e) { console.log('SoundDet err:', e.message); }
  };

  const stopSoundDet = async () => {
    if (soundRecRef.current) {
      clearInterval(soundRecRef.current._intv);
      try { await soundRecRef.current.stopAndUnloadAsync(); } catch {}
      soundRecRef.current = null;
    }
  };

  // ── Alert Trigger ─────────────────────────────────────────────
  const triggerAlert = async (type) => {
    if (alertRef.current) return;
    alertRef.current = true;
    lastAlertRef.current = Date.now();

    const event = {
      id: Date.now(), type,
      time: new Date().toLocaleTimeString(),
      deviceName: linkedDevice?.device_name||'Phone Camera',
      clip_url: null, clip_pending: true,
    };

    if (onEvent) onEvent(event);
    setStatusMsg(`⚠️ ${type==='motion'?'Motion':'Sound'} detected!`);
    showToast(`🚨 ${type==='motion'?'Motion':'Sound'} detected — ${event.deviceName}`);
    Vibration.vibrate([0,300,100,300]);
    notify('🚨 Security Alert', `${type==='motion'?'Motion':'Sound'} detected`);

    camSocketRef.current?.emit('motion:detected', {
      deviceId: linkedDevice?.id, type,
      timestamp: new Date().toISOString(),
    });

    await startRecording(event.id);
  };

  // ── Recording ─────────────────────────────────────────────────
  const startRecording = async (eventId=null) => {
    if (!cameraRef.current||recordingRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: clipDuration });
      recordingRef.current = false;
      setRecording(false);
      alertRef.current = false;
      setStatusMsg(isArmedRef.current?'🟢 Armed — monitoring...':'🟢 Online — ready');
      if (video?.uri) await uploadClip(video.uri, eventId);
      if ((recordMode==='loop')&&isArmedRef.current) setTimeout(()=>startRecording(),500);
    } catch(e) {
      recordingRef.current = false;
      setRecording(false);
      alertRef.current = false;
    }
  };

  const stopRecording = () => cameraRef.current?.stopRecording();

  const uploadClip = async (uri, eventId) => {
    try {
      await MediaLibrary.saveToLibraryAsync(uri);
      const filename = `clip_mobile_${linkedDevice?.id}_${Date.now()}.mp4`;
      const form = new FormData();
      form.append('clip', { uri, name: filename, type: 'video/mp4' });
      form.append('deviceId', linkedDevice?.id||'');
      form.append('organizationId', user?.organizationId||'');
      form.append('filename', filename);
      if (eventId) form.append('eventId', String(eventId));
      const res = await api.post('/api/recordings/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      if (res.data?.url && eventId && onEvent) {
        onEvent({ type:'clip_ready', eventId, clip_url: res.data.url });
      }
      setStatusMsg('☁️ Clip uploaded');
    } catch(e) {
      console.log('Upload err:', e.message);
      setStatusMsg('⬇️ Saved locally');
    }
  };

  if (!camPerm) return <View style={{flex:1,backgroundColor:T.bg,justifyContent:'center',alignItems:'center'}}>
    <ActivityIndicator color={T.primary}/></View>;

  if (!camPerm.granted) return (
    <View style={{flex:1,backgroundColor:T.bg,justifyContent:'center',alignItems:'center',padding:28}}>
      <Text style={{color:T.text,fontSize:16,textAlign:'center',marginBottom:20}}>
        Camera access required to use this device as a security camera.
      </Text>
      <ThemedButton label="Grant Camera Permission" onPress={reqCam} style={{width:'100%'}}/>
    </View>
  );

  return (
    <View style={{flex:1,backgroundColor:T.bg}}>
      {/* Camera Preview */}
      <View style={{flex:1,position:'relative'}}>
        <CameraView ref={cameraRef} style={{flex:1}} facing={facing} mode="video">
          {nightVision && (
            <View style={{...StyleSheet.absoluteFillObject,
              backgroundColor: nightVisionPro ? 'rgba(0,40,0,0.6)' : 'rgba(0,20,0,0.45)'}}/>
          )}
          {/* Scanline effect for Operator theme */}
          {T.name.includes('Operator') && (
            <View style={{...StyleSheet.absoluteFillObject,opacity:0.03,
              backgroundImage:'repeating-linear-gradient(0deg,#000 0px,#000 1px,transparent 1px,transparent 4px)'}}/>
          )}

          {/* Top HUD */}
          <View style={{position:'absolute',top:50,left:16,right:16,
            flexDirection:'row',justifyContent:'space-between'}}>
            <View style={{backgroundColor:'rgba(0,0,0,0.75)',paddingHorizontal:12,
              paddingVertical:5,borderRadius:20,flexDirection:'row',alignItems:'center',gap:6}}>
              <View style={{width:8,height:8,borderRadius:4,
                backgroundColor:isOnline?T.primary:'#666'}}/>
              <Text style={{color:'#fff',fontSize:12,fontWeight:'700'}}>
                {isOnline?'LIVE':'OFFLINE'}
              </Text>
              {viewers>0&&<Text style={{color:T.gold,fontSize:12}}>  👁 {viewers}</Text>}
            </View>
            {recording&&(
              <View style={{backgroundColor:'rgba(200,0,0,0.9)',paddingHorizontal:10,
                paddingVertical:5,borderRadius:20,flexDirection:'row',alignItems:'center',gap:5}}>
                <View style={{width:8,height:8,borderRadius:4,backgroundColor:'#fff'}}/>
                <Text style={{color:'#fff',fontSize:12,fontWeight:'700'}}>REC</Text>
              </View>
            )}
            {armed&&!recording&&(
              <View style={{backgroundColor:'rgba(0,80,0,0.9)',paddingHorizontal:10,
                paddingVertical:5,borderRadius:20}}>
                <Text style={{color:T.primary,fontSize:12,fontWeight:'700'}}>🟢 ARMED</Text>
              </View>
            )}
          </View>

          {/* Status bar */}
          <View style={{position:'absolute',bottom:16,left:0,right:0,alignItems:'center'}}>
            <Text style={{color:'rgba(255,255,255,0.9)',fontSize:12,
              backgroundColor:'rgba(0,0,0,0.55)',paddingHorizontal:14,
              paddingVertical:5,borderRadius:14}}>
              {statusMsg}
            </Text>
          </View>
        </CameraView>
      </View>

      {/* Controls */}
      <View style={{backgroundColor:T.card,paddingHorizontal:16,paddingTop:12,
        paddingBottom:Platform.OS==='ios'?28:14,borderTopWidth:1,borderColor:T.border}}>

        {/* Device row */}
        <View style={{flexDirection:'row',justifyContent:'space-between',
          alignItems:'center',marginBottom:10}}>
          <Text style={{color:T.sub,fontSize:12}}>
            📍 {linkedDevice?.device_name||'No device'}{linkedDevice?.location?` · ${linkedDevice.location}`:''}
          </Text>
          <View style={{flexDirection:'row',gap:14}}>
            <TouchableOpacity onPress={()=>setFacing(f=>f==='back'?'front':'back')}>
              <Text style={{color:T.blue,fontSize:13}}>🔄 Flip</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setShowSettings(true)}>
              <Text style={{color:T.sub,fontSize:13}}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Mode tabs */}
        <View style={{flexDirection:'row',backgroundColor:T.bg,borderRadius:T.radius,
          padding:3,marginBottom:10,borderWidth:1,borderColor:T.border}}>
          {[
            {id:'security',label:'🔒 Security'},
            {id:'dashcam', label:'🚗 Dashcam'},
            {id:'loop',    label:'🔄 Loop'},
          ].map(m=>(
            <TouchableOpacity key={m.id}
              style={{flex:1,paddingVertical:7,borderRadius:Math.max(T.radius-2,4),
                alignItems:'center',
                backgroundColor:recordMode===m.id?T.primary:'transparent'}}
              onPress={()=>setRecordMode(m.id)}>
              <Text style={{color:recordMode===m.id?(T.bg==='#f0f2f5'||T.bg==='#f2f2f7'?'#fff':'#000'):T.sub,
                fontWeight:'600',fontSize:12}}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Clip duration */}
        <View style={{flexDirection:'row',justifyContent:'space-between',
          alignItems:'center',marginBottom:10}}>
          <Text style={{color:T.sub,fontSize:12}}>Clip Duration</Text>
          <View style={{flexDirection:'row',gap:5}}>
            {[30,60,300,900,1800].map(d=>(
              <TouchableOpacity key={d}
                style={{paddingHorizontal:8,paddingVertical:3,
                  borderRadius:T.radius,
                  backgroundColor:clipDuration===d?T.primary:T.bg,
                  borderWidth:1,borderColor:clipDuration===d?T.primary:T.border}}
                onPress={()=>setClipDuration(d)}>
                <Text style={{
                  color:clipDuration===d?(T.bg==='#f0f2f5'||T.bg==='#f2f2f7'?'#fff':'#000'):T.text,
                  fontSize:11}}>
                  {d<60?`${d}s`:d<3600?`${d/60}m`:`${d/3600}h`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Toggles */}
        <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:12}}>
          {[
            {label:'👁 Motion', val:motionEnabled, set:setMotionEnabled},
            {label:'🔊 Sound',  val:soundEnabled,  set:setSoundEnabled},
            {label:'🌙 Night',  val:nightVision,   set:v=>{setNightVision(v);if(!v)setNightVisionPro(false);}},
            {label:'🌑 NV Pro', val:nightVisionPro,set:v=>{setNightVisionPro(v);if(v)setNightVision(true);}},
          ].map(t=>(
            <View key={t.label} style={{alignItems:'center'}}>
              <Switch value={t.val} onValueChange={t.set}
                trackColor={{false:T.border,true:T.primary}}
                thumbColor={t.val?'#fff':T.sub}/>
              <Text style={{color:T.sub,fontSize:10,marginTop:3}}>{t.label}</Text>
            </View>
          ))}
        </View>

        {/* Action button */}
        {!armed ? (
          <ThemedButton label="🟢 Start Monitoring" onPress={doArm}/>
        ) : (
          <View style={{flexDirection:'row',gap:8}}>
            <ThemedButton label="🔴 Stop Monitoring" onPress={doDisarm}
              variant="danger" style={{flex:1}}/>
            <TouchableOpacity style={{
              borderWidth:1.5,borderColor:recording?T.danger:T.border,
              borderRadius:T.radius,padding:12,alignItems:'center',
              width:72,justifyContent:'center',backgroundColor:T.bg}}
              onPress={()=>recording?stopRecording():startRecording()}>
              <Text style={{color:recording?T.danger:T.text,fontSize:11,fontWeight:'600'}}>
                {recording?'⏹ Stop':'⏺ Rec'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" transparent>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}}>
          <View style={{backgroundColor:T.card,borderTopLeftRadius:20,
            borderTopRightRadius:20,padding:20,paddingBottom:40}}>
            <Text style={{color:T.text,fontSize:16,fontWeight:'bold',marginBottom:16}}>
              ⚙️ Camera Settings
            </Text>
            <Text style={{color:T.sub,fontSize:12,marginBottom:8}}>Link to Device</Text>
            {devices.map(d=>(
              <TouchableOpacity key={d.id}
                style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',
                  padding:12,borderRadius:T.radius,marginBottom:8,
                  backgroundColor:linkedDevice?.id===d.id?T.secondary:T.bg,
                  borderWidth:1,borderColor:linkedDevice?.id===d.id?T.primary:T.border}}
                onPress={()=>setLinkedDevice(d)}>
                <Text style={{color:T.text,fontSize:13}}>{d.device_name||d.name}</Text>
                {linkedDevice?.id===d.id&&<Text style={{color:T.primary,fontWeight:'bold'}}>✓</Text>}
              </TouchableOpacity>
            ))}
            <ThemedButton label="Done" onPress={()=>setShowSettings(false)} style={{marginTop:8}}/>
          </View>
        </View>
      </Modal>

      <Toast message={toast} visible={toastVisible}/>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CAMERAS TAB — View + Control all cameras
// ═══════════════════════════════════════════════════════════════════
function CamerasTab({ user, devices, onlineMap, socket }) {
  const T = useTheme();
  const [watchingDevice, setWatchingDevice] = useState(null);
  const [remoteStream,   setRemoteStream]   = useState(null);
  const pcRef = useRef(null);

  const startWatching = async (device) => {
    if (!socket) return Alert.alert('Not connected','Reconnect and try again');
    setWatchingDevice(device);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.ontrack = e => {
      if (e.streams?.[0]) setRemoteStream(e.streams[0]);
    };

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('webrtc:ice', {
        targetSocketId: device.id,
        candidate: e.candidate,
      });
    };

    socket.emit('viewer:watch', { deviceId: device.id });

    socket.once('webrtc:offer', async ({ offer, fromSocketId }) => {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { targetSocketId: fromSocketId, answer });
    });

    socket.on('webrtc:ice', ({ candidate }) => {
      if (candidate) pc.addIceCandidate(new RTCIceCandidate(candidate));
    });
  };

  const stopWatching = () => {
    pcRef.current?.close();
    pcRef.current = null;
    setRemoteStream(null);
    setWatchingDevice(null);
  };

  const remoteArm = (device) => {
    if (!socket) return;
    Alert.alert(
      '🟢 Arm Camera',
      `Start monitoring on ${device.device_name}?`,
      [
        {text:'Cancel',style:'cancel'},
        {text:'Arm',onPress:()=>{
          socket.emit('camera:command',{
            deviceId: device.id,
            command: 'arm',
            params: { clipDuration:60, motionEnabled:true, soundEnabled:true },
          });
        }},
      ]
    );
  };

  const remoteDisarm = (device) => {
    if (!socket) return;
    socket.emit('camera:command', { deviceId: device.id, command: 'disarm' });
  };

  if (devices.length===0) return (
    <View style={{flex:1,backgroundColor:T.bg,justifyContent:'center',alignItems:'center',padding:28}}>
      <Text style={{fontSize:48}}>📷</Text>
      <Text style={{color:T.text,fontSize:18,marginTop:16,fontWeight:'600'}}>No cameras enrolled</Text>
      <Text style={{color:T.sub,marginTop:8,textAlign:'center'}}>
        Add cameras from the web dashboard or use the Discover tab
      </Text>
    </View>
  );

  return (
    <View style={{flex:1,backgroundColor:T.bg}}>
      {/* Live viewer modal */}
      {watchingDevice && (
        <Modal animationType="slide">
          <View style={{flex:1,backgroundColor:'#000'}}>
            <View style={{position:'absolute',top:50,left:16,right:16,
              flexDirection:'row',justifyContent:'space-between',zIndex:10}}>
              <View style={{backgroundColor:'rgba(0,0,0,0.7)',paddingHorizontal:12,
                paddingVertical:6,borderRadius:20,flexDirection:'row',alignItems:'center'}}>
                <View style={{width:8,height:8,borderRadius:4,backgroundColor:T.primary,marginRight:6}}/>
                <Text style={{color:'#fff',fontSize:13,fontWeight:'700'}}>LIVE — {watchingDevice.device_name}</Text>
              </View>
              <TouchableOpacity onPress={stopWatching}
                style={{backgroundColor:'rgba(255,0,0,0.8)',paddingHorizontal:14,
                  paddingVertical:6,borderRadius:20}}>
                <Text style={{color:'#fff',fontWeight:'700'}}>✕ Close</Text>
              </TouchableOpacity>
            </View>
            {remoteStream ? (
              // RTCView would go here — react-native-webrtc
              // RTCView streamURL={remoteStream.toURL()} style={{flex:1}} objectFit="cover"
              <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>
                <Text style={{color:T.primary,fontSize:16}}>📡 Stream Connected</Text>
                <Text style={{color:'#666',fontSize:12,marginTop:8}}>
                  RTCView renders here
                </Text>
              </View>
            ) : (
              <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>
                <ActivityIndicator color={T.primary} size="large"/>
                <Text style={{color:'#fff',marginTop:16}}>Connecting to camera...</Text>
              </View>
            )}
          </View>
        </Modal>
      )}

      <FlatList
        style={{backgroundColor:T.bg}}
        contentContainerStyle={{padding:12}}
        data={devices}
        keyExtractor={d=>d.id}
        renderItem={({item:d})=>{
          const online = onlineMap[d.id]?.online||d.is_active;
          return (
            <ThemedCard style={{marginBottom:12}}>
              <View style={{flexDirection:'row',justifyContent:'space-between',
                alignItems:'flex-start',marginBottom:10}}>
                <View style={{flex:1}}>
                  <Text style={{color:T.text,fontWeight:'bold',fontSize:15,fontFamily:T.fontFamily}}>
                    {d.device_name||d.name}
                  </Text>
                  <Text style={{color:T.sub,fontSize:12,marginTop:2}}>
                    📍 {d.location||'No location'}
                  </Text>
                </View>
                <StatusBadge online={online}/>
              </View>

              {/* Preview / Watch area */}
              <TouchableOpacity
                style={{height:130,backgroundColor:'#050505',borderRadius:T.radius,
                  justifyContent:'center',alignItems:'center',marginBottom:10,
                  borderWidth:1,borderColor:T.border}}
                onPress={()=>online&&startWatching(d)}
                disabled={!online}>
                {online ? (
                  <View style={{alignItems:'center'}}>
                    <Text style={{fontSize:36,color:T.primary}}>▶</Text>
                    <Text style={{color:T.primary,fontSize:13,marginTop:4,fontWeight:'600'}}>
                      Tap to Watch Live
                    </Text>
                  </View>
                ) : (
                  <View style={{alignItems:'center'}}>
                    <Text style={{fontSize:36}}>📷</Text>
                    <Text style={{color:T.sub,fontSize:12,marginTop:4}}>Offline</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Action buttons */}
              <View style={{flexDirection:'row',gap:8}}>
                <ThemedButton
                  label={online?'▶ Watch Live':'Offline'}
                  onPress={()=>online&&startWatching(d)}
                  disabled={!online}
                  style={{flex:2}}/>
                {online && (
                  <>
                    <TouchableOpacity
                      style={{flex:1,borderRadius:T.radius,borderWidth:1,
                        borderColor:T.primary,justifyContent:'center',alignItems:'center',
                        paddingVertical:10,backgroundColor:T.secondary}}
                      onPress={()=>remoteArm(d)}>
                      <Text style={{color:T.primary,fontSize:11,fontWeight:'700'}}>🟢 Arm</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{flex:1,borderRadius:T.radius,borderWidth:1,
                        borderColor:T.danger,justifyContent:'center',alignItems:'center',
                        paddingVertical:10,backgroundColor:'rgba(255,68,68,0.1)'}}
                      onPress={()=>remoteDisarm(d)}>
                      <Text style={{color:T.danger,fontSize:11,fontWeight:'700'}}>🔴 Disarm</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </ThemedCard>
          );
        }}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DISCOVER TAB — Network Discovery
// ═══════════════════════════════════════════════════════════════════
function DiscoverTab({ user, onDeviceEnrolled }) {
  const T = useTheme();
  const [scanning,   setScanning]   = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [enrolling,  setEnrolling]  = useState(null);

  const scan = async () => {
    setScanning(true);
    setDiscovered([]);
    const found = [];

    // ── Android: ARP scan ──────────────────────────────────────
    if (Platform.OS === 'android') {
      try {
        const arp = await FileSystem.readAsStringAsync('/proc/net/arp');
        const lines = arp.split('\n').slice(1);
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 4 && parts[0] !== '0.0.0.0') {
            const ip  = parts[0];
            const mac = parts[3];
            const type = identifyDevice(mac);
            if (type !== 'Unknown') {
              found.push({
                id: mac.replace(/:/g,''),
                ip, mac, type,
                name: `${type} (${ip})`,
                source: 'arp',
              });
            }
          }
        }
      } catch(e) { console.log('ARP scan err:', e.message); }
    }

    // ── mDNS scan (both platforms) ────────────────────────────
    try {
      const zc = new Zeroconf();
      const mdnsFound = await new Promise((resolve) => {
        const results = [];
        const timeout = setTimeout(() => { zc.stop(); resolve(results); }, 8000);

        zc.on('resolved', service => {
          results.push({
            id: service.name,
            ip: service.host,
            mac: '',
            type: service.txt?.deviceId ? 'RSCCamera' : 'mDNS',
            name: service.name,
            deviceId: service.txt?.deviceId,
            orgId: service.txt?.orgId,
            source: 'mdns',
          });
        });

        zc.scan('_realsecurity._tcp.', 'tcp', 'local.');
      });
      found.push(...mdnsFound);
    } catch(e) { console.log('mDNS scan err:', e.message); }

    // ── iOS: ping sweep fallback ───────────────────────────────
    if (Platform.OS === 'ios' && found.length === 0) {
      // Show message that mDNS is the primary method on iOS
      found.push({
        id: 'ios_hint',
        ip: '',
        mac: '',
        type: 'hint',
        name: 'Open the Real Security Camera app on other iPhones to discover them automatically via mDNS',
        source: 'hint',
      });
    }

    setDiscovered(found);
    setScanning(false);
  };

  const enroll = async (device) => {
    if (device.type === 'hint') return;
    setEnrolling(device.id);
    try {
      const res = await api.post('/api/devices', {
        device_name: device.name,
        location: device.ip || 'Local Network',
        device_type: device.type === 'RSCCamera' ? 'mobile' : 'ip_camera',
        mac_address: device.mac,
        ip_address: device.ip,
      });
      Alert.alert('✅ Enrolled', `${device.name} has been added to your cameras.`);
      if (onDeviceEnrolled) onDeviceEnrolled(res.data.data);
    } catch(e) {
      Alert.alert('Error', e.response?.data?.message || 'Enrollment failed');
    }
    setEnrolling(null);
  };

  const typeIcon = (type) => {
    if (type==='iOS'||type==='RSCCamera') return '📱';
    if (type==='Android') return '🤖';
    if (type==='IPCamera') return '📹';
    if (type==='hint') return 'ℹ️';
    return '📡';
  };

  return (
    <View style={{flex:1,backgroundColor:T.bg}}>
      {/* Header */}
      <View style={{padding:16,borderBottomWidth:1,borderColor:T.border}}>
        <Text style={{color:T.text,fontSize:18,fontWeight:'bold',
          fontFamily:T.fontFamily,marginBottom:4}}>
          🔍 Discover Cameras
        </Text>
        <Text style={{color:T.sub,fontSize:12,marginBottom:12}}>
          {Platform.OS==='android'
            ? 'Scans local network via ARP + mDNS to find phones and IP cameras'
            : 'Discovers devices via mDNS/Bonjour on your local network'}
        </Text>
        <ThemedButton
          label={scanning ? '⏳ Scanning...' : '🔍 Scan Network'}
          onPress={scan}
          disabled={scanning}/>
        {scanning && (
          <View style={{flexDirection:'row',alignItems:'center',gap:8,marginTop:10}}>
            <ActivityIndicator color={T.primary} size="small"/>
            <Text style={{color:T.sub,fontSize:12}}>
              {Platform.OS==='android'
                ? 'Reading ARP table + mDNS scan (8s)...'
                : 'mDNS/Bonjour scan (8s)...'}
            </Text>
          </View>
        )}
      </View>

      <FlatList
        contentContainerStyle={{padding:12}}
        data={discovered}
        keyExtractor={d=>d.id}
        ListEmptyComponent={
          !scanning ? (
            <View style={{alignItems:'center',paddingTop:60}}>
              <Text style={{fontSize:48}}>📡</Text>
              <Text style={{color:T.text,fontSize:16,marginTop:16,fontWeight:'600'}}>
                No devices found yet
              </Text>
              <Text style={{color:T.sub,marginTop:8,textAlign:'center',paddingHorizontal:32}}>
                Make sure devices are on the same WiFi network, then tap Scan Network
              </Text>
            </View>
          ) : null
        }
        renderItem={({item:d})=>(
          <ThemedCard style={{marginBottom:10}}>
            <View style={{flexDirection:'row',alignItems:'center'}}>
              <Text style={{fontSize:28,marginRight:12}}>{typeIcon(d.type)}</Text>
              <View style={{flex:1}}>
                <Text style={{color:T.text,fontWeight:'600',fontSize:14}} numberOfLines={2}>
                  {d.name}
                </Text>
                {d.ip ? (
                  <Text style={{color:T.sub,fontSize:11,marginTop:2}}>
                    IP: {d.ip}{d.mac?` · MAC: ${d.mac}`:''}
                  </Text>
                ) : null}
                <View style={{flexDirection:'row',alignItems:'center',gap:6,marginTop:4}}>
                  <View style={{backgroundColor:T.secondary,paddingHorizontal:8,
                    paddingVertical:2,borderRadius:10}}>
                    <Text style={{color:T.primary,fontSize:10,fontWeight:'600'}}>
                      {d.source==='arp'?'ARP':d.source==='mdns'?'mDNS':'Info'}
                    </Text>
                  </View>
                  <Text style={{color:T.sub,fontSize:11}}>{d.type}</Text>
                </View>
              </View>
              {d.type !== 'hint' && (
                <TouchableOpacity
                  style={{backgroundColor:T.primary,paddingHorizontal:14,
                    paddingVertical:8,borderRadius:T.radius,
                    opacity:enrolling===d.id?0.6:1}}
                  onPress={()=>enroll(d)}
                  disabled={enrolling===d.id}>
                  {enrolling===d.id
                    ? <ActivityIndicator color="#000" size="small"/>
                    : <Text style={{color:T.bg==='#f0f2f5'||T.bg==='#f2f2f7'?'#fff':'#000',
                        fontWeight:'700',fontSize:12}}>+ Enroll</Text>
                  }
                </TouchableOpacity>
              )}
            </View>
          </ThemedCard>
        )}
      />

      {/* iOS notice */}
      {Platform.OS === 'ios' && (
        <View style={{padding:12,margin:12,borderRadius:T.radius,
          backgroundColor:T.secondary,borderWidth:1,borderColor:T.primary}}>
          <Text style={{color:T.primary,fontWeight:'700',marginBottom:4}}>ℹ️ iOS Network Discovery</Text>
          <Text style={{color:T.text,fontSize:12}}>
            On iOS, cameras running the Real Security Camera app advertise via mDNS automatically.
            They'll appear here when on the same WiFi. For manual enrollment, use the QR code
            scanner in the web dashboard.
          </Text>
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CLIPS TAB
// ═══════════════════════════════════════════════════════════════════
function ClipsTab() {
  const T = useTheme();
  const [clips,      setClips]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected,   setSelected]   = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);

  useEffect(()=>{ load(); },[]);

  const load = async (refresh=false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await api.get('/api/recordings');
      setClips(r.data.data||[]);
    } catch(e) { console.log(e.message); }
    setLoading(false); setRefreshing(false);
  };

  const delOne = (id) => Alert.alert('Delete Clip','This cannot be undone.',[
    {text:'Cancel',style:'cancel'},
    {text:'Delete',style:'destructive',onPress:async()=>{
      try { await api.delete(`/api/recordings/${id}`); setClips(c=>c.filter(x=>x.id!==id)); }
      catch { Alert.alert('Error','Delete failed'); }
    }},
  ]);

  const delSelected = () => Alert.alert(`Delete ${selected.size} clips`,'This cannot be undone.',[
    {text:'Cancel',style:'cancel'},
    {text:'Delete All',style:'destructive',onPress:async()=>{
      for (const id of selected) { try { await api.delete(`/api/recordings/${id}`); } catch {} }
      setClips(c=>c.filter(x=>!selected.has(x.id)));
      setSelected(new Set()); setSelectMode(false);
    }},
  ]);

  const toggle = (id) => setSelected(s=>{
    const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n;
  });

  const fmt = (b) => !b?'':b>1048576?`${(b/1048576).toFixed(1)} MB`:`${(b/1024).toFixed(0)} KB`;

  if (loading) return <View style={{flex:1,backgroundColor:T.bg,justifyContent:'center',alignItems:'center'}}>
    <ActivityIndicator color={T.primary}/></View>;

  return (
    <View style={{flex:1,backgroundColor:T.bg}}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',
        padding:14,borderBottomWidth:1,borderColor:T.border}}>
        <Text style={{color:T.text,fontSize:15,fontWeight:'bold',fontFamily:T.fontFamily}}>
          🎬 Clips <Text style={{color:T.sub,fontWeight:'normal',fontSize:13}}>({clips.length})</Text>
        </Text>
        <View style={{flexDirection:'row',gap:8}}>
          {selectMode&&selected.size>0&&(
            <TouchableOpacity onPress={delSelected}
              style={{backgroundColor:'rgba(255,68,68,0.15)',paddingHorizontal:10,
                paddingVertical:5,borderRadius:T.radius,borderWidth:1,borderColor:T.danger}}>
              <Text style={{color:T.danger,fontSize:12,fontWeight:'600'}}>🗑 {selected.size}</Text>
            </TouchableOpacity>
          )}
          {selectMode&&(
            <TouchableOpacity onPress={()=>{setSelected(new Set(clips.map(c=>c.id)));}}
              style={{backgroundColor:T.secondary,paddingHorizontal:10,
                paddingVertical:5,borderRadius:T.radius,borderWidth:1,borderColor:T.primary}}>
              <Text style={{color:T.primary,fontSize:12}}>All</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={()=>{setSelectMode(s=>!s);setSelected(new Set());}}
            style={{backgroundColor:selectMode?T.secondary:T.card,paddingHorizontal:10,
              paddingVertical:5,borderRadius:T.radius,borderWidth:1,
              borderColor:selectMode?T.primary:T.border}}>
            <Text style={{color:selectMode?T.primary:T.sub,fontSize:12}}>
              {selectMode?'✕ Cancel':'☑ Select'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        contentContainerStyle={{padding:12}}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>load(true)}
          tintColor={T.primary}/>}
        data={clips}
        keyExtractor={c=>c.id}
        ListEmptyComponent={
          <View style={{alignItems:'center',paddingTop:60}}>
            <Text style={{fontSize:48}}>🎬</Text>
            <Text style={{color:T.text,fontSize:18,marginTop:16,fontWeight:'600'}}>No clips yet</Text>
            <Text style={{color:T.sub,marginTop:8}}>Start monitoring to record clips</Text>
          </View>
        }
        renderItem={({item:c})=>(
          <TouchableOpacity
            onPress={()=>selectMode?toggle(c.id):null}
            onLongPress={()=>{setSelectMode(true);toggle(c.id);}}
            activeOpacity={selectMode?0.7:1}>
            <ThemedCard style={{marginBottom:8,flexDirection:'row',alignItems:'center',
              borderColor:selectMode&&selected.has(c.id)?T.primary:T.border}}>
              {selectMode&&(
                <View style={{width:22,height:22,borderRadius:11,borderWidth:2,
                  borderColor:selected.has(c.id)?T.primary:T.border,
                  backgroundColor:selected.has(c.id)?T.primary:'transparent',
                  justifyContent:'center',alignItems:'center',marginRight:10}}>
                  {selected.has(c.id)&&<Text style={{color:T.bg,fontSize:12,fontWeight:'bold'}}>✓</Text>}
                </View>
              )}
              <View style={{width:54,height:54,backgroundColor:'#050505',borderRadius:T.radius,
                justifyContent:'center',alignItems:'center',marginRight:12,
                borderWidth:1,borderColor:T.border}}>
                <Text style={{fontSize:22}}>🎬</Text>
              </View>
              <View style={{flex:1}}>
                <Text style={{color:T.text,fontSize:12,fontWeight:'600'}} numberOfLines={1}>
                  {c.filename}
                </Text>
                <Text style={{color:T.sub,fontSize:11,marginTop:3}}>
                  {new Date(c.created_at).toLocaleDateString()} · {new Date(c.created_at).toLocaleTimeString()}
                </Text>
                <Text style={{color:T.sub,fontSize:11}}>{fmt(c.size)}</Text>
              </View>
              {!selectMode&&(
                <TouchableOpacity onPress={()=>delOne(c.id)} style={{padding:8}}>
                  <Text style={{color:T.danger,fontSize:20}}>🗑</Text>
                </TouchableOpacity>
              )}
            </ThemedCard>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EVENTS TAB
// ═══════════════════════════════════════════════════════════════════
function EventsTab({ events }) {
  const T = useTheme();
  const today = events.filter(e => {
    try { return new Date(e.id).toDateString()===new Date().toDateString(); } catch { return true; }
  });

  return (
    <View style={{flex:1,backgroundColor:T.bg}}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',
        padding:14,borderBottomWidth:1,borderColor:T.border}}>
        <Text style={{color:T.text,fontSize:15,fontWeight:'bold',fontFamily:T.fontFamily}}>
          🔔 Events Today
        </Text>
        <View style={{backgroundColor:T.danger,borderRadius:12,
          paddingHorizontal:9,paddingVertical:2}}>
          <Text style={{color:'#fff',fontSize:12,fontWeight:'bold'}}>{today.length}</Text>
        </View>
      </View>

      <FlatList
        contentContainerStyle={{padding:12}}
        data={today}
        keyExtractor={e=>String(e.id)}
        ListEmptyComponent={
          <View style={{alignItems:'center',paddingTop:60}}>
            <Text style={{fontSize:48}}>🔔</Text>
            <Text style={{color:T.text,fontSize:18,marginTop:16,fontWeight:'600'}}>No events today</Text>
            <Text style={{color:T.sub,marginTop:8,textAlign:'center'}}>
              Events appear when motion or sound is detected
            </Text>
          </View>
        }
        renderItem={({item:e})=>(
          <ThemedCard style={{marginBottom:8,flexDirection:'row',alignItems:'center'}}>
            <Text style={{fontSize:28,marginRight:12}}>
              {e.type==='motion'?'👁':'🔊'}
            </Text>
            <View style={{flex:1}}>
              <Text style={{color:T.text,fontWeight:'bold',fontSize:13}}>
                {e.type==='motion'?'Motion Detected':'Sound Detected'}
              </Text>
              <Text style={{color:T.primary,fontSize:12,marginTop:2}}>{e.deviceName}</Text>
              <Text style={{color:T.sub,fontSize:11,marginTop:2}}>{e.time}</Text>
            </View>
            {e.clip_url ? (
              <View style={{backgroundColor:T.secondary,borderRadius:T.radius,
                paddingHorizontal:9,paddingVertical:4,borderWidth:1,borderColor:T.primary}}>
                <Text style={{color:T.primary,fontSize:11,fontWeight:'600'}}>▶ Clip</Text>
              </View>
            ) : e.clip_pending ? (
              <Text style={{color:T.sub,fontSize:20}}>⏳</Text>
            ) : null}
          </ThemedCard>
        )}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN TAB
// ═══════════════════════════════════════════════════════════════════
function AdminTab({ user }) {
  const T = useTheme();
  const [members,  setMembers]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [invEmail, setInvEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  // PAYWALL: Max 1 additional admin (2 total)
  // TODO: ENABLE PAYWALL — check subscription tier before allowing grant
  const MAX_ADMINS = 2;

  useEffect(()=>{ loadMembers(); },[]);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/users');
      setMembers(r.data.data||[]);
    } catch(e) { console.log(e.message); }
    setLoading(false);
  };

  const grantAdmin = async (userId) => {
    const adminCount = members.filter(m=>m.role==='admin').length;
    if (adminCount >= MAX_ADMINS) {
      // TODO: ENABLE PAYWALL — show upgrade screen here
      Alert.alert(
        '⚠️ Admin Limit Reached',
        `Your plan allows ${MAX_ADMINS} admins total. Upgrade to add more.`,
        [
          {text:'Later',style:'cancel'},
          {text:'Upgrade',onPress:()=>Alert.alert('Upgrade','Subscription screen coming soon')},
        ]
      );
      return;
    }
    try {
      await api.put(`/api/users/${userId}/role`, { role:'admin' });
      loadMembers();
    } catch(e) { Alert.alert('Error','Failed to grant admin'); }
  };

  const revokeAdmin = async (userId) => {
    Alert.alert('Revoke Admin','Remove admin access for this user?',[
      {text:'Cancel',style:'cancel'},
      {text:'Revoke',style:'destructive',onPress:async()=>{
        try {
          await api.put(`/api/users/${userId}/role`, { role:'viewer' });
          loadMembers();
        } catch { Alert.alert('Error','Failed to revoke admin'); }
      }},
    ]);
  };

  const inviteUser = async () => {
    if (!invEmail) return;
    setInviting(true);
    try {
      await api.post('/api/users/invite', { email: invEmail });
      Alert.alert('✅ Invited', `Invitation sent to ${invEmail}`);
      setInvEmail('');
      loadMembers();
    } catch(e) {
      Alert.alert('Error', e.response?.data?.message||'Invitation failed');
    }
    setInviting(false);
  };

  const adminCount = members.filter(m=>m.role==='admin').length;

  return (
    <ScrollView style={{flex:1,backgroundColor:T.bg}}
      contentContainerStyle={{padding:16}}>

      {/* Org Info */}
      <ThemedCard style={{marginBottom:16}}>
        <Text style={{color:T.primary,fontSize:14,fontWeight:'700',
          fontFamily:T.fontFamily,marginBottom:8}}>
          🏢 Organization
        </Text>
        <Text style={{color:T.text,fontSize:15,fontWeight:'600'}}>
          {user?.org_name||user?.organizationId||'My Organization'}
        </Text>
        <Text style={{color:T.sub,fontSize:12,marginTop:4}}>
          {user?.email}
        </Text>
        <View style={{flexDirection:'row',justifyContent:'space-between',
          marginTop:12,paddingTop:12,borderTopWidth:1,borderColor:T.border}}>
          <View style={{alignItems:'center'}}>
            <Text style={{color:T.primary,fontSize:20,fontWeight:'bold'}}>{members.length}</Text>
            <Text style={{color:T.sub,fontSize:11}}>Members</Text>
          </View>
          <View style={{alignItems:'center'}}>
            <Text style={{color:T.primary,fontSize:20,fontWeight:'bold'}}>{adminCount}</Text>
            <Text style={{color:T.sub,fontSize:11}}>Admins</Text>
          </View>
          <View style={{alignItems:'center'}}>
            <Text style={{color:adminCount>=MAX_ADMINS?T.danger:T.primary,
              fontSize:20,fontWeight:'bold'}}>{MAX_ADMINS-adminCount}</Text>
            <Text style={{color:T.sub,fontSize:11}}>Slots Left</Text>
          </View>
        </View>
      </ThemedCard>

      {/* TODO: ENABLE PAYWALL banner when admin limit reached */}
      {adminCount >= MAX_ADMINS && (
        <ThemedCard style={{marginBottom:16,borderColor:T.gold}}>
          <Text style={{color:T.gold,fontWeight:'700',marginBottom:4}}>
            ⭐ Upgrade for More Admins
          </Text>
          <Text style={{color:T.sub,fontSize:12}}>
            Your plan includes {MAX_ADMINS} admins. Upgrade to Pro for up to 5 admins.
          </Text>
          {/* TODO: ENABLE PAYWALL — uncomment below before production deploy */}
          {/* <ThemedButton label="Upgrade Plan" onPress={()=>{}} style={{marginTop:10}}/> */}
        </ThemedCard>
      )}

      {/* Invite */}
      <ThemedCard style={{marginBottom:16}}>
        <Text style={{color:T.text,fontWeight:'700',marginBottom:10}}>
          ✉️ Invite User
        </Text>
        <TextInput style={[inputStyle(T),{marginBottom:10}]}
          placeholder="Email address" placeholderTextColor={T.sub}
          value={invEmail} onChangeText={setInvEmail}
          keyboardType="email-address" autoCapitalize="none"/>
        <ThemedButton label={inviting?'Sending...':'Send Invite'}
          onPress={inviteUser} disabled={inviting||!invEmail}/>
      </ThemedCard>

      {/* Members list */}
      <Text style={{color:T.text,fontWeight:'700',fontSize:14,
        marginBottom:10,fontFamily:T.fontFamily}}>
        👥 Members
      </Text>
      {loading ? <ActivityIndicator color={T.primary}/> :
        members.map(m=>(
          <ThemedCard key={m.id} style={{marginBottom:8}}>
            <View style={{flexDirection:'row',alignItems:'center'}}>
              <View style={{width:40,height:40,borderRadius:20,backgroundColor:T.secondary,
                justifyContent:'center',alignItems:'center',marginRight:12}}>
                <Text style={{color:T.primary,fontWeight:'bold',fontSize:16}}>
                  {(m.first_name||m.email||'?')[0].toUpperCase()}
                </Text>
              </View>
              <View style={{flex:1}}>
                <Text style={{color:T.text,fontWeight:'600',fontSize:13}}>
                  {m.first_name} {m.last_name}
                </Text>
                <Text style={{color:T.sub,fontSize:11}}>{m.email}</Text>
              </View>
              <View style={{alignItems:'flex-end',gap:6}}>
                <View style={{backgroundColor:m.role==='admin'?T.secondary:'rgba(100,100,100,0.1)',
                  paddingHorizontal:8,paddingVertical:2,borderRadius:10}}>
                  <Text style={{color:m.role==='admin'?T.primary:T.sub,fontSize:11,fontWeight:'600'}}>
                    {m.role==='admin'?'Admin':'Viewer'}
                  </Text>
                </View>
                {m.id !== user?.userId && (
                  m.role==='admin' ? (
                    <TouchableOpacity onPress={()=>revokeAdmin(m.id)}>
                      <Text style={{color:T.danger,fontSize:11}}>Revoke</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={()=>grantAdmin(m.id)}>
                      <Text style={{color:T.primary,fontSize:11}}>Make Admin</Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            </View>
          </ThemedCard>
        ))
      }
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS TAB — Themes + Preferences
// ═══════════════════════════════════════════════════════════════════
function SettingsTab({ currentTheme, onThemeChange, user, onLogout }) {
  const T = useTheme();
  const [customColor, setCustomColor] = useState(T.primary);
  const [notifMotion, setNotifMotion] = useState(true);
  const [notifSound,  setNotifSound]  = useState(true);
  const [notifOnline, setNotifOnline] = useState(true);

  const COLOR_PRESETS = [
    '#00ff88','#4488ff','#ff4444','#ff9500',
    '#af52de','#ff2d55','#00c7be','#ffd700',
  ];

  return (
    <ScrollView style={{flex:1,backgroundColor:T.bg}} contentContainerStyle={{padding:16}}>

      {/* Theme Selector */}
      <Text style={{color:T.text,fontWeight:'700',fontSize:14,
        marginBottom:12,fontFamily:T.fontFamily}}>
        🎨 App Theme
      </Text>
      {Object.entries(THEMES).map(([key, theme])=>(
        <TouchableOpacity key={key}
          style={{flexDirection:'row',alignItems:'center',padding:14,borderRadius:T.radius,
            marginBottom:8,borderWidth:1.5,
            borderColor:currentTheme===key?theme.primary:T.border,
            backgroundColor:currentTheme===key?
              (theme.bg==='#f0f2f5'||theme.bg==='#f2f2f7'?'#e8f0fe':'rgba(255,255,255,0.05)')
              :T.card}}
          onPress={()=>onThemeChange(key)}>
          <View style={{width:28,height:28,borderRadius:14,
            backgroundColor:theme.primary,marginRight:12}}/>
          <View style={{flex:1}}>
            <Text style={{color:T.text,fontWeight:'600',fontSize:14}}>{theme.name}</Text>
            <Text style={{color:T.sub,fontSize:11,marginTop:2}}>
              {key==='operator'?'Dark tactical with neon green accents'
               :key==='life360'?'Clean white with blue — familiar safety app style'
               :key==='bubble'?'Frosted glass with rounded iOS aesthetics'
               :'Fully customizable colors and style'}
            </Text>
          </View>
          {currentTheme===key&&(
            <Text style={{color:theme.primary,fontSize:18,fontWeight:'bold'}}>✓</Text>
          )}
        </TouchableOpacity>
      ))}

      {/* Custom theme colors */}
      {currentTheme==='custom'&&(
        <ThemedCard style={{marginTop:8,marginBottom:16}}>
          <Text style={{color:T.text,fontWeight:'700',marginBottom:12}}>
            🎨 Custom Primary Color
          </Text>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>
            {COLOR_PRESETS.map(c=>(
              <TouchableOpacity key={c}
                style={{width:40,height:40,borderRadius:20,backgroundColor:c,
                  borderWidth:customColor===c?3:0,borderColor:'#fff'}}
                onPress={()=>{
                  setCustomColor(c);
                  onThemeChange('custom', {...THEMES.custom, primary:c, secondary:c+'20'});
                }}/>
            ))}
          </View>
        </ThemedCard>
      )}

      {/* Notifications */}
      <Text style={{color:T.text,fontWeight:'700',fontSize:14,
        marginBottom:12,marginTop:8,fontFamily:T.fontFamily}}>
        🔔 Notifications
      </Text>
      {[
        {label:'Motion Detected', sub:'Alert when camera detects movement', val:notifMotion, set:setNotifMotion},
        {label:'Sound Detected',  sub:'Alert when camera detects sound',    val:notifSound,  set:setNotifSound},
        {label:'Camera Online',   sub:'Alert when a camera comes online',   val:notifOnline, set:setNotifOnline},
      ].map(n=>(
        <ThemedCard key={n.label} style={{marginBottom:8,flexDirection:'row',alignItems:'center'}}>
          <View style={{flex:1}}>
            <Text style={{color:T.text,fontWeight:'600',fontSize:13}}>{n.label}</Text>
            <Text style={{color:T.sub,fontSize:11,marginTop:2}}>{n.sub}</Text>
          </View>
          <Switch value={n.val} onValueChange={n.set}
            trackColor={{false:T.border,true:T.primary}}
            thumbColor={n.val?'#fff':T.sub}/>
        </ThemedCard>
      ))}

      {/* Account */}
      <Text style={{color:T.text,fontWeight:'700',fontSize:14,
        marginBottom:12,marginTop:8,fontFamily:T.fontFamily}}>
        👤 Account
      </Text>
      <ThemedCard style={{marginBottom:8}}>
        <Text style={{color:T.sub,fontSize:12}}>Logged in as</Text>
        <Text style={{color:T.text,fontWeight:'600',fontSize:14,marginTop:4}}>
          {user?.email}
        </Text>
        <Text style={{color:T.sub,fontSize:12,marginTop:2}}>
          {user?.role==='admin'?'Administrator':'Viewer'} · {user?.org_name||'Organization'}
        </Text>
      </ThemedCard>

      {/* TODO: ENABLE PAYWALL — Subscription section */}
      <ThemedCard style={{marginBottom:16,borderColor:T.gold}}>
        <Text style={{color:T.gold,fontWeight:'700',marginBottom:4}}>⭐ Subscription</Text>
        <Text style={{color:T.text,fontSize:13,marginBottom:8}}>
          Free Plan · 14-day clip retention
        </Text>
        {/* TODO: ENABLE PAYWALL — uncomment upgrade button before production deploy */}
        {/* <ThemedButton label="Upgrade to Pro" onPress={()=>{}} style={{marginTop:4}}/> */}
        <Text style={{color:T.sub,fontSize:11}}>
          {/* TODO: ENABLE PAYWALL */}
          Upgrade coming soon — Pro: 60-day retention, 5 admins, priority support
        </Text>
      </ThemedCard>

      <ThemedButton label="🚪 Logout" onPress={onLogout} variant="danger"/>
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD — Bottom Tabs
// ═══════════════════════════════════════════════════════════════════
function Dashboard({ user, onLogout }) {
  const T = useTheme();
  const [devices,    setDevices]    = useState([]);
  const [onlineMap,  setOnlineMap]  = useState({});
  const [events,     setEvents]     = useState([]);
  const [socket,     setSocket]     = useState(null);
  const [eventBadge, setEventBadge] = useState(0);

  useEffect(()=>{
    loadDevices();
    connectViewerSocket();
    Notifications.requestPermissionsAsync();
    return ()=>{ socket?.disconnect(); };
  },[]);

  const loadDevices = async () => {
    try {
      const r = await api.get('/api/devices');
      setDevices(r.data.data||[]);
    } catch(e) { console.log(e.message); }
  };

  const connectViewerSocket = async () => {
    const token = await AsyncStorage.getItem('accessToken');
    if (!token) return;
    const s = io(API_URL, { auth:{ token }, transports:['websocket','polling'] });

    s.on('connect', ()=>{
      s.emit('auth',{
        userId: user.userId, organizationId: user.organizationId, role:'viewer',
      });
    });

    s.on('camera:online',  ({deviceId,deviceName})=>{
      setOnlineMap(m=>({...m,[deviceId]:{online:true,name:deviceName}}));
    });
    s.on('camera:offline', ({deviceId})=>{
      setOnlineMap(m=>({...m,[deviceId]:{...(m[deviceId]||{}),online:false}}));
    });
    s.on('motion:detected', data=>{
      const ev = {
        id:Date.now(), type:data.type||'motion',
        time:new Date().toLocaleTimeString(),
        deviceName:data.deviceName||'Camera',
        clip_url:null, clip_pending:false,
      };
      addEvent(ev);
      notify('🚨 Security Alert',`${ev.type==='motion'?'Motion':'Sound'} — ${ev.deviceName}`);
    });

    setSocket(s);
  };

  const addEvent = (e) => {
    if (e.type==='clip_ready') {
      setEvents(ev=>ev.map(x=>x.id===e.eventId?{...x,clip_url:e.clip_url,clip_pending:false}:x));
    } else {
      setEvents(ev=>[e,...ev].slice(0,100));
      setEventBadge(b=>b+1);
    }
  };

  const onDeviceEnrolled = (device) => {
    setDevices(d=>[...d, device]);
  };

  const tabIcon = (name) => {
    const icons = {
      Camera:'📷', Cameras:'👁', Discover:'🔍', Clips:'🎬', Events:'🔔', Admin:'👥', Settings:'⚙️',
    };
    return <Text style={{fontSize:20}}>{icons[name]||'•'}</Text>;
  };

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: T.card,
          borderTopColor: T.border,
          borderTopWidth: 1,
          height: Platform.OS==='ios' ? 82 : 62,
          paddingBottom: Platform.OS==='ios' ? 20 : 8,
        },
        tabBarActiveTintColor: T.primary,
        tabBarInactiveTintColor: T.sub,
        tabBarLabelStyle: { fontSize:10, fontFamily:T.fontFamily },
        tabBarIcon: ({color})=>tabIcon(route.name),
      })}
    >
      <Tab.Screen name="Camera">
        {()=>(<SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
          <CameraTab user={user} devices={devices} onEvent={addEvent}/>
        </SafeAreaView>)}
      </Tab.Screen>

      <Tab.Screen name="Cameras">
        {()=>(<SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
          <CamerasTab user={user} devices={devices} onlineMap={onlineMap} socket={socket}/>
        </SafeAreaView>)}
      </Tab.Screen>

      <Tab.Screen name="Discover">
        {()=>(<SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
          <DiscoverTab user={user} onDeviceEnrolled={onDeviceEnrolled}/>
        </SafeAreaView>)}
      </Tab.Screen>

      <Tab.Screen name="Clips">
        {()=>(<SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
          <ClipsTab/>
        </SafeAreaView>)}
      </Tab.Screen>

      <Tab.Screen name="Events"
        options={{
          tabBarBadge: eventBadge>0 ? eventBadge : undefined,
          tabBarBadgeStyle: { backgroundColor: T.danger },
        }}
        listeners={{ tabPress:()=>setEventBadge(0) }}>
        {()=>(<SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
          <EventsTab events={events}/>
        </SafeAreaView>)}
      </Tab.Screen>

      <Tab.Screen name="Admin">
        {()=>(<SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
          <AdminTab user={user}/>
        </SafeAreaView>)}
      </Tab.Screen>

      <Tab.Screen name="Settings">
        {()=>(<SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
          <SettingsTab
            currentTheme="operator"
            onThemeChange={()=>{}}
            user={user}
            onLogout={onLogout}/>
        </SafeAreaView>)}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP ROOT — Theme Provider
// ═══════════════════════════════════════════════════════════════════
function App() {
  const [ready,  setReady]  = useState(false);
  const [token,  setToken]  = useState(null);
  const [user,   setUser]   = useState(null);
  const [theme,  setTheme]  = useState('operator');
  const [customThemeData, setCustomThemeData] = useState(null);

  useEffect(()=>{
    Promise.all([
      AsyncStorage.getItem('accessToken'),
      AsyncStorage.getItem('appTheme'),
    ]).then(([tok, savedTheme])=>{
      if (tok) { setToken(tok); setUser(decodeJWT(tok)); }
      if (savedTheme) setTheme(savedTheme);
      setReady(true);
    });
  },[]);

  const handleLogin = (tok) => { setToken(tok); setUser(decodeJWT(tok)); };
  const handleLogout = async () => {
    await AsyncStorage.removeItem('accessToken');
    setToken(null); setUser(null);
  };
  const handleThemeChange = async (key, customData) => {
    setTheme(key);
    if (customData) setCustomThemeData(customData);
    await AsyncStorage.setItem('appTheme', key);
  };

  const activeTheme = theme==='custom' && customThemeData
    ? customThemeData
    : THEMES[theme] || THEMES.operator;

  if (!ready) return (
    <ThemeContext.Provider value={THEMES.operator}>
      <View style={{flex:1,backgroundColor:'#050505',justifyContent:'center',alignItems:'center'}}>
        <Text style={{fontSize:56,marginBottom:12}}>🔒</Text>
        <Text style={{color:'#00ff88',fontSize:22,fontWeight:'bold'}}>Real Security Camera</Text>
        <ActivityIndicator color="#00ff88" style={{marginTop:24}}/>
      </View>
    </ThemeContext.Provider>
  );

  return (
    <ThemeContext.Provider value={activeTheme}>
      <StatusBar barStyle={activeTheme.bg==='#f0f2f5'||activeTheme.bg==='#f2f2f7'
        ?'dark-content':'light-content'}/>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{headerShown:false}}>
          {!token ? (
            <>
              <Stack.Screen name="Login">
                {p=><LoginScreen {...p} onLogin={handleLogin}/>}
              </Stack.Screen>
              <Stack.Screen name="Register">
                {p=><RegisterScreen {...p} onLogin={handleLogin}/>}
              </Stack.Screen>
            </>
          ) : (
            <Stack.Screen name="Dashboard">
              {p=><Dashboard {...p} user={user} onLogout={handleLogout}/>}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeContext.Provider>
  );
}

// ─── Style helpers ────────────────────────────────────────────────
const inputStyle = (T) => ({
  backgroundColor: T.bg==='#f0f2f5'||T.bg==='#f2f2f7' ? '#fff' : '#1a1a1a',
  color: T.text,
  padding: 13,
  borderRadius: T.radius,
  fontSize: 15,
  borderWidth: 1,
  borderColor: T.border,
  fontFamily: T.fontFamily,
});

registerRootComponent(App);
