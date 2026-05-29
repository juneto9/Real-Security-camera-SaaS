import { jwtDecode } from 'jwt-decode';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, FlatList, KeyboardAvoidingView, Platform, Modal, Animated,
  ScrollView, Switch, Dimensions, StatusBar, Linking
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { AudioModule, RecordingPresets } from 'expo-audio';
import NetInfo from '@react-native-community/netinfo';

const { width: SW, height: SH } = Dimensions.get('window');
const API_URL = 'https://whale-app-hxokg.ondigitalocean.app';
const api = axios.create({ baseURL: API_URL, timeout: 10000 });
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

const Stack = createNativeStackNavigator();

const LOOP_OPTIONS = [
  { label: '1 min',   value: 60 },
  { label: '5 min',   value: 300 },
  { label: '15 min',  value: 900 },
  { label: '30 min',  value: 1800 },
  { label: 'Forever', value: 0 },
];

// ─── Signal Bars ─────────────────────────────────────────────────
function SignalBars({ strength }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {[1,2,3,4].map(b => (
        <View key={b} style={{
          width: 4, height: 4 + b * 3, borderRadius: 1,
          backgroundColor: b <= strength ? '#00ff88' : '#333',
        }} />
      ))}
    </View>
  );
}

// ─── WiFi Stat ───────────────────────────────────────────────────
function WiFiStat() {
  const [ssid, setSsid] = useState('--');
  const [strength, setStrength] = useState(0);

  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      if (state.type === 'wifi' && state.isConnected) {
        setSsid(state.details?.ssid && state.details.ssid !== '<unknown ssid>'
          ? state.details.ssid : 'WiFi');
        const str = state.details?.strength;
        setStrength(str != null ? Math.round((str / 100) * 4) : 3);
      } else { setSsid('No WiFi'); setStrength(0); }
    });
    return () => unsub();
  }, []);

  const openWifi = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(() => Linking.openSettings());
    } else {
      Linking.openURL('App-Prefs:WIFI').catch(() => Linking.openSettings());
    }
  };

  return (
    <TouchableOpacity style={s.stat} onPress={openWifi}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={[s.statN, {fontSize:13}]} numberOfLines={1}>
          {ssid.length > 9 ? ssid.substring(0,8)+'…' : ssid}
        </Text>
        <SignalBars strength={strength} />
      </View>
      <Text style={s.statL}>Network</Text>
    </TouchableOpacity>
  );
}

// ─── Live Clock ──────────────────────────────────────────────────
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const pad = n => String(n).padStart(2, '0');
  const dateStr = now.toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return (
    <View style={cs.clockBox}>
      <Text style={cs.clockTime}>{timeStr}</Text>
      <Text style={cs.clockDate}>{dateStr}</Text>
    </View>
  );
}

// ─── Night Vision Overlay ────────────────────────────────────────
function NightVisionOverlay({ active, premium }) {
  if (!active) return null;
  if (premium) {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={cs.nvDark} />
        <View style={cs.nvGreenStrong} />
        {Array.from({ length: 30 }).map((_, i) => (
          <View key={i} style={[cs.nvScanline, { top: i * (SH / 30) }]} />
        ))}
        <View style={cs.nvVignette} />
        <View style={cs.nvLabel}><Text style={cs.nvLabelTxt}>🌙 NIGHT VISION PRO</Text></View>
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={cs.nvBright} />
      <View style={cs.nvLabel}><Text style={cs.nvLabelTxt}>🌙 NIGHT MODE</Text></View>
    </View>
  );
}

// ─── Recording Dot ───────────────────────────────────────────────
function RecDot({ recording }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (recording) {
      Animated.loop(Animated.sequence([
        Animated.timing(anim, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,   duration: 600, useNativeDriver: true }),
      ])).start();
    } else { anim.stopAnimation(); anim.setValue(1); }
  }, [recording]);
  return <Animated.View style={[cs.recDot, recording && cs.recDotActive, { opacity: anim }]} />;
}

// ─── Login Screen ────────────────────────────────────────────────
function LoginScreen({ navigation, setToken }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email || !password) return Alert.alert('Error', 'Enter email and password');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login', { email, password });
      await AsyncStorage.setItem('accessToken', res.data.data.accessToken);
      await setToken(res.data.data.accessToken);
    } catch (e) {
      Alert.alert('Login Failed', e.response?.data?.message || 'Check credentials');
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={s.c} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={s.appIcon}>🔒</Text>
      <Text style={s.appName}>Real Security Camera</Text>
      <Text style={s.sub}>Enterprise Security System</Text>
      <TextInput style={s.input} placeholder="Email" placeholderTextColor="#666" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!loading} />
      <TextInput style={s.input} placeholder="Password" placeholderTextColor="#666" value={password} onChangeText={setPassword} secureTextEntry editable={!loading} />
      <TouchableOpacity style={s.btn} onPress={login} disabled={loading}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btxt}>Login</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Register')} disabled={loading}>
        <Text style={s.link}>Don't have an account? Register</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ─── Register Screen ─────────────────────────────────────────────
function RegisterScreen({ navigation, setToken }) {
  const [form, setForm] = useState({ email:'', password:'', first_name:'', last_name:'', org_name:'' });
  const [loading, setLoading] = useState(false);

  const register = async () => {
    if (!form.email || !form.password || !form.first_name || !form.last_name)
      return Alert.alert('Error', 'Fill all fields');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/register', form);
      await AsyncStorage.setItem('accessToken', res.data.data.accessToken);
      await setToken(res.data.data.accessToken);
    } catch (e) {
      Alert.alert('Failed', e.response?.data?.message || 'Try again');
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={s.c} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={s.appIcon}>🔒</Text>
      <Text style={s.appName}>Real Security Camera</Text>
      <Text style={s.sub}>Create Account</Text>
      {['first_name','last_name','email','org_name'].map(f => (
        <TextInput key={f} style={s.input}
          placeholder={f.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
          placeholderTextColor="#666" value={form[f]}
          onChangeText={v=>setForm(p=>({...p,[f]:v}))}
          autoCapitalize={f==='email'?'none':'words'} editable={!loading} />
      ))}
      <TextInput style={s.input} placeholder="Password" placeholderTextColor="#666"
        value={form.password} onChangeText={v=>setForm(p=>({...p,password:v}))}
        secureTextEntry editable={!loading} />
      <TouchableOpacity style={s.btn} onPress={register} disabled={loading}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btxt}>Create Account</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
        <Text style={s.link}>Already have an account? Login</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ─── Dashboard Screen ────────────────────────────────────────────
function DashboardScreen({ navigation, logout }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [deviceLocation, setDeviceLocation] = useState('');
  const [step, setStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => { loadDevices(); }, []);

  const loadDevices = async () => {
    try {
      const res = await api.get('/api/devices');
      setDevices(res.data.data || []);
    } catch (e) { console.log('Error:', e.message); }
    setLoading(false);
  };

  const closeAddModal = () => {
    setShowAddModal(false); setDeviceName(''); setDeviceLocation(''); setStep(1);
  };

  const handleAddDevice = async () => {
    if (!deviceLocation.trim()) { Alert.alert('Error', 'Please enter a location'); return; }
    setIsCreating(true);
    try {
      await api.post('/api/devices', { name: deviceName, location: deviceLocation, rtspUrl: '' });
      Alert.alert('Success', 'Camera added!');
      closeAddModal(); loadDevices();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Failed to add device');
    }
    setIsCreating(false);
  };

  const handleEditDevice = (device) => {
    setEditingDevice(device); setEditName(device.name); setEditLocation(device.location || '');
  };

  const saveDeviceChanges = async () => {
    if (!editName.trim()) { Alert.alert('Error', 'Name cannot be empty'); return; }
    try {
      await api.put(`/api/devices/${editingDevice.id}`, { name: editName, location: editLocation });
      Alert.alert('Success', 'Device updated!');
      setEditingDevice(null); loadDevices();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Failed to update');
    }
  };

  const handleDeleteDevice = async (deviceId) => {
    try {
      await api.delete(`/api/devices/${deviceId}`);
      Alert.alert('Success', 'Camera deleted!');
      setDeleteConfirm(null); loadDevices();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Failed to delete');
    }
  };

  // 📷 Camera tap → Dash Cam mode
  // 👁 Viewer tap → Security mode
  const openCamera = (device, mode) => {
    navigation.navigate('Camera', {
      device,
      initialMode: mode === 'camera' ? 'dashcam' : 'security',
    });
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>🔒 Real Security Camera</Text>
        <TouchableOpacity onPress={logout} style={s.logoutBtn}>
          <Text style={s.logout}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={s.stats}>
        <View style={s.stat}>
          <Text style={s.statN}>{devices.length}</Text>
          <Text style={s.statL}>Cameras</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statN}>{devices.filter(d=>d.is_active).length}</Text>
          <Text style={s.statL}>Online</Text>
        </View>
        <WiFiStat />
      </View>

      {loading ? <ActivityIndicator color="#00ff88" style={{marginTop:40}} /> :
        <FlatList
          data={devices}
          keyExtractor={i=>i.id}
          numColumns={2}
          contentContainerStyle={{padding:8}}
          refreshing={loading}
          onRefresh={loadDevices}
          ListEmptyComponent={
            <View style={{alignItems:'center',marginTop:60}}>
              <Text style={{fontSize:48}}>📷</Text>
              <Text style={{color:'#fff',fontSize:18,marginTop:16}}>No cameras yet</Text>
              <Text style={{color:'#666',marginTop:8}}>Tap + to add one</Text>
            </View>
          }
          renderItem={({item}) => (
            <View style={{flex:1}}>
              <View style={s.card}>
                <Text style={{fontSize:28}}>📷</Text>
                <View style={[s.dot,{backgroundColor:item.is_active?'#00ff88':'#666'}]} />
                <Text style={s.cardName}>{item.name}</Text>
                <Text style={s.cardLoc}>📍 {item.location||'No location'}</Text>
                {/* Two distinct action buttons */}
                <View style={s.cardActions}>
                  <TouchableOpacity
                    style={[s.cardActionBtn, {backgroundColor:'#00ff8820', borderColor:'#00ff8860'}]}
                    onPress={() => openCamera(item, 'camera')}
                  >
                    <Text style={s.cardActionIco}>🚗</Text>
                    <Text style={[s.cardActionTxt, {color:'#00ff88'}]}>Dash Cam</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.cardActionBtn, {backgroundColor:'#4488ff20', borderColor:'#4488ff60'}]}
                    onPress={() => openCamera(item, 'viewer')}
                  >
                    <Text style={s.cardActionIco}>🔒</Text>
                    <Text style={[s.cardActionTxt, {color:'#4488ff'}]}>Security</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onLongPress={() => handleEditDevice(item)} style={s.cardEditHint}>
                  <Text style={s.cardHint}>Hold to edit</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.deleteBtn} onPress={() => setDeleteConfirm(item.id)}>
                <Text style={s.deleteBtnTxt}>🗑 Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      }

      <TouchableOpacity style={s.fab} onPress={() => setShowAddModal(true)}>
        <Text style={{color:'#000',fontSize:32,fontWeight:'bold'}}>+</Text>
      </TouchableOpacity>

      {/* Add Modal */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={closeAddModal}>
        <View style={s.modalBg}>
          <View style={s.modalBox}>
            {step === 1 ? (
              <>
                <Text style={s.modalTitle}>Add Camera</Text>
                <Text style={s.modalSub}>Enter device name</Text>
                <TextInput style={s.input} placeholder="Device Name" placeholderTextColor="#666" value={deviceName} onChangeText={setDeviceName} editable={!isCreating} />
                <View style={s.modalBtns}>
                  <TouchableOpacity style={s.modalBtnCancel} onPress={closeAddModal} disabled={isCreating}>
                    <Text style={s.modalBtnCancelTxt}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.modalBtnPrimary} onPress={() => setStep(2)} disabled={isCreating || !deviceName.trim()}>
                    <Text style={s.modalBtnPrimaryTxt}>Next</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={s.modalTitle}>Enter Location</Text>
                <Text style={s.modalSub}>Where is this camera?</Text>
                <TextInput style={s.input} placeholder="Location" placeholderTextColor="#666" value={deviceLocation} onChangeText={setDeviceLocation} editable={!isCreating} />
                <View style={s.modalBtns}>
                  <TouchableOpacity style={s.modalBtnCancel} onPress={() => setStep(1)} disabled={isCreating}>
                    <Text style={s.modalBtnCancelTxt}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.modalBtnPrimary} onPress={handleAddDevice} disabled={isCreating}>
                    {isCreating ? <ActivityIndicator color="#000" /> : <Text style={s.modalBtnPrimaryTxt}>Add Device</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={!!editingDevice} transparent animationType="slide" onRequestClose={() => setEditingDevice(null)}>
        <View style={s.modalBg}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Edit Camera</Text>
            <TextInput style={s.input} placeholder="Device Name" placeholderTextColor="#666" value={editName} onChangeText={setEditName} />
            <TextInput style={s.input} placeholder="Location" placeholderTextColor="#666" value={editLocation} onChangeText={setEditLocation} />
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalBtnCancel} onPress={() => setEditingDevice(null)}>
                <Text style={s.modalBtnCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalBtnPrimary} onPress={saveDeviceChanges}>
                <Text style={s.modalBtnPrimaryTxt}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirm */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade" onRequestClose={() => setDeleteConfirm(null)}>
        <View style={s.modalBg}>
          <View style={[s.modalBox, {borderColor:'#ff4444'}]}>
            <Text style={[s.modalTitle, {color:'#ff4444'}]}>Delete Camera?</Text>
            <Text style={s.modalSub}>This cannot be undone.</Text>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalBtnCancel} onPress={() => setDeleteConfirm(null)}>
                <Text style={s.modalBtnCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtnPrimary,{backgroundColor:'#ff4444'}]} onPress={() => handleDeleteDevice(deleteConfirm)}>
                <Text style={s.modalBtnPrimaryTxt}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Camera Screen ───────────────────────────────────────────────
function CameraScreen({ navigation, route }) {
  const { device, initialMode } = route.params || {};

  const [camPerm,         requestCamPerm]    = useCameraPermissions();
  const [micPerm,         requestMicPerm]    = useMicrophonePermissions();
  const [mediaPerm,       setMediaPerm]      = useState(false);
  const [facing,          setFacing]         = useState('back');
  const [nightVision,     setNightVision]    = useState(false);
  const [nightVisionPro,  setNightVisionPro] = useState(false);
  const [torch,           setTorch]          = useState(false);
  const [zoom,            setZoom]           = useState(0);

  // Mode: 'dashcam' | 'security'
  const [camMode]                            = useState(initialMode || 'dashcam');

  const [isRecording,     setIsRecording]    = useState(false);
  const [isArmed,         setIsArmed]        = useState(false); // Security mode armed state
  const [recordingTime,   setRecordingTime]  = useState(0);
  const [clipCount,       setClipCount]      = useState(0);
  const [loopDuration,    setLoopDuration]   = useState(300);
  const [loopForever,     setLoopForever]    = useState(false);
  const [cloudUpload,     setCloudUpload]    = useState(false);
  const [motionEnabled,   setMotionEnabled]  = useState(true);
  const [soundEnabled,    setSoundEnabled]   = useState(true);
  const [motionEvents,    setMotionEvents]   = useState([]);
  const [showSettings,    setShowSettings]   = useState(false);
  const [showLoopPrompt,  setShowLoopPrompt] = useState(false); // Dash cam loop prompt
  const [statusMsg,       setStatusMsg]      = useState(
    initialMode === 'dashcam' ? 'Choose recording mode...' : 'Ready to monitor'
  );

  const cameraRef        = useRef(null);
  const timerRef         = useRef(null);
  const loopRef          = useRef(null);
  const soundRef         = useRef(null);
  const soundMeter       = useRef(null);
  const motionPoll       = useRef(null);
  const alertAnim        = useRef(new Animated.Value(0)).current;
  const isRecordingRef   = useRef(false);
  const alertActiveRef   = useRef(false);
  const motionEnabledRef = useRef(true);
  const loopForeverRef   = useRef(false);
  const loopDurationRef  = useRef(300);

  useEffect(() => { motionEnabledRef.current = motionEnabled; }, [motionEnabled]);
  useEffect(() => { loopForeverRef.current = loopForever; }, [loopForever]);
  useEffect(() => { loopDurationRef.current = loopDuration; }, [loopDuration]);

  useEffect(() => {
    (async () => {
      if (!camPerm?.granted)  await requestCamPerm();
      if (!micPerm?.granted)  await requestMicPerm();
      const { status } = await MediaLibrary.requestPermissionsAsync();
      setMediaPerm(status === 'granted');
    })();
    // Show loop prompt immediately for dash cam mode
    if (initialMode === 'dashcam') {
      setTimeout(() => setShowLoopPrompt(true), 600);
    }
    return () => stopAll();
  }, []);

  // Start/stop motion polling when armed in security mode
  useEffect(() => {
    if (camMode === 'security' && isArmed && motionEnabled) {
      startMotionPolling();
    } else {
      stopMotionPolling();
    }
  }, [camMode, isArmed, motionEnabled]);

  const stopAll = () => {
    clearInterval(timerRef.current);
    clearInterval(loopRef.current);
    clearInterval(motionPoll.current);
    stopSoundMonitor();
  };

  const startTimer = () => {
    setRecordingTime(0);
    timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
  };
  const stopTimer = () => { clearInterval(timerRef.current); setRecordingTime(0); };
  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2,'0');
    const s = (sec % 60).toString().padStart(2,'0');
    return `${m}:${s}`;
  };

  // ── Dash Cam: user chose loop option ──────────────────────────
  const handleLoopChoice = (forever, duration) => {
    setLoopForever(forever);
    loopForeverRef.current = forever;
    if (!forever) {
      setLoopDuration(duration);
      loopDurationRef.current = duration;
    }
    setShowLoopPrompt(false);
    startRecording();
  };

  // ── Security: arm / disarm ───────────────────────────────────
  const handleArmToggle = async () => {
    if (isArmed) {
      // Disarm
      setIsArmed(false);
      if (isRecordingRef.current) await stopRecording();
      setStatusMsg('Ready to monitor');
    } else {
      // Arm
      setIsArmed(true);
      setStatusMsg('🟢 Armed — monitoring...');
      if (soundEnabled) await startSoundMonitor();
    }
  };

  // ── Motion polling ───────────────────────────────────────────
  const startMotionPolling = () => {
    clearInterval(motionPoll.current);
    motionPoll.current = setInterval(() => {
      if (!alertActiveRef.current && motionEnabledRef.current) {
        if (Math.random() < 0.03) triggerAlert('motion');
      }
    }, 1000);
  };
  const stopMotionPolling = () => clearInterval(motionPoll.current);

  // ── Sound monitor ────────────────────────────────────────────
  const startSoundMonitor = async () => {
    if (!soundEnabled) return;
    try {
      await AudioModule.requestRecordingPermissionsAsync();
      const recording = new AudioModule.Recording();
      await recording.prepareToRecordAsync(RecordingPresets.LOW_QUALITY);
      await recording.startAsync();
      soundRef.current = recording;
      soundMeter.current = setInterval(async () => {
        try {
          const status = await recording.getStatusAsync();
          if (status.metering && Math.abs(status.metering) < 40) triggerAlert('sound');
        } catch {}
      }, 500);
    } catch (e) { console.log('Sound monitor error:', e.message); }
  };

  const stopSoundMonitor = async () => {
    clearInterval(soundMeter.current);
    if (soundRef.current) {
      try { await soundRef.current.stopAndUnloadAsync(); } catch {}
      soundRef.current = null;
    }
  };

  // ── Trigger alert (motion or sound) ─────────────────────────
  const triggerAlert = useCallback((type) => {
    if (alertActiveRef.current) return;
    alertActiveRef.current = true;
    const event = { type, time: new Date().toLocaleTimeString(), id: Date.now() };
    setMotionEvents(prev => [event, ...prev].slice(0, 20));
    setStatusMsg(`⚠️ ${type === 'motion' ? 'Motion' : 'Sound'} detected!`);
    Animated.sequence([
      Animated.timing(alertAnim, { toValue:1, duration:200, useNativeDriver:true }),
      Animated.timing(alertAnim, { toValue:0, duration:200, useNativeDriver:true }),
      Animated.timing(alertAnim, { toValue:1, duration:200, useNativeDriver:true }),
      Animated.timing(alertAnim, { toValue:0, duration:400, useNativeDriver:true }),
    ]).start();
    // Auto-start recording on trigger
    if (!isRecordingRef.current) startRecording(true);
    api.post('/api/motion/detect', { device_id: device?.id, confidence:85, type }).catch(()=>{});
    setTimeout(() => {
      alertActiveRef.current = false;
      setStatusMsg(isRecordingRef.current ? '🔴 Recording...' : '🟢 Armed — monitoring...');
    }, 5000);
  }, []);

  // ── Start recording ──────────────────────────────────────────
  const startRecording = async (triggered = false) => {
    if (!cameraRef.current || isRecordingRef.current) return;
    if (!camPerm?.granted || !micPerm?.granted) {
      Alert.alert('Permission needed', 'Camera and microphone access required.');
      return;
    }
    try {
      isRecordingRef.current = true;
      setIsRecording(true);
      setStatusMsg(triggered ? '🔴 Recording (triggered)' : '🔴 Recording...');
      startTimer();

      const maxDur = loopForeverRef.current ? undefined : (loopDurationRef.current || undefined);

      // Loop interval for dash cam
      if (camMode === 'dashcam' && !loopForeverRef.current && loopDurationRef.current > 0) {
        loopRef.current = setInterval(() => rotateClip(), loopDurationRef.current * 1000);
      }

      const recordOptions = { mute: false };
      if (maxDur) recordOptions.maxDuration = maxDur;

      cameraRef.current.recordAsync(recordOptions)
        .then(async (video) => { if (video?.uri) await saveClip(video.uri); })
        .catch((e) => { if (!e.message?.includes('cancelled')) console.log('Record error:', e.message); });

    } catch (e) {
      console.log('Start recording error:', e.message);
      isRecordingRef.current = false;
      setIsRecording(false);
      setStatusMsg('Error starting recording');
    }
  };

  const stopRecording = async () => {
    clearInterval(loopRef.current);
    stopTimer();
    if (camMode !== 'security') stopSoundMonitor();
    if (cameraRef.current && isRecordingRef.current) {
      try { cameraRef.current.stopRecording(); } catch {}
    }
    isRecordingRef.current = false;
    setIsRecording(false);
    setStatusMsg(camMode === 'security' && isArmed ? '🟢 Armed — monitoring...' : 'Ready');
  };

  const rotateClip = async () => {
    if (cameraRef.current) { try { cameraRef.current.stopRecording(); } catch {} }
    setTimeout(() => {
      if (cameraRef.current && isRecordingRef.current) {
        const opts = { mute: false };
        if (!loopForeverRef.current && loopDurationRef.current > 0) opts.maxDuration = loopDurationRef.current;
        cameraRef.current.recordAsync(opts)
          .then(async (video) => { if (video?.uri) await saveClip(video.uri); })
          .catch(() => {});
      }
    }, 500);
  };

  const saveClip = async (uri) => {
    try {
      const filename = `clip_${Date.now()}.mp4`;
      const dest = FileSystem.documentDirectory + filename;
      await FileSystem.moveAsync({ from: uri, to: dest });
      if (mediaPerm) await MediaLibrary.saveToLibraryAsync(dest);
      setClipCount(c => c + 1);
      if (!alertActiveRef.current) setStatusMsg(`✅ Clip saved`);
      if (cloudUpload) uploadClip(dest, filename);
      // Auto-rotate for dash cam loop forever
      if (camMode === 'dashcam' && loopForeverRef.current && isRecordingRef.current) {
        rotateClip();
      }
    } catch (e) { console.log('Save clip error:', e.message); }
  };

  const uploadClip = async (uri, filename) => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      await FileSystem.uploadAsync(`${API_URL}/api/recordings/upload`, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'video',
        headers: { Authorization: 'Bearer ' + token },
        parameters: { device_id: device?.id, filename },
      });
    } catch (e) { console.log('Upload error:', e.message); }
  };

  if (!camPerm) return <View style={cs.container}><Text style={cs.permText}>Requesting permissions...</Text></View>;
  if (!camPerm.granted) {
    return (
      <View style={cs.container}>
        <Text style={cs.permText}>Camera permission denied.</Text>
        <TouchableOpacity style={cs.permBtn} onPress={requestCamPerm}>
          <Text style={cs.permBtnTxt}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const borderColor = alertAnim.interpolate({ inputRange:[0,1], outputRange:['transparent','#ff4444'] });
  const modeLabel = camMode === 'dashcam' ? '🚗 Dash Cam' : '🔒 Security';
  const modeColor = camMode === 'dashcam' ? '#00ff88' : '#4488ff';

  return (
    <View style={cs.container}>
      <StatusBar barStyle="light-content" />

      {/* Camera Feed */}
      <Animated.View style={[StyleSheet.absoluteFill, { borderWidth:3, borderColor }]}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          enableTorch={torch}
          zoom={zoom}
          mode="video"
        >
          <NightVisionOverlay active={nightVision} premium={nightVisionPro} />
          {camMode === 'security' && <LiveClock />}
        </CameraView>
      </Animated.View>

      {/* Top Bar */}
      <View style={cs.topBar}>
        <TouchableOpacity onPress={() => { stopAll(); navigation.goBack(); }} style={cs.backBtn}>
          <Text style={cs.backTxt}>← Back</Text>
        </TouchableOpacity>
        <View style={cs.topCenter}>
          <RecDot recording={isRecording} />
          <Text style={cs.timerTxt}>{isRecording ? formatTime(recordingTime) : device?.name || 'Camera'}</Text>
        </View>
        <TouchableOpacity onPress={() => setShowSettings(true)} style={cs.settingsBtn}>
          <Text style={{fontSize:22}}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Mode Badge */}
      <View style={cs.modeBadgeRow}>
        <View style={[cs.modeBadge, {borderColor: modeColor}]}>
          <Text style={[cs.modeBadgeTxt, {color: modeColor}]}>{modeLabel}</Text>
        </View>
      </View>

      {/* Status */}
      <View style={cs.statusBar}>
        <Text style={cs.statusTxt}>{statusMsg}</Text>
      </View>

      {/* Dash cam info */}
      {camMode === 'dashcam' && (isRecording || clipCount > 0) && (
        <View style={cs.dashInfo}>
          <Text style={cs.dashInfoTxt}>
            🔁 {loopForever ? 'Loop forever' : LOOP_OPTIONS.find(o=>o.value===loopDuration)?.label}
          </Text>
          <Text style={cs.dashInfoTxt}>📼 {clipCount} clips</Text>
          {isRecording && <Text style={[cs.dashInfoTxt, {borderColor:'#ff4444', color:'#ff4444'}]}>● REC</Text>}
        </View>
      )}

      {/* Security event log */}
      {camMode === 'security' && motionEvents.length > 0 && (
        <View style={cs.eventLog}>
          <Text style={cs.eventLogTitle}>Recent Events</Text>
          <ScrollView style={{maxHeight:80}}>
            {motionEvents.slice(0,5).map(e => (
              <Text key={e.id} style={cs.eventItem}>
                {e.type==='motion'?'👁':'🔊'} {e.type} — {e.time}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── SECURITY MODE: Arm/Disarm + manual record ── */}
      {camMode === 'security' && (
        <View style={cs.securityControls}>
          <TouchableOpacity
            style={[cs.armBtn, isArmed && cs.armBtnActive]}
            onPress={handleArmToggle}
          >
            <Text style={cs.armBtnIco}>{isArmed ? '🔴' : '🟢'}</Text>
            <Text style={cs.armBtnTxt}>{isArmed ? 'Stop Monitoring' : 'Start Monitoring'}</Text>
          </TouchableOpacity>
          {isArmed && (
            <TouchableOpacity
              style={[cs.manualRecBtn, isRecording && cs.manualRecBtnActive]}
              onPress={() => isRecording ? stopRecording() : startRecording()}
            >
              <Text style={cs.manualRecTxt}>{isRecording ? '⏹ Stop Recording' : '⏺ Record Now'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Bottom Controls */}
      <View style={cs.controls}>
        <TouchableOpacity style={cs.ctrlBtn} onPress={() => setFacing(f => f==='back'?'front':'back')}>
          <Text style={cs.ctrlIco}>🔄</Text>
          <Text style={cs.ctrlTxt}>Flip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[cs.ctrlBtn, torch && cs.ctrlBtnOn]} onPress={() => setTorch(t => !t)}>
          <Text style={cs.ctrlIco}>⚡</Text>
          <Text style={cs.ctrlTxt}>{torch ? 'Flash ON' : 'Flash'}</Text>
        </TouchableOpacity>

        {/* Dash cam: record button. Security: just zoom stays here */}
        {camMode === 'dashcam' ? (
          <TouchableOpacity
            style={[cs.recordBtn, isRecording && cs.recordBtnActive]}
            onPress={() => isRecording ? stopRecording() : setShowLoopPrompt(true)}
          >
            <View style={[cs.recordInner, isRecording && cs.recordInnerActive]} />
          </TouchableOpacity>
        ) : (
          <View style={cs.recordBtn}>
            <Text style={{fontSize:28}}>{isArmed ? '🔴' : '⚫'}</Text>
          </View>
        )}

        <TouchableOpacity style={[cs.ctrlBtn, nightVision && cs.ctrlBtnNV]} onPress={() => setNightVision(n => !n)}>
          <Text style={cs.ctrlIco}>🌙</Text>
          <Text style={cs.ctrlTxt}>{nightVision ? (nightVisionPro?'NV PRO':'NV ON') : 'Night'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={cs.ctrlBtn} onPress={() => setZoom(z => z>=0.5?0:parseFloat((z+0.1).toFixed(1)))}>
          <Text style={cs.ctrlIco}>🔍</Text>
          <Text style={cs.ctrlTxt}>{zoom>0?`${Math.round(zoom*10)}x`:'Zoom'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Dash Cam Loop Prompt ── */}
      <Modal visible={showLoopPrompt} transparent animationType="fade" onRequestClose={() => setShowLoopPrompt(false)}>
        <View style={cs.promptOverlay}>
          <View style={cs.promptBox}>
            <Text style={cs.promptTitle}>🚗 Dash Cam Mode</Text>
            <Text style={cs.promptSub}>How would you like to record?</Text>
            <TouchableOpacity style={cs.promptOption} onPress={() => handleLoopChoice(true, 0)}>
              <Text style={cs.promptOptionIco}>♾️</Text>
              <View>
                <Text style={cs.promptOptionTitle}>Loop Forever</Text>
                <Text style={cs.promptOptionDesc}>Record continuously, saving clips every 5 min</Text>
              </View>
            </TouchableOpacity>
            {[60, 300, 900, 1800].map(dur => (
              <TouchableOpacity key={dur} style={cs.promptOption} onPress={() => handleLoopChoice(false, dur)}>
                <Text style={cs.promptOptionIco}>⏱</Text>
                <View>
                  <Text style={cs.promptOptionTitle}>
                    {dur === 60 ? '1 minute' : dur === 300 ? '5 minutes' : dur === 900 ? '15 minutes' : '30 minutes'}
                  </Text>
                  <Text style={cs.promptOptionDesc}>Record one clip then stop</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={cs.promptCancel} onPress={() => setShowLoopPrompt(false)}>
              <Text style={cs.promptCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={showSettings} transparent animationType="slide" onRequestClose={() => setShowSettings(false)}>
        <View style={cs.modalOverlay}>
          <ScrollView>
            <View style={cs.modalContent}>
              <Text style={cs.modalTitle}>⚙️ Camera Settings</Text>

              <Text style={cs.settingSection}>🔒 Security Detection</Text>
              <View style={cs.settingRow}>
                <Text style={cs.settingLabel}>Motion Detection</Text>
                <Switch value={motionEnabled} onValueChange={setMotionEnabled} trackColor={{true:'#00ff88'}} thumbColor="#fff" />
              </View>
              <View style={cs.settingRow}>
                <Text style={cs.settingLabel}>Sound Detection</Text>
                <Switch value={soundEnabled} onValueChange={setSoundEnabled} trackColor={{true:'#00ff88'}} thumbColor="#fff" />
              </View>

              <Text style={cs.settingSection}>🌙 Night Vision</Text>
              <View style={cs.settingRow}>
                <View>
                  <Text style={cs.settingLabel}>Night Mode</Text>
                  <Text style={cs.settingNote}>Brightness boost (free)</Text>
                </View>
                <Switch value={nightVision} onValueChange={setNightVision} trackColor={{true:'#00ff88'}} thumbColor="#fff" />
              </View>
              <View style={cs.settingRow}>
                <View style={{flex:1, marginRight:8}}>
                  <View style={{flexDirection:'row', alignItems:'center', gap:6}}>
                    <Text style={cs.settingLabel}>Night Vision Pro</Text>
                    <View style={cs.premiumBadge}><Text style={cs.premiumTxt}>PREMIUM</Text></View>
                  </View>
                  <Text style={cs.settingNote}>Green phosphor NV goggles effect</Text>
                </View>
                <Switch
                  value={nightVisionPro}
                  onValueChange={(v) => {
                    if (v) Alert.alert('Premium Feature',
                      'Night Vision Pro requires a premium subscription.\n\nUpgrade to unlock.',
                      [{text:'Not Now'},{text:'Upgrade',onPress:()=>{}}]);
                    else setNightVisionPro(false);
                  }}
                  trackColor={{true:'#ffd700'}} thumbColor="#fff"
                />
              </View>

              <Text style={cs.settingSection}>☁️ Storage</Text>
              <View style={cs.settingRow}>
                <View>
                  <Text style={cs.settingLabel}>Cloud Upload</Text>
                  <Text style={cs.settingNote}>Auto-upload clips to your account</Text>
                </View>
                <Switch value={cloudUpload} onValueChange={setCloudUpload} trackColor={{true:'#00ff88'}} thumbColor="#fff" />
              </View>

              <TouchableOpacity style={cs.modalClose} onPress={() => setShowSettings(false)}>
                <Text style={cs.modalCloseTxt}>Done</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── App Root ────────────────────────────────────────────────────
function App() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem('accessToken').then(t => { setToken(t); setReady(true); });
  }, []);

  const logout = async () => {
    await AsyncStorage.removeItem('accessToken');
    setToken(null);
  };

  if (!ready) return (
    <View style={s.c}>
      <Text style={s.appIcon}>🔒</Text>
      <Text style={s.appName}>Real Security Camera</Text>
    </View>
  );

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <>
            <Stack.Screen name="Login">{(props) => <LoginScreen {...props} setToken={setToken} />}</Stack.Screen>
            <Stack.Screen name="Register">{(props) => <RegisterScreen {...props} setToken={setToken} />}</Stack.Screen>
          </>
        ) : (
          <>
            <Stack.Screen name="Dashboard">{(props) => <DashboardScreen {...props} logout={logout} />}</Stack.Screen>
            <Stack.Screen name="Camera" component={CameraScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ─── Dashboard Styles ────────────────────────────────────────────
const s = StyleSheet.create({
  c:                 { flex:1, backgroundColor:'#0a0a0a', justifyContent:'center', alignItems:'center', padding:24 },
  container:         { flex:1, backgroundColor:'#0a0a0a' },
  appIcon:           { fontSize:56, marginBottom:8 },
  appName:           { color:'#00ff88', fontSize:26, fontWeight:'bold', textAlign:'center', marginBottom:4 },
  sub:               { color:'#666', fontSize:14, marginBottom:32, textAlign:'center' },
  input:             { backgroundColor:'#1a1a1a', color:'#fff', padding:14, borderRadius:8, marginBottom:12, fontSize:16, borderWidth:1, borderColor:'#333', width:'100%' },
  btn:               { backgroundColor:'#00ff88', padding:16, borderRadius:8, alignItems:'center', width:'100%', marginBottom:12 },
  btxt:              { color:'#000', fontSize:16, fontWeight:'bold' },
  link:              { color:'#00ff88', textAlign:'center', marginTop:8 },
  header:            { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, paddingTop:50, backgroundColor:'#111' },
  headerTitle:       { color:'#00ff88', fontSize:18, fontWeight:'bold', flex:1 },
  logoutBtn:         { paddingHorizontal:12, paddingVertical:6, borderWidth:1, borderColor:'#ff4444', borderRadius:6 },
  logout:            { color:'#ff4444', fontSize:12, fontWeight:'bold' },
  stats:             { flexDirection:'row', justifyContent:'space-around', backgroundColor:'#111', marginHorizontal:16, marginTop:16, borderRadius:10, padding:16, marginBottom:16 },
  stat:              { alignItems:'center' },
  statN:             { color:'#00ff88', fontSize:18, fontWeight:'bold' },
  statL:             { color:'#666', fontSize:11, marginTop:2 },
  card:              { flex:1, margin:6, marginBottom:2, backgroundColor:'#1a1a1a', borderRadius:12, padding:12, borderWidth:1, borderColor:'#222' },
  dot:               { width:10, height:10, borderRadius:5, position:'absolute', top:12, right:12 },
  cardName:          { color:'#fff', fontSize:14, fontWeight:'bold', marginTop:24 },
  cardLoc:           { color:'#666', fontSize:11, marginTop:2, marginBottom:8 },
  cardActions:       { flexDirection:'row', gap:6, marginTop:4 },
  cardActionBtn:     { flex:1, paddingVertical:8, borderRadius:8, alignItems:'center', borderWidth:1 },
  cardActionIco:     { fontSize:16 },
  cardActionTxt:     { fontSize:10, fontWeight:'bold', marginTop:2 },
  cardEditHint:      { marginTop:6, alignItems:'center' },
  cardHint:          { color:'#333', fontSize:9 },
  deleteBtn:         { marginHorizontal:6, marginBottom:8, paddingVertical:5, backgroundColor:'#ff444415', borderRadius:6, alignItems:'center', borderWidth:1, borderColor:'#ff444430' },
  deleteBtnTxt:      { color:'#ff4444', fontSize:11, fontWeight:'600' },
  fab:               { position:'absolute', bottom:30, right:20, width:60, height:60, borderRadius:30, backgroundColor:'#00ff88', justifyContent:'center', alignItems:'center' },
  modalBg:           { flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'center', alignItems:'center' },
  modalBox:          { backgroundColor:'#111', borderRadius:12, padding:24, width:'85%', borderWidth:1, borderColor:'#333' },
  modalTitle:        { color:'#00ff88', fontSize:20, fontWeight:'bold', marginBottom:8, textAlign:'center' },
  modalSub:          { color:'#666', fontSize:14, marginBottom:16, textAlign:'center' },
  modalBtns:         { flexDirection:'row', gap:12, marginTop:4 },
  modalBtnCancel:    { flex:1, backgroundColor:'#1a1a1a', borderWidth:1, borderColor:'#666', paddingVertical:12, borderRadius:6, alignItems:'center' },
  modalBtnCancelTxt: { color:'#fff', fontSize:14, fontWeight:'bold' },
  modalBtnPrimary:   { flex:1, backgroundColor:'#00ff88', paddingVertical:12, borderRadius:6, alignItems:'center' },
  modalBtnPrimaryTxt:{ color:'#000', fontSize:14, fontWeight:'bold' },
});

// ─── Camera Styles ───────────────────────────────────────────────
const cs = StyleSheet.create({
  container:         { flex:1, backgroundColor:'#000' },
  permText:          { color:'#fff', textAlign:'center', marginTop:100, fontSize:16 },
  permBtn:           { marginTop:20, alignSelf:'center', backgroundColor:'#00ff88', padding:12, borderRadius:8 },
  permBtnTxt:        { color:'#000', fontWeight:'bold' },
  nvBright:          { ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(255,255,220,0.08)' },
  nvDark:            { ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,20,0,0.4)' },
  nvGreenStrong:     { ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,255,60,0.25)' },
  nvScanline:        { position:'absolute', left:0, right:0, height:1, backgroundColor:'rgba(0,0,0,0.3)' },
  nvVignette:        { ...StyleSheet.absoluteFillObject, borderWidth:50, borderColor:'rgba(0,0,0,0.7)', borderRadius:20 },
  nvLabel:           { position:'absolute', top:8, right:8, backgroundColor:'rgba(0,40,0,0.7)', paddingHorizontal:8, paddingVertical:3, borderRadius:4, borderWidth:1, borderColor:'#00ff88' },
  nvLabelTxt:        { color:'#00ff88', fontSize:10, fontWeight:'bold' },
  clockBox:          { position:'absolute', top:8, left:8, backgroundColor:'rgba(0,0,0,0.55)', padding:6, borderRadius:6, borderWidth:1, borderColor:'rgba(255,255,255,0.15)' },
  clockTime:         { color:'#fff', fontSize:20, fontWeight:'bold', fontVariant:['tabular-nums'] },
  clockDate:         { color:'rgba(255,255,255,0.75)', fontSize:11 },
  recDot:            { width:10, height:10, borderRadius:5, backgroundColor:'#444' },
  recDotActive:      { backgroundColor:'#ff4444' },
  topBar:            { position:'absolute', top:0, left:0, right:0, flexDirection:'row', alignItems:'center',
                       paddingTop: Platform.OS==='ios'?50:12, paddingHorizontal:12, paddingBottom:12,
                       backgroundColor:'rgba(0,0,0,0.5)' },
  backBtn:           { paddingHorizontal:8, paddingVertical:4 },
  backTxt:           { color:'#00ff88', fontSize:15, fontWeight:'600' },
  topCenter:         { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
  timerTxt:          { color:'#fff', fontSize:15, fontWeight:'bold' },
  settingsBtn:       { paddingHorizontal:8 },
  modeBadgeRow:      { position:'absolute', top: Platform.OS==='ios'?100:62, left:0, right:0, alignItems:'center' },
  modeBadge:         { paddingHorizontal:16, paddingVertical:5, borderRadius:20, borderWidth:1.5, backgroundColor:'rgba(0,0,0,0.5)' },
  modeBadgeTxt:      { fontSize:13, fontWeight:'bold' },
  statusBar:         { position:'absolute', top: Platform.OS==='ios'?140:100, left:16, right:16, alignItems:'center' },
  statusTxt:         { color:'#fff', fontSize:13, fontWeight:'600', backgroundColor:'rgba(0,0,0,0.5)',
                       paddingHorizontal:12, paddingVertical:4, borderRadius:12, overflow:'hidden' },
  dashInfo:          { position:'absolute', top: Platform.OS==='ios'?178:138, left:16, right:16,
                       flexDirection:'row', justifyContent:'center', gap:8, flexWrap:'wrap' },
  dashInfoTxt:       { color:'rgba(255,255,255,0.8)', fontSize:11, backgroundColor:'rgba(0,0,0,0.5)',
                       paddingHorizontal:8, paddingVertical:3, borderRadius:8, overflow:'hidden',
                       borderWidth:1, borderColor:'rgba(255,255,255,0.1)' },
  eventLog:          { position:'absolute', bottom:200, left:16, right:16, backgroundColor:'rgba(0,0,0,0.7)',
                       borderRadius:10, padding:10, borderWidth:1, borderColor:'rgba(255,68,68,0.3)' },
  eventLogTitle:     { color:'#ff4444', fontSize:11, fontWeight:'bold', marginBottom:4 },
  eventItem:         { color:'rgba(255,255,255,0.8)', fontSize:11, paddingVertical:1 },
  // Security arm controls
  securityControls:  { position:'absolute', bottom:110, left:16, right:16, gap:10 },
  armBtn:            { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:10,
                       backgroundColor:'rgba(0,255,136,0.15)', borderRadius:14, paddingVertical:14,
                       borderWidth:2, borderColor:'#00ff88' },
  armBtnActive:      { backgroundColor:'rgba(255,68,68,0.15)', borderColor:'#ff4444' },
  armBtnIco:         { fontSize:22 },
  armBtnTxt:         { color:'#fff', fontSize:16, fontWeight:'bold' },
  manualRecBtn:      { flexDirection:'row', alignItems:'center', justifyContent:'center',
                       backgroundColor:'rgba(0,0,0,0.5)', borderRadius:10, paddingVertical:10,
                       borderWidth:1, borderColor:'rgba(255,255,255,0.2)' },
  manualRecBtnActive:{ borderColor:'#ff4444' },
  manualRecTxt:      { color:'#fff', fontSize:13, fontWeight:'600' },
  // Bottom controls
  controls:          { position:'absolute', bottom:0, left:0, right:0, flexDirection:'row', alignItems:'center',
                       justifyContent:'space-around', paddingBottom: Platform.OS==='ios'?34:16,
                       paddingTop:16, backgroundColor:'rgba(0,0,0,0.7)', paddingHorizontal:8 },
  ctrlBtn:           { alignItems:'center', padding:8, borderRadius:10, minWidth:56 },
  ctrlBtnOn:         { backgroundColor:'rgba(255,200,0,0.2)' },
  ctrlBtnNV:         { backgroundColor:'rgba(0,255,100,0.15)' },
  ctrlIco:           { fontSize:24 },
  ctrlTxt:           { color:'rgba(255,255,255,0.7)', fontSize:10, marginTop:3, fontWeight:'600' },
  recordBtn:         { width:72, height:72, borderRadius:36, borderWidth:4, borderColor:'#fff', alignItems:'center', justifyContent:'center' },
  recordBtnActive:   { borderColor:'#ff4444' },
  recordInner:       { width:52, height:52, borderRadius:26, backgroundColor:'#ff4444' },
  recordInnerActive: { width:24, height:24, borderRadius:4, backgroundColor:'#ff4444' },
  // Dash cam loop prompt
  promptOverlay:     { flex:1, backgroundColor:'rgba(0,0,0,0.85)', justifyContent:'center', alignItems:'center', padding:24 },
  promptBox:         { backgroundColor:'#111', borderRadius:16, padding:24, width:'100%', borderWidth:1, borderColor:'#333' },
  promptTitle:       { color:'#00ff88', fontSize:22, fontWeight:'bold', textAlign:'center', marginBottom:6 },
  promptSub:         { color:'#666', fontSize:14, textAlign:'center', marginBottom:20 },
  promptOption:      { flexDirection:'row', alignItems:'center', gap:14, backgroundColor:'#1a1a1a',
                       borderRadius:10, padding:14, marginBottom:10, borderWidth:1, borderColor:'#333' },
  promptOptionIco:   { fontSize:26 },
  promptOptionTitle: { color:'#fff', fontSize:15, fontWeight:'bold' },
  promptOptionDesc:  { color:'#666', fontSize:12, marginTop:2 },
  promptCancel:      { marginTop:8, alignItems:'center', padding:12 },
  promptCancelTxt:   { color:'#666', fontSize:14 },
  // Settings modal
  modalOverlay:      { flex:1, backgroundColor:'rgba(0,0,0,0.85)', justifyContent:'flex-end' },
  modalContent:      { backgroundColor:'#111', borderTopLeftRadius:20, borderTopRightRadius:20,
                       padding:24, borderWidth:1, borderColor:'#222', paddingBottom:40 },
  modalTitle:        { color:'#00ff88', fontSize:18, fontWeight:'bold', marginBottom:20, textAlign:'center' },
  settingSection:    { color:'#666', fontSize:11, fontWeight:'bold', textTransform:'uppercase',
                       letterSpacing:1, marginTop:16, marginBottom:8 },
  settingRow:        { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                       paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#222' },
  settingLabel:      { color:'#fff', fontSize:14 },
  settingNote:       { color:'#666', fontSize:11, marginTop:2 },
  premiumBadge:      { backgroundColor:'#ffd70020', paddingHorizontal:6, paddingVertical:2, borderRadius:4, borderWidth:1, borderColor:'#ffd700' },
  premiumTxt:        { color:'#ffd700', fontSize:9, fontWeight:'bold' },
  modalClose:        { marginTop:24, backgroundColor:'#00ff88', borderRadius:10, padding:14, alignItems:'center' },
  modalCloseTxt:     { color:'#000', fontSize:16, fontWeight:'bold' },
});

export default App;