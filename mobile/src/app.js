import { jwtDecode } from 'jwt-decode';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, FlatList, KeyboardAvoidingView, Platform, Modal, Animated,
  ScrollView, Switch, Dimensions, StatusBar
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { registerRootComponent } from 'expo';

const { width: SW, height: SH } = Dimensions.get('window');
const API_URL = 'https://whale-app-hxokg.ondigitalocean.app';
const api = axios.create({ baseURL: API_URL, timeout: 10000 });
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

const Stack = createNativeStackNavigator();

// ─── Loop duration options ───────────────────────────────────────
const LOOP_OPTIONS = [
  { label: '1 min',  value: 60 },
  { label: '5 min',  value: 300 },
  { label: '15 min', value: 900 },
  { label: '30 min', value: 1800 },
];

// ─── Night Vision Overlay ────────────────────────────────────────
function NightVisionOverlay({ active }) {
  if (!active) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={cs.nvGreen} />
      <View style={cs.nvVignette} />
    </View>
  );
}

// ─── Recording Dot ───────────────────────────────────────────────
function RecDot({ recording }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (recording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 0.2, duration: 600, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1,   duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      anim.stopAnimation();
      anim.setValue(1);
    }
  }, [recording]);
  return (
    <Animated.View style={[cs.recDot, recording && cs.recDotActive, { opacity: anim }]} />
  );
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
      <Text style={s.title}>🔒 Real Security Camera</Text>
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
  const [form, setForm] = useState({ email: '', password: '', first_name: '', last_name: '', org_name: '' });
  const [loading, setLoading] = useState(false);

  const register = async () => {
    if (!form.email || !form.password || !form.first_name || !form.last_name) return Alert.alert('Error', 'Fill all fields');
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
      <Text style={s.title}>🔒 Real Security Camera</Text>
      <Text style={s.sub}>Create Account</Text>
      {['first_name','last_name','email','org_name'].map(f => (
        <TextInput key={f} style={s.input} placeholder={f.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} placeholderTextColor="#666" value={form[f]} onChangeText={v=>setForm(p=>({...p,[f]:v}))} autoCapitalize={f==='email'?'none':'words'} editable={!loading} />
      ))}
      <TextInput style={s.input} placeholder="Password" placeholderTextColor="#666" value={form.password} onChangeText={v=>setForm(p=>({...p,password:v}))} secureTextEntry editable={!loading} />
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
function DashboardScreen({ navigation, route, logout }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('viewer');
  const [showAddModal, setShowAddModal] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [deviceLocation, setDeviceLocation] = useState('');
  const [step, setStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => { loadDevices(); }, []);

  const loadDevices = async () => {
    try {
      const res = await api.get('/api/devices');
      setDevices(res.data.data || []);
    } catch (e) { console.log('Error:', e.message); }
    setLoading(false);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setDeviceName('');
    setDeviceLocation('');
    setStep(1);
  };

  const handleAddDevice = async () => {
    if (!deviceLocation.trim()) {
      Alert.alert('Error', 'Please enter a location');
      return;
    }
    setIsCreating(true);
    try {
      await api.post('/api/devices', {
        name: deviceName,
        location: deviceLocation,
        rtspUrl: '',
      });
      Alert.alert('Success', 'Camera added!');
      closeAddModal();
      loadDevices();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Failed to add device');
    }
    setIsCreating(false);
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🔒 Real Security Camera</Text>
        <TouchableOpacity onPress={logout}><Text style={s.logout}>Logout</Text></TouchableOpacity>
      </View>
      <View style={s.modeRow}>
        <TouchableOpacity style={[s.modeBtn, mode==='camera' && s.modeBtnOn]} onPress={() => setMode('camera')}>
          <Text style={[s.modeTxt, mode==='camera' && s.modeTxtOn]}>📷 Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.modeBtn, mode==='viewer' && s.modeBtnOn]} onPress={() => setMode('viewer')}>
          <Text style={[s.modeTxt, mode==='viewer' && s.modeTxtOn]}>👁 Viewer</Text>
        </TouchableOpacity>
      </View>
      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statN}>{devices.length}</Text><Text style={s.statL}>Cameras</Text></View>
        <View style={s.stat}><Text style={s.statN}>{devices.filter(d=>d.is_active).length}</Text><Text style={s.statL}>Online</Text></View>
        <View style={s.stat}><Text style={s.statN}>11</Text><Text style={s.statL}>Days</Text></View>
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
          <TouchableOpacity style={s.card} onPress={() => navigation.navigate('Camera', { device: item, mode })}>
            <Text style={{fontSize:32}}>📷</Text>
            <View style={[s.dot,{backgroundColor:item.is_active?'#00ff88':'#666'}]} />
            <Text style={s.cardName}>{item.name}</Text>
            <Text style={s.cardLoc}>📍 {item.location||'No location'}</Text>
            <View style={s.cardBtn}>
              <Text style={s.cardBtnTxt}>{mode==='camera'?'Use as Camera':'View Stream'}</Text>
            </View>
          </TouchableOpacity>
        )}
      />}
      <TouchableOpacity style={s.fab} onPress={() => setShowAddModal(true)}>
        <Text style={{color:'#000',fontSize:32,fontWeight:'bold'}}>+</Text>
      </TouchableOpacity>

      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={closeAddModal}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.7)',justifyContent:'center',alignItems:'center'}}>
          <View style={{backgroundColor:'#111',borderRadius:12,padding:24,width:'85%',borderWidth:1,borderColor:'#333'}}>
            {step === 1 ? (
              <>
                <Text style={{color:'#00ff88',fontSize:20,fontWeight:'bold',marginBottom:8,textAlign:'center'}}>Add Camera</Text>
                <Text style={{color:'#666',fontSize:14,marginBottom:16,textAlign:'center'}}>Enter device name</Text>
                <TextInput style={s.input} placeholder="Device Name" placeholderTextColor="#666" value={deviceName} onChangeText={setDeviceName} editable={!isCreating} />
                <View style={{flexDirection:'row',gap:12}}>
                  <TouchableOpacity style={{flex:1,backgroundColor:'#1a1a1a',borderWidth:1,borderColor:'#666',paddingVertical:12,borderRadius:6,alignItems:'center'}} onPress={closeAddModal} disabled={isCreating}>
                    <Text style={{color:'#fff',fontSize:14,fontWeight:'bold'}}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{flex:1,backgroundColor:'#00ff88',paddingVertical:12,borderRadius:6,alignItems:'center'}} onPress={() => setStep(2)} disabled={isCreating || !deviceName.trim()}>
                    <Text style={{color:'#000',fontSize:14,fontWeight:'bold'}}>Next</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={{color:'#00ff88',fontSize:20,fontWeight:'bold',marginBottom:8,textAlign:'center'}}>Enter Location</Text>
                <Text style={{color:'#666',fontSize:14,marginBottom:16,textAlign:'center'}}>Where is this camera?</Text>
                <TextInput style={s.input} placeholder="Location" placeholderTextColor="#666" value={deviceLocation} onChangeText={setDeviceLocation} editable={!isCreating} />
                <View style={{flexDirection:'row',gap:12}}>
                  <TouchableOpacity style={{flex:1,backgroundColor:'#1a1a1a',borderWidth:1,borderColor:'#666',paddingVertical:12,borderRadius:6,alignItems:'center'}} onPress={() => setStep(1)} disabled={isCreating}>
                    <Text style={{color:'#fff',fontSize:14,fontWeight:'bold'}}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{flex:1,backgroundColor:'#00ff88',paddingVertical:12,borderRadius:6,alignItems:'center'}} onPress={handleAddDevice} disabled={isCreating}>
                    {isCreating ? <ActivityIndicator color="#000" /> : <Text style={{color:'#000',fontSize:14,fontWeight:'bold'}}>Add Device</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Camera Screen ───────────────────────────────────────────────
function CameraScreen({ navigation, route }) {
  const { device, mode: initialMode } = route.params || {};

  const [camPerm,       requestCamPerm]  = useCameraPermissions();
  const [micPerm,       requestMicPerm]  = useMicrophonePermissions();
  const [mediaPerm,     setMediaPerm]    = useState(false);

  const [facing,        setFacing]       = useState('back');
  const [nightVision,   setNightVision]  = useState(false);
  const [torch,         setTorch]        = useState(false);
  const [zoom,          setZoom]         = useState(0);

  const [camMode,       setCamMode]      = useState(initialMode === 'camera' ? 'dashcam' : 'security');

  const [isRecording,   setIsRecording]  = useState(false);
  const [recordingTime, setRecordingTime]= useState(0);
  const [clipCount,     setClipCount]    = useState(0);
  const [loopDuration,  setLoopDuration] = useState(300);
  const [cloudUpload,   setCloudUpload]  = useState(false);

  const [motionEnabled, setMotionEnabled]= useState(true);
  const [soundEnabled,  setSoundEnabled] = useState(true);
  const [motionEvents,  setMotionEvents] = useState([]);
  const [alertActive,   setAlertActive]  = useState(false);

  const [showSettings,  setShowSettings] = useState(false);
  const [statusMsg,     setStatusMsg]    = useState('Ready');
  const [uploadQueue,   setUploadQueue]  = useState([]);

  const cameraRef   = useRef(null);
  const timerRef    = useRef(null);
  const loopRef     = useRef(null);
  const soundRef    = useRef(null);
  const soundMeter  = useRef(null);
  const alertAnim   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      if (!camPerm?.granted)  await requestCamPerm();
      if (!micPerm?.granted)  await requestMicPerm();
      const { status } = await MediaLibrary.requestPermissionsAsync();
      setMediaPerm(status === 'granted');
    })();
    return () => stopAll();
  }, []);

  const stopAll = () => {
    clearInterval(timerRef.current);
    clearInterval(loopRef.current);
    stopSoundMonitor();
  };

  const startTimer = () => {
    setRecordingTime(0);
    timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
  };
  const stopTimer = () => { clearInterval(timerRef.current); setRecordingTime(0); };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startSoundMonitor = async () => {
    if (!soundEnabled) return;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
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

  const triggerAlert = useCallback((type) => {
    if (alertActive) return;
    setAlertActive(true);
    const event = { type, time: new Date().toLocaleTimeString(), id: Date.now() };
    setMotionEvents(prev => [event, ...prev].slice(0, 20));
    setStatusMsg(`⚠️ ${type === 'motion' ? 'Motion' : 'Sound'} detected!`);
    Animated.sequence([
      Animated.timing(alertAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(alertAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(alertAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(alertAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
    if (!isRecording) startRecording(true);
    api.post('/api/motion/detect', { device_id: device?.id, confidence: 85, type }).catch(() => {});
    setTimeout(() => { setAlertActive(false); setStatusMsg('Monitoring...'); }, 5000);
  }, [alertActive, isRecording]);

  const startRecording = async (triggered = false) => {
    if (!cameraRef.current || isRecording) return;
    if (!camPerm?.granted || !micPerm?.granted) {
      Alert.alert('Permission needed', 'Camera and microphone access required.');
      return;
    }
    try {
      setIsRecording(true);
      setStatusMsg(triggered ? '🔴 Recording (triggered)' : '🔴 Recording...');
      startTimer();

      if (camMode === 'dashcam') {
        loopRef.current = setInterval(() => rotateClip(), loopDuration * 1000);
      }

      cameraRef.current.recordAsync({ mute: false, maxDuration: camMode === 'dashcam' ? loopDuration : 600 })
        .then(async (video) => { if (video?.uri) await saveClip(video.uri); })
        .catch((e) => { if (!e.message?.includes('cancelled')) console.log('Record error:', e.message); });

      if (camMode === 'security') await startSoundMonitor();
    } catch (e) {
      console.log('Start recording error:', e.message);
      setIsRecording(false);
      setStatusMsg('Error starting recording');
    }
  };

  const stopRecording = async () => {
    clearInterval(loopRef.current);
    stopTimer();
    stopSoundMonitor();
    if (cameraRef.current && isRecording) {
      try { cameraRef.current.stopRecording(); } catch {}
    }
    setIsRecording(false);
    setStatusMsg('Ready');
  };

  const rotateClip = async () => {
    if (cameraRef.current) {
      try { cameraRef.current.stopRecording(); } catch {}
    }
    setTimeout(() => {
      if (cameraRef.current) {
        cameraRef.current.recordAsync({ mute: false, maxDuration: loopDuration })
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
      setStatusMsg(`✅ Clip saved`);
      if (cloudUpload) uploadClip(dest, filename);
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

  if (!camPerm) {
    return <View style={cs.container}><Text style={cs.permText}>Requesting permissions...</Text></View>;
  }
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

  const borderColor = alertAnim.interpolate({ inputRange: [0, 1], outputRange: ['transparent', '#ff4444'] });

  return (
    <View style={cs.container}>
      <StatusBar barStyle="light-content" />

      {/* Camera Feed */}
      <Animated.View style={[StyleSheet.absoluteFill, { borderWidth: 3, borderColor }]}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          enableTorch={torch}
          zoom={zoom}
          mode="video"
        >
          <NightVisionOverlay active={nightVision} />
        </CameraView>
      </Animated.View>

      {/* Top Bar */}
      <View style={cs.topBar}>
        <TouchableOpacity onPress={() => { stopRecording(); navigation.goBack(); }} style={cs.backBtn}>
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

      {/* Mode Tabs */}
      <View style={cs.modeTabs}>
        {['dashcam', 'security'].map(m => (
          <TouchableOpacity
            key={m}
            style={[cs.modeTab, camMode === m && cs.modeTabOn]}
            onPress={() => { if (!isRecording) setCamMode(m); }}
          >
            <Text style={[cs.modeTabTxt, camMode === m && cs.modeTabTxtOn]}>
              {m === 'dashcam' ? '🚗 Dash Cam' : '🔒 Security'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Status */}
      <View style={cs.statusBar}>
        <Text style={cs.statusTxt}>{statusMsg}</Text>
      </View>

      {/* Dash cam info */}
      {camMode === 'dashcam' && (
        <View style={cs.dashInfo}>
          <Text style={cs.dashInfoTxt}>🔁 Loop: {LOOP_OPTIONS.find(o => o.value === loopDuration)?.label}</Text>
          <Text style={cs.dashInfoTxt}>📼 Clips: {clipCount}</Text>
        </View>
      )}

      {/* Security event log */}
      {camMode === 'security' && motionEvents.length > 0 && (
        <View style={cs.eventLog}>
          <Text style={cs.eventLogTitle}>Recent Events</Text>
          <ScrollView style={{maxHeight:80}}>
            {motionEvents.slice(0, 5).map(e => (
              <Text key={e.id} style={cs.eventItem}>
                {e.type === 'motion' ? '👁' : '🔊'} {e.type} — {e.time}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Bottom Controls */}
      <View style={cs.controls}>
        <TouchableOpacity style={cs.ctrlBtn} onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}>
          <Text style={cs.ctrlIco}>🔄</Text>
          <Text style={cs.ctrlTxt}>Flip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[cs.ctrlBtn, torch && cs.ctrlBtnOn]} onPress={() => setTorch(t => !t)}>
          <Text style={cs.ctrlIco}>{torch ? '🔦' : '💡'}</Text>
          <Text style={cs.ctrlTxt}>{torch ? 'ON' : 'Torch'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[cs.recordBtn, isRecording && cs.recordBtnActive]}
          onPress={() => isRecording ? stopRecording() : startRecording()}
        >
          <View style={[cs.recordInner, isRecording && cs.recordInnerActive]} />
        </TouchableOpacity>
        <TouchableOpacity style={[cs.ctrlBtn, nightVision && cs.ctrlBtnNV]} onPress={() => setNightVision(n => !n)}>
          <Text style={cs.ctrlIco}>🌙</Text>
          <Text style={cs.ctrlTxt}>{nightVision ? 'NV ON' : 'Night'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={cs.ctrlBtn} onPress={() => setZoom(z => z >= 0.5 ? 0 : parseFloat((z + 0.1).toFixed(1)))}>
          <Text style={cs.ctrlIco}>🔍</Text>
          <Text style={cs.ctrlTxt}>{zoom > 0 ? `${Math.round(zoom * 10)}x` : 'Zoom'}</Text>
        </TouchableOpacity>
      </View>

      {/* Settings Modal */}
      <Modal visible={showSettings} transparent animationType="slide" onRequestClose={() => setShowSettings(false)}>
        <View style={cs.modalOverlay}>
          <View style={cs.modalContent}>
            <Text style={cs.modalTitle}>⚙️ Camera Settings</Text>

            <Text style={cs.settingSection}>🚗 Dash Cam Loop Duration</Text>
            <View style={cs.loopOptions}>
              {LOOP_OPTIONS.map(o => (
                <TouchableOpacity
                  key={o.value}
                  style={[cs.loopBtn, loopDuration === o.value && cs.loopBtnOn]}
                  onPress={() => setLoopDuration(o.value)}
                >
                  <Text style={[cs.loopBtnTxt, loopDuration === o.value && cs.loopBtnTxtOn]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={cs.settingSection}>🔒 Security Detection</Text>
            <View style={cs.settingRow}>
              <Text style={cs.settingLabel}>Motion Detection</Text>
              <Switch value={motionEnabled} onValueChange={setMotionEnabled} trackColor={{true:'#00ff88'}} thumbColor="#fff" />
            </View>
            <View style={cs.settingRow}>
              <Text style={cs.settingLabel}>Sound Detection</Text>
              <Switch value={soundEnabled} onValueChange={setSoundEnabled} trackColor={{true:'#00ff88'}} thumbColor="#fff" />
            </View>

            <Text style={cs.settingSection}>☁️ Storage</Text>
            <View style={cs.settingRow}>
              <View>
                <Text style={cs.settingLabel}>Cloud Upload</Text>
                <Text style={cs.settingNote}>Uploads clips to your account</Text>
              </View>
              <Switch value={cloudUpload} onValueChange={setCloudUpload} trackColor={{true:'#00ff88'}} thumbColor="#fff" />
            </View>

            <TouchableOpacity style={cs.modalClose} onPress={() => setShowSettings(false)}>
              <Text style={cs.modalCloseTxt}>Done</Text>
            </TouchableOpacity>
          </View>
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

  if (!ready) return <View style={s.c}><Text style={s.title}>🔒 Real Security Camera</Text></View>;

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

// ─── Dashboard / Auth Styles ─────────────────────────────────────
const s = StyleSheet.create({
  c:          { flex:1, backgroundColor:'#0a0a0a', justifyContent:'center', alignItems:'center', padding:24 },
  container:  { flex:1, backgroundColor:'#0a0a0a' },
  title:      { color:'#00ff88', fontSize:28, fontWeight:'bold', textAlign:'center' },
  sub:        { color:'#666', fontSize:14, marginBottom:32, textAlign:'center' },
  input:      { backgroundColor:'#1a1a1a', color:'#fff', padding:14, borderRadius:8, marginBottom:12, fontSize:16, borderWidth:1, borderColor:'#333', width:'100%' },
  btn:        { backgroundColor:'#00ff88', padding:16, borderRadius:8, alignItems:'center', width:'100%', marginBottom:12 },
  btxt:       { color:'#000', fontSize:16, fontWeight:'bold' },
  link:       { color:'#00ff88', textAlign:'center', marginTop:8 },
  header:     { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:20, paddingTop:50, backgroundColor:'#111' },
  logout:     { color:'#ff4444' },
  modeRow:    { flexDirection:'row', margin:16, backgroundColor:'#1a1a1a', borderRadius:10, padding:4 },
  modeBtn:    { flex:1, padding:10, borderRadius:8, alignItems:'center' },
  modeBtnOn:  { backgroundColor:'#00ff88' },
  modeTxt:    { color:'#666', fontWeight:'600' },
  modeTxtOn:  { color:'#000' },
  stats:      { flexDirection:'row', justifyContent:'space-around', backgroundColor:'#111', marginHorizontal:16, borderRadius:10, padding:16, marginBottom:16 },
  stat:       { alignItems:'center' },
  statN:      { color:'#00ff88', fontSize:24, fontWeight:'bold' },
  statL:      { color:'#666', fontSize:11 },
  card:       { flex:1, margin:6, backgroundColor:'#1a1a1a', borderRadius:12, padding:16, borderWidth:1, borderColor:'#222' },
  dot:        { width:10, height:10, borderRadius:5, position:'absolute', top:16, right:16 },
  cardName:   { color:'#fff', fontSize:14, fontWeight:'bold', marginTop:8 },
  cardLoc:    { color:'#666', fontSize:11, marginTop:4 },
  cardBtn:    { backgroundColor:'#00ff8820', padding:8, borderRadius:6, alignItems:'center', marginTop:8, borderWidth:1, borderColor:'#00ff8840' },
  cardBtnTxt: { color:'#00ff88', fontSize:11, fontWeight:'600' },
  fab:        { position:'absolute', bottom:30, right:20, width:60, height:60, borderRadius:30, backgroundColor:'#00ff88', justifyContent:'center', alignItems:'center' },
});

// ─── Camera Screen Styles ────────────────────────────────────────
const cs = StyleSheet.create({
  container:      { flex:1, backgroundColor:'#000' },
  permText:       { color:'#fff', textAlign:'center', marginTop:100, fontSize:16 },
  permBtn:        { marginTop:20, alignSelf:'center', backgroundColor:'#00ff88', padding:12, borderRadius:8 },
  permBtnTxt:     { color:'#000', fontWeight:'bold' },
  nvGreen:        { ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,255,80,0.12)' },
  nvVignette:     { ...StyleSheet.absoluteFillObject, shadowColor:'#000', shadowOffset:{width:0,height:0}, shadowOpacity:1, shadowRadius:80 },
  recDot:         { width:10, height:10, borderRadius:5, backgroundColor:'#444' },
  recDotActive:   { backgroundColor:'#ff4444' },
  topBar:         { position:'absolute', top:0, left:0, right:0, flexDirection:'row', alignItems:'center',
                    paddingTop: Platform.OS === 'ios' ? 50 : 12, paddingHorizontal:12, paddingBottom:12,
                    backgroundColor:'rgba(0,0,0,0.5)' },
  backBtn:        { paddingHorizontal:8, paddingVertical:4 },
  backTxt:        { color:'#00ff88', fontSize:15, fontWeight:'600' },
  topCenter:      { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
  timerTxt:       { color:'#fff', fontSize:15, fontWeight:'bold' },
  settingsBtn:    { paddingHorizontal:8 },
  modeTabs:       { position:'absolute', top: Platform.OS === 'ios' ? 110 : 72, left:0, right:0,
                    flexDirection:'row', paddingHorizontal:16, gap:8 },
  modeTab:        { flex:1, paddingVertical:7, borderRadius:20, borderWidth:1,
                    borderColor:'rgba(255,255,255,0.3)', alignItems:'center', backgroundColor:'rgba(0,0,0,0.4)' },
  modeTabOn:      { backgroundColor:'#00ff88', borderColor:'#00ff88' },
  modeTabTxt:     { color:'rgba(255,255,255,0.7)', fontSize:12, fontWeight:'600' },
  modeTabTxtOn:   { color:'#000' },
  statusBar:      { position:'absolute', top: Platform.OS === 'ios' ? 155 : 117, left:16, right:16, alignItems:'center' },
  statusTxt:      { color:'#fff', fontSize:13, fontWeight:'600', backgroundColor:'rgba(0,0,0,0.5)',
                    paddingHorizontal:12, paddingVertical:4, borderRadius:12, overflow:'hidden' },
  dashInfo:       { position:'absolute', top: Platform.OS === 'ios' ? 195 : 157, left:16, right:16,
                    flexDirection:'row', justifyContent:'center', gap:16 },
  dashInfoTxt:    { color:'rgba(255,255,255,0.7)', fontSize:11, backgroundColor:'rgba(0,0,0,0.4)',
                    paddingHorizontal:8, paddingVertical:3, borderRadius:8, overflow:'hidden' },
  eventLog:       { position:'absolute', bottom:130, left:16, right:16, backgroundColor:'rgba(0,0,0,0.7)',
                    borderRadius:10, padding:10, borderWidth:1, borderColor:'rgba(255,68,68,0.3)' },
  eventLogTitle:  { color:'#ff4444', fontSize:11, fontWeight:'bold', marginBottom:4 },
  eventItem:      { color:'rgba(255,255,255,0.8)', fontSize:11, paddingVertical:1 },
  controls:       { position:'absolute', bottom:0, left:0, right:0, flexDirection:'row', alignItems:'center',
                    justifyContent:'space-around', paddingBottom: Platform.OS === 'ios' ? 34 : 16,
                    paddingTop:16, backgroundColor:'rgba(0,0,0,0.6)', paddingHorizontal:8 },
  ctrlBtn:        { alignItems:'center', padding:8, borderRadius:10, minWidth:56 },
  ctrlBtnOn:      { backgroundColor:'rgba(255,200,0,0.2)' },
  ctrlBtnNV:      { backgroundColor:'rgba(0,255,100,0.15)' },
  ctrlIco:        { fontSize:24 },
  ctrlTxt:        { color:'rgba(255,255,255,0.7)', fontSize:10, marginTop:3, fontWeight:'600' },
  recordBtn:      { width:72, height:72, borderRadius:36, borderWidth:4, borderColor:'#fff', alignItems:'center', justifyContent:'center' },
  recordBtnActive:{ borderColor:'#ff4444' },
  recordInner:    { width:52, height:52, borderRadius:26, backgroundColor:'#ff4444' },
  recordInnerActive:{ width:24, height:24, borderRadius:4, backgroundColor:'#ff4444' },
  modalOverlay:   { flex:1, backgroundColor:'rgba(0,0,0,0.85)', justifyContent:'flex-end' },
  modalContent:   { backgroundColor:'#111', borderTopLeftRadius:20, borderTopRightRadius:20,
                    padding:24, borderWidth:1, borderColor:'#222' },
  modalTitle:     { color:'#00ff88', fontSize:18, fontWeight:'bold', marginBottom:20, textAlign:'center' },
  settingSection: { color:'#666', fontSize:11, fontWeight:'bold', textTransform:'uppercase',
                    letterSpacing:1, marginTop:16, marginBottom:8 },
  settingRow:     { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                    paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#222' },
  settingLabel:   { color:'#fff', fontSize:14 },
  settingNote:    { color:'#666', fontSize:11, marginTop:2 },
  loopOptions:    { flexDirection:'row', gap:8, flexWrap:'wrap' },
  loopBtn:        { paddingHorizontal:14, paddingVertical:8, borderRadius:8, borderWidth:1, borderColor:'#333', backgroundColor:'#1a1a1a' },
  loopBtnOn:      { backgroundColor:'#00ff88', borderColor:'#00ff88' },
  loopBtnTxt:     { color:'#666', fontSize:13 },
  loopBtnTxtOn:   { color:'#000', fontWeight:'bold' },
  modalClose:     { marginTop:24, backgroundColor:'#00ff88', borderRadius:10, padding:14, alignItems:'center' },
  modalCloseTxt:  { color:'#000', fontSize:16, fontWeight:'bold' },
});
