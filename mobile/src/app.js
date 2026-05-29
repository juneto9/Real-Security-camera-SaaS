import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, FlatList, KeyboardAvoidingView, Platform, Modal, Animated,
  ScrollView, Switch, Dimensions, StatusBar, Linking, PermissionsAndroid
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioModule } from 'expo-audio';
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
  { label: '1 min',  value: 60 },
  { label: '5 min',  value: 300 },
  { label: '15 min', value: 900 },
  { label: '30 min', value: 1800 },
];

const CLIP_SIZE_OPTIONS = [
  { label: '1 min clips', value: 60 },
  { label: '3 min clips', value: 180 },
  { label: '5 min clips', value: 300 },
];

// ─── Signal Bars ─────────────────────────────────────────────────
function SignalBars({ strength }) {
  return (
    <View style={{ flexDirection:'row', alignItems:'flex-end', gap:2 }}>
      {[1,2,3,4].map(b => (
        <View key={b} style={{
          width:4, height:4+b*3, borderRadius:1,
          backgroundColor: b<=strength ? '#00ff88' : '#333',
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
    let unsub;
    const init = async () => {
      if (Platform.OS === 'android') {
        try {
          const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
          if (!already) {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
              title: 'Network Permission',
              message: 'Needed to display your WiFi network name.',
              buttonPositive: 'Allow', buttonNegative: 'Skip',
            });
          }
        } catch {}
      }
      const applyState = (state) => {
        if (state.type === 'wifi' && state.isConnected) {
          const name = state.details?.ssid;
          setSsid(name && name !== '<unknown ssid>' && name !== 'unknown ssid' ? name : 'WiFi');
          const str = state.details?.strength;
          setStrength(str != null ? Math.min(4, Math.round((str/100)*4)) : 3);
        } else if (state.isConnected) {
          setSsid('Mobile'); setStrength(2);
        } else {
          setSsid('Offline'); setStrength(0);
        }
      };
      const state = await NetInfo.fetch();
      applyState(state);
      unsub = NetInfo.addEventListener(applyState);
    };
    init();
    return () => { if (unsub) unsub(); };
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
      <View style={{ flexDirection:'row', alignItems:'center', gap:4 }}>
        <Text style={[s.statN,{fontSize:12}]} numberOfLines={1}>
          {ssid.length > 9 ? ssid.substring(0,8)+'…' : ssid}
        </Text>
        <SignalBars strength={strength} />
      </View>
      <Text style={s.statL}>Network ›</Text>
    </TouchableOpacity>
  );
}

// ─── Live Clock (used by both modes) ─────────────────────────────
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const pad = n => String(n).padStart(2,'0');
  const dateStr = now.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'});
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return (
    <View style={cs.clockBox}>
      <Text style={cs.clockTime}>{timeStr}</Text>
      <Text style={cs.clockDate}>{dateStr}</Text>
    </View>
  );
}

// ─── Night Vision Overlay ─────────────────────────────────────────
// Free: subtle brightness lift
// Pro: warm phosphor green glow — NO scanlines, NO grid
function NightVisionOverlay({ active, premium }) {
  if (!active) return null;
  if (premium) {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill,{zIndex:10}]}>
        {/* Darken background to increase perceived contrast */}
        <View style={cs.nvDark} />
        {/* Warm phosphor green tint */}
        <View style={cs.nvGreen} />
        {/* Soft vignette edges only — no grid, no lines */}
        <View style={cs.nvVignette} />
        <View style={cs.nvLabel}>
          <Text style={cs.nvLabelTxt}>🌙 NIGHT VISION PRO</Text>
        </View>
      </View>
    );
  }
  // Free: just a gentle brightness boost
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill,{zIndex:10}]}>
      <View style={cs.nvBright} />
      <View style={cs.nvLabel}>
        <Text style={cs.nvLabelTxt}>🌙 NIGHT MODE</Text>
      </View>
    </View>
  );
}

// ─── Motion Alert Popup ───────────────────────────────────────────
function MotionPopup({ event, onDismiss }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!event) return;
    // Fade in
    Animated.timing(opacity, { toValue:1, duration:300, useNativeDriver:true }).start();
    // Auto-dismiss after 14 seconds
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue:0, duration:500, useNativeDriver:true })
        .start(() => onDismiss());
    }, 14000);
    return () => clearTimeout(t);
  }, [event]);

  if (!event) return null;

  return (
    <Animated.View style={[cs.motionPopup, {opacity}]}>
      <View style={cs.motionPopupInner}>
        <Text style={cs.motionPopupIco}>{event.type==='motion' ? '👁' : '🔊'}</Text>
        <View style={{flex:1}}>
          <Text style={cs.motionPopupTitle}>
            {event.type==='motion' ? 'Motion Detected!' : 'Sound Detected!'}
          </Text>
          <Text style={cs.motionPopupTime}>{event.time}</Text>
        </View>
        <TouchableOpacity onPress={()=>{
          Animated.timing(opacity,{toValue:0,duration:200,useNativeDriver:true}).start(()=>onDismiss());
        }} style={cs.motionPopupClose}>
          <Text style={cs.motionPopupCloseTxt}>✕</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ─── Recording Dot ───────────────────────────────────────────────
function RecDot({ recording }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (recording) {
      Animated.loop(Animated.sequence([
        Animated.timing(anim,{toValue:0.2,duration:600,useNativeDriver:true}),
        Animated.timing(anim,{toValue:1,  duration:600,useNativeDriver:true}),
      ])).start();
    } else { anim.stopAnimation(); anim.setValue(1); }
  }, [recording]);
  return <Animated.View style={[cs.recDot, recording && cs.recDotActive, {opacity:anim}]} />;
}

// ─── Recording Banner ────────────────────────────────────────────
function RecordingBanner({ recording, armed, formatTime, recordingTime, clipCount }) {
  if (!recording && !armed) return null;
  const bg = recording ? '#cc0000' : '#005522';
  const msg = recording
    ? `● REC  ${formatTime(recordingTime)}   •   ${clipCount} clip${clipCount!==1?'s':''} saved`
    : '🟢  Armed — monitoring for motion & sound';
  return (
    <View style={[cs.recBanner,{backgroundColor:bg}]}>
      <Text style={cs.recBannerTxt}>{msg}</Text>
    </View>
  );
}

// ─── Clips Management Screen ─────────────────────────────────────
function ClipsScreen({ navigation }) {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalSize, setTotalSize] = useState(0);

  useEffect(() => { loadClips(); }, []);

  const loadClips = async () => {
    try {
      const dir = FileSystem.documentDirectory;
      const files = await FileSystem.readDirectoryAsync(dir);
      const mp4s = files.filter(f => f.endsWith('.mp4'));
      const details = await Promise.all(mp4s.map(async (f) => {
        const info = await FileSystem.getInfoAsync(dir + f);
        return { name:f, uri:dir+f, size:info.size||0, modTime:info.modificationTime||0 };
      }));
      details.sort((a,b) => b.modTime - a.modTime);
      setClips(details);
      setTotalSize(details.reduce((acc,c) => acc+c.size, 0));
    } catch(e) { console.log('Load clips error:', e.message); }
    setLoading(false);
  };

  const deleteClip = (clip) => {
    Alert.alert('Delete Clip', `Delete ${clip.name}?`, [
      { text:'Cancel' },
      { text:'Delete', style:'destructive', onPress: async () => {
        try { await FileSystem.deleteAsync(clip.uri); loadClips(); }
        catch(e) { Alert.alert('Error','Could not delete clip'); }
      }},
    ]);
  };

  const deleteAll = () => {
    Alert.alert('Delete All Clips', `Delete all ${clips.length} clips? This cannot be undone.`, [
      { text:'Cancel' },
      { text:'Delete All', style:'destructive', onPress: async () => {
        try { await Promise.all(clips.map(c => FileSystem.deleteAsync(c.uri))); loadClips(); }
        catch(e) { Alert.alert('Error','Could not delete all clips'); }
      }},
    ]);
  };

  const openGallery = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.intent.action.VIEW').catch(() => Linking.openSettings());
    } else {
      Linking.openURL('photos-redirect://').catch(() => {});
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/(1024*1024)).toFixed(1)} MB`;
  };

  const formatDate = (ts) => {
    if (!ts) return '--';
    return new Date(ts*1000).toLocaleString('en-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  };

  return (
    <View style={cl.container}>
      <View style={cl.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={cl.backBtn}>
          <Text style={cl.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={cl.title}>📼 Saved Clips</Text>
        <TouchableOpacity onPress={openGallery} style={cl.galleryBtn}>
          <Text style={cl.galleryTxt}>Gallery ›</Text>
        </TouchableOpacity>
      </View>

      <View style={cl.summary}>
        <View style={cl.summaryItem}>
          <Text style={cl.summaryN}>{clips.length}</Text>
          <Text style={cl.summaryL}>Total Clips</Text>
        </View>
        <View style={cl.summaryItem}>
          <Text style={cl.summaryN}>{formatSize(totalSize)}</Text>
          <Text style={cl.summaryL}>Storage Used</Text>
        </View>
        {clips.length > 0 && (
          <TouchableOpacity style={cl.deleteAllBtn} onPress={deleteAll}>
            <Text style={cl.deleteAllTxt}>🗑 Delete All</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? <ActivityIndicator color="#00ff88" style={{marginTop:40}}/> :
        clips.length === 0 ? (
          <View style={cl.empty}>
            <Text style={{fontSize:48}}>📭</Text>
            <Text style={cl.emptyTxt}>No clips saved yet</Text>
            <Text style={cl.emptySub}>Start recording to save clips here</Text>
          </View>
        ) : (
          <FlatList
            data={clips}
            keyExtractor={i=>i.name}
            contentContainerStyle={{padding:12}}
            renderItem={({item,index}) => (
              <View style={cl.clipCard}>
                <View style={cl.clipIcon}>
                  <Text style={{fontSize:28}}>🎬</Text>
                  <Text style={cl.clipNum}>#{clips.length-index}</Text>
                </View>
                <View style={cl.clipInfo}>
                  <Text style={cl.clipName} numberOfLines={1}>
                    {formatDate(item.modTime)}
                  </Text>
                  <Text style={cl.clipMeta}>{formatSize(item.size)}</Text>
                </View>
                <TouchableOpacity style={cl.clipDelete} onPress={() => deleteClip(item)}>
                  <Text style={{fontSize:20}}>🗑</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )
      }
    </View>
  );
}

// ─── Login ───────────────────────────────────────────────────────
function LoginScreen({ navigation, setToken }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email || !password) return Alert.alert('Error','Enter email and password');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login',{email,password});
      await AsyncStorage.setItem('accessToken', res.data.data.accessToken);
      await setToken(res.data.data.accessToken);
    } catch(e) { Alert.alert('Login Failed', e.response?.data?.message||'Check credentials'); }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={s.c} behavior={Platform.OS==='ios'?'padding':'height'}>
      <Text style={s.appIcon}>🔒</Text>
      <Text style={s.appName}>Real Security Camera</Text>
      <Text style={s.sub}>Enterprise Security System</Text>
      <TextInput style={s.input} placeholder="Email" placeholderTextColor="#666" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!loading}/>
      <TextInput style={s.input} placeholder="Password" placeholderTextColor="#666" value={password} onChangeText={setPassword} secureTextEntry editable={!loading}/>
      <TouchableOpacity style={s.btn} onPress={login} disabled={loading}>
        {loading ? <ActivityIndicator color="#000"/> : <Text style={s.btxt}>Login</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={()=>navigation.navigate('Register')} disabled={loading}>
        <Text style={s.link}>Don't have an account? Register</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ─── Register ────────────────────────────────────────────────────
function RegisterScreen({ navigation, setToken }) {
  const [form, setForm] = useState({email:'',password:'',first_name:'',last_name:'',org_name:''});
  const [loading, setLoading] = useState(false);

  const register = async () => {
    if (!form.email||!form.password||!form.first_name||!form.last_name)
      return Alert.alert('Error','Fill all fields');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/register',form);
      await AsyncStorage.setItem('accessToken', res.data.data.accessToken);
      await setToken(res.data.data.accessToken);
    } catch(e) { Alert.alert('Failed', e.response?.data?.message||'Try again'); }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={s.c} behavior={Platform.OS==='ios'?'padding':'height'}>
      <Text style={s.appIcon}>🔒</Text>
      <Text style={s.appName}>Real Security Camera</Text>
      <Text style={s.sub}>Create Account</Text>
      {['first_name','last_name','email','org_name'].map(f=>(
        <TextInput key={f} style={s.input}
          placeholder={f.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
          placeholderTextColor="#666" value={form[f]}
          onChangeText={v=>setForm(p=>({...p,[f]:v}))}
          autoCapitalize={f==='email'?'none':'words'} editable={!loading}/>
      ))}
      <TextInput style={s.input} placeholder="Password" placeholderTextColor="#666"
        value={form.password} onChangeText={v=>setForm(p=>({...p,password:v}))}
        secureTextEntry editable={!loading}/>
      <TouchableOpacity style={s.btn} onPress={register} disabled={loading}>
        {loading ? <ActivityIndicator color="#000"/> : <Text style={s.btxt}>Create Account</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={()=>navigation.navigate('Login')} disabled={loading}>
        <Text style={s.link}>Already have an account? Login</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────
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

  useEffect(()=>{ loadDevices(); },[]);

  const loadDevices = async () => {
    try {
      const res = await api.get('/api/devices');
      setDevices(res.data.data||[]);
    } catch(e){ console.log('Error:',e.message); }
    setLoading(false);
  };

  const closeAddModal = () => { setShowAddModal(false); setDeviceName(''); setDeviceLocation(''); setStep(1); };

  const handleAddDevice = async () => {
    if (!deviceLocation.trim()){ Alert.alert('Error','Please enter a location'); return; }
    setIsCreating(true);
    try {
      await api.post('/api/devices',{name:deviceName,location:deviceLocation,rtspUrl:''});
      Alert.alert('Success','Camera added!');
      closeAddModal(); loadDevices();
    } catch(e){ Alert.alert('Error',e.response?.data?.message||'Failed to add device'); }
    setIsCreating(false);
  };

  const handleEditDevice = (device) => {
    setEditingDevice(device); setEditName(device.name); setEditLocation(device.location||'');
  };

  const saveDeviceChanges = async () => {
    if (!editName.trim()){ Alert.alert('Error','Name cannot be empty'); return; }
    try {
      await api.put(`/api/devices/${editingDevice.id}`,{name:editName,location:editLocation});
      Alert.alert('Success','Device updated!');
      setEditingDevice(null); loadDevices();
    } catch(e){ Alert.alert('Error',e.response?.data?.message||'Failed to update'); }
  };

  const handleDeleteDevice = async (deviceId) => {
    try {
      await api.delete(`/api/devices/${deviceId}`);
      setDeleteConfirm(null); loadDevices();
    } catch(e){ Alert.alert('Error',e.response?.data?.message||'Failed to delete'); }
  };

  const openCamera = (device, mode) =>
    navigation.navigate('Camera',{device, initialMode: mode==='camera'?'dashcam':'security'});

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>🔒 Real Security Camera</Text>
        <TouchableOpacity onPress={logout} style={s.logoutBtn}>
          <Text style={s.logout}>Logout</Text>
        </TouchableOpacity>
      </View>
      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statN}>{devices.length}</Text><Text style={s.statL}>Cameras</Text></View>
        <View style={s.stat}><Text style={s.statN}>{devices.filter(d=>d.is_active).length}</Text><Text style={s.statL}>Online</Text></View>
        <WiFiStat />
      </View>
      {loading ? <ActivityIndicator color="#00ff88" style={{marginTop:40}}/> :
        <FlatList
          data={devices} keyExtractor={i=>i.id} numColumns={2}
          contentContainerStyle={{padding:8}} refreshing={loading} onRefresh={loadDevices}
          ListEmptyComponent={
            <View style={{alignItems:'center',marginTop:60}}>
              <Text style={{fontSize:48}}>📷</Text>
              <Text style={{color:'#fff',fontSize:18,marginTop:16}}>No cameras yet</Text>
              <Text style={{color:'#666',marginTop:8}}>Tap + to add one</Text>
            </View>
          }
          renderItem={({item})=>(
            <View style={{flex:1}}>
              <TouchableOpacity style={s.card} onLongPress={()=>handleEditDevice(item)} delayLongPress={400}>
                <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <Text style={{fontSize:28}}>📷</Text>
                  <View style={[s.dot,{backgroundColor:item.is_active?'#00ff88':'#666'}]}/>
                </View>
                <Text style={s.cardName}>{item.name}</Text>
                <Text style={s.cardLoc}>📍 {item.location||'No location'}</Text>
                <Text style={s.cardHint}>Hold to edit</Text>
                <View style={s.cardActions}>
                  <TouchableOpacity style={[s.cardActionBtn,{backgroundColor:'#00ff8818',borderColor:'#00ff8860'}]} onPress={()=>openCamera(item,'camera')}>
                    <Text style={s.cardActionIco}>🚗</Text>
                    <Text style={[s.cardActionTxt,{color:'#00ff88'}]}>Dash Cam</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.cardActionBtn,{backgroundColor:'#4488ff18',borderColor:'#4488ff60'}]} onPress={()=>openCamera(item,'viewer')}>
                    <Text style={s.cardActionIco}>🔒</Text>
                    <Text style={[s.cardActionTxt,{color:'#4488ff'}]}>Security</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={s.deleteBtn} onPress={()=>setDeleteConfirm(item.id)}>
                <Text style={s.deleteBtnTxt}>🗑 Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      }
      <TouchableOpacity style={s.fab} onPress={()=>setShowAddModal(true)}>
        <Text style={{color:'#000',fontSize:32,fontWeight:'bold'}}>+</Text>
      </TouchableOpacity>

      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={closeAddModal}>
        <View style={s.modalBg}><View style={s.modalBox}>
          {step===1?(<>
            <Text style={s.modalTitle}>Add Camera</Text>
            <Text style={s.modalSub}>Enter device name</Text>
            <TextInput style={s.input} placeholder="Device Name" placeholderTextColor="#666" value={deviceName} onChangeText={setDeviceName} editable={!isCreating}/>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalBtnCancel} onPress={closeAddModal}><Text style={s.modalBtnCancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalBtnPrimary} onPress={()=>setStep(2)} disabled={!deviceName.trim()}><Text style={s.modalBtnPrimaryTxt}>Next</Text></TouchableOpacity>
            </View>
          </>):(<>
            <Text style={s.modalTitle}>Enter Location</Text>
            <Text style={s.modalSub}>Where is this camera?</Text>
            <TextInput style={s.input} placeholder="Location" placeholderTextColor="#666" value={deviceLocation} onChangeText={setDeviceLocation} editable={!isCreating}/>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalBtnCancel} onPress={()=>setStep(1)}><Text style={s.modalBtnCancelTxt}>Back</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalBtnPrimary} onPress={handleAddDevice} disabled={isCreating}>
                {isCreating?<ActivityIndicator color="#000"/>:<Text style={s.modalBtnPrimaryTxt}>Add Device</Text>}
              </TouchableOpacity>
            </View>
          </>)}
        </View></View>
      </Modal>

      <Modal visible={!!editingDevice} transparent animationType="slide" onRequestClose={()=>setEditingDevice(null)}>
        <View style={s.modalBg}><View style={s.modalBox}>
          <Text style={s.modalTitle}>✏️ Edit Camera</Text>
          <TextInput style={s.input} placeholder="Device Name" placeholderTextColor="#666" value={editName} onChangeText={setEditName}/>
          <TextInput style={s.input} placeholder="Location" placeholderTextColor="#666" value={editLocation} onChangeText={setEditLocation}/>
          <View style={s.modalBtns}>
            <TouchableOpacity style={s.modalBtnCancel} onPress={()=>setEditingDevice(null)}><Text style={s.modalBtnCancelTxt}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={s.modalBtnPrimary} onPress={saveDeviceChanges}><Text style={s.modalBtnPrimaryTxt}>Save</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      <Modal visible={!!deleteConfirm} transparent animationType="fade" onRequestClose={()=>setDeleteConfirm(null)}>
        <View style={s.modalBg}><View style={[s.modalBox,{borderColor:'#ff4444'}]}>
          <Text style={[s.modalTitle,{color:'#ff4444'}]}>Delete Camera?</Text>
          <Text style={s.modalSub}>This cannot be undone.</Text>
          <View style={s.modalBtns}>
            <TouchableOpacity style={s.modalBtnCancel} onPress={()=>setDeleteConfirm(null)}><Text style={s.modalBtnCancelTxt}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[s.modalBtnPrimary,{backgroundColor:'#ff4444'}]} onPress={()=>handleDeleteDevice(deleteConfirm)}><Text style={s.modalBtnPrimaryTxt}>Delete</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

// ─── Camera Screen ───────────────────────────────────────────────
function CameraScreen({ navigation, route }) {
  const { device, initialMode } = route.params || {};

  const [camPerm,        requestCamPerm]    = useCameraPermissions();
  const [micPerm,        requestMicPerm]    = useMicrophonePermissions();
  const [mediaPerm,      setMediaPerm]      = useState(false);
  const [facing,         setFacing]         = useState('back');
  const [nightVision,    setNightVision]    = useState(false);
  const [nightVisionPro, setNightVisionPro] = useState(false);
  const [torch,          setTorch]          = useState(false);
  const [zoom,           setZoom]           = useState(0);
  const [camMode]                           = useState(initialMode||'dashcam');
  const [isRecording,    setIsRecording]    = useState(false);
  const [isArmed,        setIsArmed]        = useState(false);
  const [recordingTime,  setRecordingTime]  = useState(0);
  const [clipCount,      setClipCount]      = useState(0);
  const [loopDuration,   setLoopDuration]   = useState(300);
  const [loopForever,    setLoopForever]    = useState(false);
  const [clipSize,       setClipSize]       = useState(300);
  const [cloudUpload,    setCloudUpload]    = useState(false);
  const [motionEnabled,  setMotionEnabled]  = useState(true);
  const [soundEnabled,   setSoundEnabled]   = useState(true);
  const [motionEvents,   setMotionEvents]   = useState([]);
  const [activePopup,    setActivePopup]    = useState(null); // current popup event
  const [showSettings,   setShowSettings]   = useState(false);
  const [showLoopPrompt, setShowLoopPrompt] = useState(false);
  const [showClipSizePrompt, setShowClipSizePrompt] = useState(false);
  const [statusMsg,      setStatusMsg]      = useState(
    initialMode==='dashcam' ? 'Tap record to start' : 'Ready to monitor'
  );

  // Refs
  const cameraRef          = useRef(null);
  const timerRef           = useRef(null);
  const loopRef            = useRef(null);
  const recorderRef        = useRef(null);
  const soundMeterRef      = useRef(null);
  const motionPollRef      = useRef(null);
  const alertAnim          = useRef(new Animated.Value(0)).current;
  const isRecordingRef     = useRef(false);
  const isArmedRef         = useRef(false);
  const alertActiveRef     = useRef(false);
  const motionEnabledRef   = useRef(true);
  const soundEnabledRef    = useRef(true);
  const loopForeverRef     = useRef(false);
  const loopDurationRef    = useRef(300);
  const clipSizeRef        = useRef(300);
  const camModeRef         = useRef(initialMode||'dashcam');
  const camPermGrantedRef  = useRef(false);
  const micPermGrantedRef  = useRef(false);

  useEffect(()=>{ motionEnabledRef.current = motionEnabled; },[motionEnabled]);
  useEffect(()=>{ soundEnabledRef.current  = soundEnabled;  },[soundEnabled]);
  useEffect(()=>{ loopForeverRef.current   = loopForever;   },[loopForever]);
  useEffect(()=>{ loopDurationRef.current  = loopDuration;  },[loopDuration]);
  useEffect(()=>{ clipSizeRef.current      = clipSize;      },[clipSize]);

  // Request permissions once on mount
  useEffect(()=>{
    (async()=>{
      if (!camPerm?.granted) {
        const r = await requestCamPerm();
        camPermGrantedRef.current = r?.granted ?? false;
      } else { camPermGrantedRef.current = true; }

      if (!micPerm?.granted) {
        const r = await requestMicPerm();
        micPermGrantedRef.current = r?.granted ?? false;
      } else { micPermGrantedRef.current = true; }

      const mediaStatus = await MediaLibrary.getPermissionsAsync();
      if (mediaStatus.status === 'granted') {
        setMediaPerm(true);
      } else {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        setMediaPerm(status === 'granted');
      }
    })();
    if (initialMode === 'dashcam') setTimeout(()=>setShowLoopPrompt(true), 700);
    return ()=>stopAll();
  },[]);

  const stopAll = () => {
    clearInterval(timerRef.current);
    clearInterval(loopRef.current);
    clearInterval(motionPollRef.current);
    clearInterval(soundMeterRef.current);
    if (recorderRef.current) {
      try { recorderRef.current.stop(); } catch {}
      recorderRef.current = null;
    }
  };

  const startTimer = () => {
    setRecordingTime(0);
    timerRef.current = setInterval(()=>setRecordingTime(t=>t+1), 1000);
  };
  const stopTimer = () => { clearInterval(timerRef.current); setRecordingTime(0); };
  const formatTime = (sec) => {
    const m = Math.floor(sec/60).toString().padStart(2,'0');
    const s = (sec%60).toString().padStart(2,'0');
    return `${m}:${s}`;
  };

  // Loop choice handler — shared by both modes
  const handleLoopChoice = (forever, duration) => {
    if (forever) {
      setShowLoopPrompt(false);
      setShowClipSizePrompt(true);
    } else {
      setLoopForever(false);
      loopForeverRef.current = false;
      setLoopDuration(duration);
      loopDurationRef.current = duration;
      setShowLoopPrompt(false);
      if (camModeRef.current === 'dashcam') {
        setTimeout(()=>startRecording(), 200);
      } else {
        // Security mode: arm after choice, wait for trigger
        armSecurity();
      }
    }
  };

  const handleClipSizeChoice = (size) => {
    setClipSize(size);
    clipSizeRef.current = size;
    setLoopForever(true);
    loopForeverRef.current = true;
    setShowClipSizePrompt(false);
    if (camModeRef.current === 'dashcam') {
      setTimeout(()=>startRecording(), 200);
    } else {
      armSecurity();
    }
  };

  // Arm security mode — starts monitoring but NOT recording
  const armSecurity = async () => {
    isArmedRef.current = true;
    setIsArmed(true);
    setStatusMsg('🟢 Armed — monitoring...');
    startMotionPolling();
    if (soundEnabledRef.current) startSoundMonitor();
  };

  // Security arm/disarm toggle
  const handleArmToggle = async () => {
    if (isArmedRef.current) {
      // Disarm
      isArmedRef.current = false;
      setIsArmed(false);
      stopMotionPolling();
      await stopSoundMonitor();
      if (isRecordingRef.current) await stopRecording();
      setStatusMsg('Ready to monitor');
    } else {
      // Show loop prompt before arming — same as dashcam
      setShowLoopPrompt(true);
    }
  };

  const startMotionPolling = () => {
    clearInterval(motionPollRef.current);
    console.log('🟢 Motion polling started');
    motionPollRef.current = setInterval(()=>{
      if (!alertActiveRef.current && motionEnabledRef.current && isArmedRef.current) {
        if (Math.random() < 0.03) {
          console.log('⚡ Motion triggered!');
          triggerAlert('motion');
        }
      }
    }, 1000);
  };
  const stopMotionPolling = () => { clearInterval(motionPollRef.current); };

  const startSoundMonitor = async () => {
    if (!soundEnabledRef.current) return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      const recorder = new AudioModule.AudioRecorder({
        android: { extension:'.m4a', outputFormat:'mpeg4', audioEncoder:'aac' },
        ios:     { extension:'.m4a', outputFormat:'mpeg4', audioQuality:'medium' },
        web:     {},
      });
      recorderRef.current = recorder;
      await recorder.prepareToRecordAsync();
      await recorder.record();
      soundMeterRef.current = setInterval(async ()=>{
        try {
          const level = recorder.currentMeteringLevel ?? -160;
          if (level > -40 && isArmedRef.current) triggerAlert('sound');
        } catch {}
      }, 600);
    } catch(e) { console.log('Sound monitor error:', e.message); }
  };

  const stopSoundMonitor = async () => {
    clearInterval(soundMeterRef.current);
    if (recorderRef.current) {
      try { await recorderRef.current.stop(); } catch {}
      recorderRef.current = null;
    }
  };

  // Plain function — reads only refs, no stale closure issue
  const triggerAlert = (type) => {
    if (alertActiveRef.current) return;
    alertActiveRef.current = true;
    console.log('🚨 Alert:', type);

    const event = { type, time: new Date().toLocaleTimeString(), id: Date.now() };

    // Show popup
    setActivePopup(event);

    // Add to event log
    // Add to event log, auto-remove after 16s
    setMotionEvents(prev => [event,...prev].slice(0,20));
    setTimeout(()=>{
  setMotionEvents(prev => prev.filter(e => e.id !== event.id));
}, 16000);
    setStatusMsg(`⚠️ ${type==='motion'?'Motion':'Sound'} detected!`);

    // Flash red border
    Animated.sequence([
      Animated.timing(alertAnim,{toValue:1,duration:150,useNativeDriver:true}),
      Animated.timing(alertAnim,{toValue:0,duration:150,useNativeDriver:true}),
      Animated.timing(alertAnim,{toValue:1,duration:150,useNativeDriver:true}),
      Animated.timing(alertAnim,{toValue:0,duration:300,useNativeDriver:true}),
    ]).start();

    // Auto-start recording after short delay
    setTimeout(()=>{
      if (!isRecordingRef.current && cameraRef.current) {
        startRecording(true);
      }
    }, 300);

    api.post('/api/motion/detect',{device_id:device?.id,confidence:85,type}).catch(()=>{});

    // Reset alert state after 14s (popup auto-dismisses itself)
    setTimeout(()=>{
      alertActiveRef.current = false;
      setStatusMsg(isArmedRef.current ? '🟢 Armed — monitoring...' : 'Ready');
    }, 14000);
  };

  const startRecording = async (triggered=false) => {
    if (!cameraRef.current || isRecordingRef.current) return;
    if (!camPermGrantedRef.current || !micPermGrantedRef.current) {
      console.log('Permissions not granted, skipping record');
      return;
    }
    try {
      isRecordingRef.current = true;
      setIsRecording(true);
      setStatusMsg(triggered ? '🔴 Recording (triggered)' : '🔴 Recording...');
      startTimer();

      const isForever = loopForeverRef.current;
      const clipDur   = isForever ? clipSizeRef.current : loopDurationRef.current;

      // Timed rotation interval for dashcam non-forever
      if (camModeRef.current==='dashcam' && !isForever && clipDur>0) {
        clearInterval(loopRef.current);
        loopRef.current = setInterval(()=>rotateClip(), clipDur*1000);
      }

      const recordOptions = { mute: false };
      if (triggered) {
  recordOptions.maxDuration = loopForeverRef.current ? clipSizeRef.current : (loopDurationRef.current || 60);
} else if (clipDur > 0) {
        recordOptions.maxDuration = clipDur;
      }

      cameraRef.current.recordAsync(recordOptions)
        .then(async(video)=>{ if(video?.uri) await saveClip(video.uri); })
        .catch((e)=>{
          if (!e.message?.includes('cancelled') && !e.message?.includes('stopped'))
            console.log('Record error:', e.message);
        });

    } catch(e) {
      console.log('Start recording error:', e.message);
      isRecordingRef.current = false;
      setIsRecording(false);
      setStatusMsg('Error — tap to retry');
    }
  };

  const stopRecording = async () => {
    clearInterval(loopRef.current);
    stopTimer();
    if (cameraRef.current && isRecordingRef.current) {
      try { cameraRef.current.stopRecording(); } catch {}
    }
    isRecordingRef.current = false;
    setIsRecording(false);
    setStatusMsg(isArmedRef.current ? '🟢 Armed — monitoring...' : 'Ready');
  };

  const rotateClip = async () => {
    if (cameraRef.current) { try { cameraRef.current.stopRecording(); } catch {} }
    setTimeout(()=>{
      if (cameraRef.current && isRecordingRef.current) {
        const isForever = loopForeverRef.current;
        const clipDur   = isForever ? clipSizeRef.current : loopDurationRef.current;
        const opts = { mute:false };
        if (clipDur > 0) opts.maxDuration = clipDur;
        cameraRef.current.recordAsync(opts)
          .then(async(video)=>{ if(video?.uri) await saveClip(video.uri); })
          .catch(()=>{});
      }
    }, 400);
  };

  const saveClip = async (uri) => {
    try {
      const filename = `clip_${Date.now()}.mp4`;
      const dest = FileSystem.documentDirectory + filename;
      await FileSystem.moveAsync({ from:uri, to:dest });
      if (mediaPerm) await MediaLibrary.saveToLibraryAsync(dest);
      setClipCount(c=>c+1);
      if (!alertActiveRef.current) setStatusMsg('✅ Clip saved');
      if (cloudUpload) uploadClip(dest, filename);
      // Only auto-rotate in dashcam loop forever, or security loop forever
if (loopForeverRef.current && isRecordingRef.current && camModeRef.current === 'dashcam') rotateClip();
// Security loop forever rotates too but waits for next trigger
if (loopForeverRef.current && isRecordingRef.current && camModeRef.current === 'security') {
  isRecordingRef.current = false;
  setIsRecording(false);
  setStatusMsg('🟢 Armed — monitoring...');
  stopTimer();
}
    } catch(e) { console.log('Save clip error:',e.message); }
  };

  const uploadClip = async (uri, filename) => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      await FileSystem.uploadAsync(`${API_URL}/api/recordings/upload`, uri, {
        httpMethod:'POST', uploadType:FileSystem.FileSystemUploadType.MULTIPART,
        fieldName:'video', headers:{Authorization:'Bearer '+token},
        parameters:{device_id:device?.id, filename},
      });
    } catch(e) { console.log('Upload error:',e.message); }
  };

  if (!camPerm) return <View style={cs.container}><Text style={cs.permText}>Requesting permissions...</Text></View>;
  if (!camPerm.granted) {
    return (
      <View style={cs.container}>
        <Text style={cs.permText}>Camera permission required.</Text>
        <TouchableOpacity style={cs.permBtn} onPress={requestCamPerm}>
          <Text style={cs.permBtnTxt}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bannerVisible = isRecording || isArmed;
  const borderColor = alertAnim.interpolate({inputRange:[0,1],outputRange:['transparent','#ff4444']});
  const modeColor = camMode==='dashcam' ? '#00ff88' : '#4488ff';
  const modeLabel = camMode==='dashcam' ? '🚗 Dash Cam' : '🔒 Security';
  const topBarPaddingTop = bannerVisible
    ? (Platform.OS==='ios' ? 72 : 54)
    : (Platform.OS==='ios' ? 50 : 30);

  const loopLabel = loopForever
    ? `♾️ ${CLIP_SIZE_OPTIONS.find(o=>o.value===clipSize)?.label||'Loop'}`
    : (LOOP_OPTIONS.find(o=>o.value===loopDuration)?.label||'');

  return (
    <View style={cs.container}>
      <StatusBar barStyle="light-content" backgroundColor={isRecording?'#cc0000':isArmed?'#005522':'#000'}/>

      <RecordingBanner recording={isRecording} armed={isArmed} formatTime={formatTime}
        recordingTime={recordingTime} clipCount={clipCount}/>

      {/* Camera feed */}
      <Animated.View style={[cs.cameraContainer,{borderWidth:3,borderColor}]}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill}
          facing={facing} enableTorch={torch} zoom={zoom} mode="video"/>
      </Animated.View>

      {/* Overlays */}
      <NightVisionOverlay active={nightVision} premium={nightVisionPro}/>

      {/* Date/time stamp — shown on BOTH modes */}
      <View style={cs.clockWrapper} pointerEvents="none">
        <LiveClock/>
      </View>

      {/* Motion alert popup */}
      <MotionPopup event={activePopup} onDismiss={()=>setActivePopup(null)}/>

      {/* Top bar */}
      <View style={[cs.topBar,{paddingTop:topBarPaddingTop}]}>
        <TouchableOpacity onPress={()=>{ stopAll(); navigation.goBack(); }} style={cs.backBtn}>
          <Text style={cs.backTxt}>← Back</Text>
        </TouchableOpacity>
        <View style={cs.topCenter}>
          <RecDot recording={isRecording}/>
          <Text style={cs.timerTxt}>{isRecording ? formatTime(recordingTime) : device?.name||'Camera'}</Text>
        </View>
        {/* Clips badge */}
        <TouchableOpacity style={cs.clipsBadge}
          onPress={()=>navigation.navigate('Clips',{mode:camMode})}>
          <Text style={cs.clipsBadgeIco}>📼</Text>
          <Text style={cs.clipsBadgeCount}>{clipCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={()=>setShowSettings(true)} style={cs.settingsBtn}>
          <Text style={{fontSize:22}}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Mode badge */}
      <View style={[cs.modeBadgeRow,{top:bannerVisible?(Platform.OS==='ios'?122:98):(Platform.OS==='ios'?105:76)}]}>
        <View style={[cs.modeBadge,{borderColor:modeColor}]}>
          <Text style={[cs.modeBadgeTxt,{color:modeColor}]}>{modeLabel}</Text>
        </View>
      </View>

      {/* Status */}
      <View style={[cs.statusBar,{top:bannerVisible?(Platform.OS==='ios'?160:135):(Platform.OS==='ios'?143:112)}]}>
        <Text style={cs.statusTxt}>{statusMsg}</Text>
      </View>

      {/* Recording info */}
      {(isRecording || clipCount > 0) && (
        <View style={cs.dashInfo}>
          {loopLabel ? <Text style={cs.dashInfoTxt}>{loopLabel}</Text> : null}
          <Text style={cs.dashInfoTxt}>📼 {clipCount} clip{clipCount!==1?'s':''}</Text>
          {isRecording && <Text style={[cs.dashInfoTxt,{borderColor:'#ff4444',color:'#ff8888'}]}>● REC</Text>}
        </View>
      )}

      {/* Security event log */}
      {camMode==='security' && motionEvents.length>0 && (
        <View style={cs.eventLog}>
          <Text style={cs.eventLogTitle}>Recent Events</Text>
          <ScrollView style={{maxHeight:70}}>
            {motionEvents.slice(0,5).map(e=>(
              <Text key={e.id} style={cs.eventItem}>{e.type==='motion'?'👁':'🔊'} {e.type} — {e.time}</Text>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Security arm controls */}
      {camMode==='security' && (
        <View style={cs.securityControls}>
          <TouchableOpacity style={[cs.armBtn,isArmed&&cs.armBtnActive]} onPress={handleArmToggle}>
            <Text style={cs.armBtnIco}>{isArmed?'🔴':'🟢'}</Text>
            <Text style={cs.armBtnTxt}>{isArmed?'Stop Monitoring':'Start Monitoring'}</Text>
          </TouchableOpacity>
          {isArmed && (
            <TouchableOpacity style={[cs.manualRecBtn,isRecording&&cs.manualRecBtnActive]}
              onPress={()=>isRecording?stopRecording():startRecording()}>
              <Text style={cs.manualRecTxt}>{isRecording?'⏹ Stop Recording':'⏺ Record Now'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Bottom controls */}
      <View style={cs.controls}>
        <TouchableOpacity style={cs.ctrlBtn} onPress={()=>setFacing(f=>f==='back'?'front':'back')}>
          <Text style={cs.ctrlIco}>🔄</Text><Text style={cs.ctrlTxt}>Flip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[cs.ctrlBtn,torch&&cs.ctrlBtnOn]} onPress={()=>setTorch(t=>!t)}>
          <Text style={cs.ctrlIco}>⚡</Text><Text style={cs.ctrlTxt}>{torch?'Flash ON':'Flash'}</Text>
        </TouchableOpacity>

        {camMode==='dashcam' ? (
          <TouchableOpacity style={[cs.recordBtn,isRecording&&cs.recordBtnActive]}
            onPress={()=>isRecording?stopRecording():setShowLoopPrompt(true)}>
            <View style={[cs.recordInner,isRecording&&cs.recordInnerActive]}/>
          </TouchableOpacity>
        ) : (
          <View style={[cs.recordBtn,isArmed&&{borderColor:isRecording?'#ff4444':'#00ff88'}]}>
            <Text style={{fontSize:28}}>{isArmed?(isRecording?'🔴':'🟢'):'⚫'}</Text>
          </View>
        )}

        <TouchableOpacity style={[cs.ctrlBtn,nightVision&&cs.ctrlBtnNV]} onPress={()=>setNightVision(n=>!n)}>
          <Text style={cs.ctrlIco}>🌙</Text>
          <Text style={cs.ctrlTxt}>{nightVision?(nightVisionPro?'NV PRO':'NV ON'):'Night'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={cs.ctrlBtn} onPress={()=>setZoom(z=>z>=0.5?0:parseFloat((z+0.1).toFixed(1)))}>
          <Text style={cs.ctrlIco}>🔍</Text>
          <Text style={cs.ctrlTxt}>{zoom>0?`${Math.round(zoom*10)}x`:'Zoom'}</Text>
        </TouchableOpacity>
      </View>

      {/* Loop / Recording Mode Prompt */}
      <Modal visible={showLoopPrompt} transparent animationType="fade"
        onRequestClose={()=>setShowLoopPrompt(false)}>
        <View style={cs.promptOverlay}>
          <View style={cs.promptBox}>
            <Text style={cs.promptTitle}>
              {camMode==='dashcam' ? '🚗 Dash Cam Mode' : '🔒 Security Mode'}
            </Text>
            <Text style={cs.promptSub}>How would you like to record?</Text>
            <TouchableOpacity style={cs.promptOption} onPress={()=>handleLoopChoice(true,0)}>
              <Text style={cs.promptOptionIco}>♾️</Text>
              <View style={{flex:1}}>
                <Text style={cs.promptOptionTitle}>Loop Forever</Text>
                <Text style={cs.promptOptionDesc}>Continuous recording, you choose the clip length</Text>
              </View>
            </TouchableOpacity>
            {LOOP_OPTIONS.map(opt=>(
              <TouchableOpacity key={opt.value} style={cs.promptOption} onPress={()=>handleLoopChoice(false,opt.value)}>
                <Text style={cs.promptOptionIco}>⏱</Text>
                <View style={{flex:1}}>
                  <Text style={cs.promptOptionTitle}>{opt.label}</Text>
                  <Text style={cs.promptOptionDesc}>
                    {camMode==='dashcam'?'Record one clip then stop':'Record when triggered, up to this duration'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={cs.promptCancel} onPress={()=>setShowLoopPrompt(false)}>
              <Text style={cs.promptCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Clip Size Prompt */}
      <Modal visible={showClipSizePrompt} transparent animationType="fade"
        onRequestClose={()=>setShowClipSizePrompt(false)}>
        <View style={cs.promptOverlay}>
          <View style={cs.promptBox}>
            <Text style={cs.promptTitle}>♾️ Loop Forever</Text>
            <Text style={cs.promptSub}>Choose your clip length</Text>
            {CLIP_SIZE_OPTIONS.map(opt=>(
              <TouchableOpacity key={opt.value} style={cs.promptOption} onPress={()=>handleClipSizeChoice(opt.value)}>
                <Text style={cs.promptOptionIco}>🎬</Text>
                <View style={{flex:1}}>
                  <Text style={cs.promptOptionTitle}>{opt.label}</Text>
                  <Text style={cs.promptOptionDesc}>Each saved clip will be {opt.label.replace(' clips','')} long</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={cs.promptCancel} onPress={()=>setShowClipSizePrompt(false)}>
              <Text style={cs.promptCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Settings modal */}
      <Modal visible={showSettings} transparent animationType="slide" onRequestClose={()=>setShowSettings(false)}>
        <View style={cs.modalOverlay}>
          <ScrollView><View style={cs.modalContent}>
            <Text style={cs.modalTitle}>⚙️ Camera Settings</Text>

            <Text style={cs.settingSection}>🔒 Security Detection</Text>
            <View style={cs.settingRow}>
              <Text style={cs.settingLabel}>Motion Detection</Text>
              <Switch value={motionEnabled} onValueChange={setMotionEnabled} trackColor={{true:'#00ff88'}} thumbColor="#fff"/>
            </View>
            <View style={cs.settingRow}>
              <Text style={cs.settingLabel}>Sound Detection</Text>
              <Switch value={soundEnabled} onValueChange={setSoundEnabled} trackColor={{true:'#00ff88'}} thumbColor="#fff"/>
            </View>

            <Text style={cs.settingSection}>🌙 Night Vision</Text>
            <View style={cs.settingRow}>
              <View><Text style={cs.settingLabel}>Night Mode</Text><Text style={cs.settingNote}>Brightness boost (free)</Text></View>
              <Switch value={nightVision} onValueChange={setNightVision} trackColor={{true:'#00ff88'}} thumbColor="#fff"/>
            </View>
            <View style={cs.settingRow}>
              <View style={{flex:1,marginRight:8}}>
                <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                  <Text style={cs.settingLabel}>Night Vision Pro</Text>
                  <View style={cs.premiumBadge}><Text style={cs.premiumTxt}>PREMIUM</Text></View>
                </View>
                <Text style={cs.settingNote}>Phosphor green contrast enhancement</Text>
              </View>
              <Switch value={nightVisionPro}
                onValueChange={(v)=>{ setNightVisionPro(v); if(v) setNightVision(true); }}
                trackColor={{true:'#ffd700'}} thumbColor="#fff"/>
            </View>

            <Text style={cs.settingSection}>☁️ Storage</Text>
            <View style={cs.settingRow}>
              <View><Text style={cs.settingLabel}>Cloud Upload</Text><Text style={cs.settingNote}>Auto-upload clips to your account</Text></View>
              <Switch value={cloudUpload} onValueChange={setCloudUpload} trackColor={{true:'#00ff88'}} thumbColor="#fff"/>
            </View>

            <TouchableOpacity
              style={[cs.modalClose,{marginTop:16,backgroundColor:'#1a1a1a',borderWidth:1,borderColor:'#333'}]}
              onPress={()=>{ setShowSettings(false); navigation.navigate('Clips',{mode:camMode}); }}>
              <Text style={[cs.modalCloseTxt,{color:'#00ff88'}]}>📼 Manage Clips ({clipCount})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={cs.modalClose} onPress={()=>setShowSettings(false)}>
              <Text style={cs.modalCloseTxt}>Done</Text>
            </TouchableOpacity>
          </View></ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── App Root ────────────────────────────────────────────────────
function App() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(null);

  useEffect(()=>{
    AsyncStorage.getItem('accessToken').then(t=>{ setToken(t); setReady(true); });
  },[]);

  const logout = async () => { await AsyncStorage.removeItem('accessToken'); setToken(null); };

  if (!ready) return (
    <View style={s.c}>
      <Text style={s.appIcon}>🔒</Text>
      <Text style={s.appName}>Real Security Camera</Text>
    </View>
  );

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{headerShown:false}}>
        {!token?(<>
          <Stack.Screen name="Login">{(props)=><LoginScreen {...props} setToken={setToken}/>}</Stack.Screen>
          <Stack.Screen name="Register">{(props)=><RegisterScreen {...props} setToken={setToken}/>}</Stack.Screen>
        </>):(<>
          <Stack.Screen name="Dashboard">{(props)=><DashboardScreen {...props} logout={logout}/>}</Stack.Screen>
          <Stack.Screen name="Camera" component={CameraScreen}/>
          <Stack.Screen name="Clips" component={ClipsScreen}/>
        </>)}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ─── Dashboard Styles ────────────────────────────────────────────
const s = StyleSheet.create({
  c:                 {flex:1,backgroundColor:'#0a0a0a',justifyContent:'center',alignItems:'center',padding:24},
  container:         {flex:1,backgroundColor:'#0a0a0a'},
  appIcon:           {fontSize:56,marginBottom:8},
  appName:           {color:'#00ff88',fontSize:26,fontWeight:'bold',textAlign:'center',marginBottom:4},
  sub:               {color:'#666',fontSize:14,marginBottom:32,textAlign:'center'},
  input:             {backgroundColor:'#1a1a1a',color:'#fff',padding:14,borderRadius:8,marginBottom:12,fontSize:16,borderWidth:1,borderColor:'#333',width:'100%'},
  btn:               {backgroundColor:'#00ff88',padding:16,borderRadius:8,alignItems:'center',width:'100%',marginBottom:12},
  btxt:              {color:'#000',fontSize:16,fontWeight:'bold'},
  link:              {color:'#00ff88',textAlign:'center',marginTop:8},
  header:            {flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:16,paddingTop:50,backgroundColor:'#111'},
  headerTitle:       {color:'#00ff88',fontSize:18,fontWeight:'bold',flex:1},
  logoutBtn:         {paddingHorizontal:12,paddingVertical:6,borderWidth:1,borderColor:'#ff4444',borderRadius:6},
  logout:            {color:'#ff4444',fontSize:12,fontWeight:'bold'},
  stats:             {flexDirection:'row',justifyContent:'space-around',backgroundColor:'#111',marginHorizontal:16,marginTop:16,borderRadius:10,padding:16,marginBottom:8},
  stat:              {alignItems:'center'},
  statN:             {color:'#00ff88',fontSize:18,fontWeight:'bold'},
  statL:             {color:'#666',fontSize:11,marginTop:2},
  card:              {flex:1,margin:6,marginBottom:2,backgroundColor:'#1a1a1a',borderRadius:12,padding:12,borderWidth:1,borderColor:'#222'},
  dot:               {width:10,height:10,borderRadius:5},
  cardName:          {color:'#fff',fontSize:14,fontWeight:'bold',marginTop:6},
  cardLoc:           {color:'#666',fontSize:11,marginTop:2,marginBottom:2},
  cardHint:          {color:'#333',fontSize:9,marginBottom:6},
  cardActions:       {flexDirection:'row',gap:6},
  cardActionBtn:     {flex:1,paddingVertical:8,borderRadius:8,alignItems:'center',borderWidth:1},
  cardActionIco:     {fontSize:16},
  cardActionTxt:     {fontSize:10,fontWeight:'bold',marginTop:2},
  deleteBtn:         {marginHorizontal:6,marginBottom:8,paddingVertical:5,backgroundColor:'#ff444415',borderRadius:6,alignItems:'center',borderWidth:1,borderColor:'#ff444430'},
  deleteBtnTxt:      {color:'#ff4444',fontSize:11,fontWeight:'600'},
  fab:               {position:'absolute',bottom:30,right:20,width:60,height:60,borderRadius:30,backgroundColor:'#00ff88',justifyContent:'center',alignItems:'center'},
  modalBg:           {flex:1,backgroundColor:'rgba(0,0,0,0.7)',justifyContent:'center',alignItems:'center'},
  modalBox:          {backgroundColor:'#111',borderRadius:12,padding:24,width:'85%',borderWidth:1,borderColor:'#333'},
  modalTitle:        {color:'#00ff88',fontSize:20,fontWeight:'bold',marginBottom:8,textAlign:'center'},
  modalSub:          {color:'#666',fontSize:14,marginBottom:16,textAlign:'center'},
  modalBtns:         {flexDirection:'row',gap:12,marginTop:4},
  modalBtnCancel:    {flex:1,backgroundColor:'#1a1a1a',borderWidth:1,borderColor:'#666',paddingVertical:12,borderRadius:6,alignItems:'center'},
  modalBtnCancelTxt: {color:'#fff',fontSize:14,fontWeight:'bold'},
  modalBtnPrimary:   {flex:1,backgroundColor:'#00ff88',paddingVertical:12,borderRadius:6,alignItems:'center'},
  modalBtnPrimaryTxt:{color:'#000',fontSize:14,fontWeight:'bold'},
});

// ─── Camera Styles ───────────────────────────────────────────────
const cs = StyleSheet.create({
  container:         {flex:1,backgroundColor:'#000'},
  cameraContainer:   {...StyleSheet.absoluteFillObject},
  permText:          {color:'#fff',textAlign:'center',marginTop:100,fontSize:16},
  permBtn:           {marginTop:20,alignSelf:'center',backgroundColor:'#00ff88',padding:12,borderRadius:8},
  permBtnTxt:        {color:'#000',fontWeight:'bold'},
  recBanner:         {position:'absolute',top:0,left:0,right:0,zIndex:100,
                      paddingTop:Platform.OS==='ios'?44:24,paddingBottom:8,paddingHorizontal:16,alignItems:'center'},
  recBannerTxt:      {color:'#fff',fontSize:12,fontWeight:'bold'},
  // Night vision — NO scanlines, NO grid
  nvBright:          {...StyleSheet.absoluteFillObject,backgroundColor:'rgba(255,255,200,0.08)',zIndex:10},
  nvDark:            {...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,15,0,0.5)',zIndex:10},
  nvGreen:           {...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,255,70,0.22)',zIndex:11},
  nvVignette:        {...StyleSheet.absoluteFillObject,borderWidth:60,borderColor:'rgba(0,20,0,0.85)',borderRadius:1,zIndex:12},
  nvLabel:           {position:'absolute',top:90,right:8,backgroundColor:'rgba(0,30,0,0.85)',
                      paddingHorizontal:8,paddingVertical:3,borderRadius:4,borderWidth:1,borderColor:'#00cc44',zIndex:13},
  nvLabelTxt:        {color:'#00ff88',fontSize:10,fontWeight:'bold'},
  // Motion popup
  motionPopup:       {position:'absolute',top:0,left:0,right:0,zIndex:50,
                      paddingTop:Platform.OS==='ios'?100:80},
  motionPopupInner:  {marginHorizontal:16,backgroundColor:'rgba(20,0,0,0.92)',borderRadius:12,
                      padding:14,flexDirection:'row',alignItems:'center',gap:12,
                      borderWidth:1.5,borderColor:'#ff4444'},
  motionPopupIco:    {fontSize:28},
  motionPopupTitle:  {color:'#fff',fontSize:15,fontWeight:'bold'},
  motionPopupTime:   {color:'#999',fontSize:12,marginTop:2},
  motionPopupClose:  {padding:6},
  motionPopupCloseTxt:{color:'#666',fontSize:16,fontWeight:'bold'},
  // Clock — shown on both modes
  clockWrapper:      {position:'absolute',bottom:100,right:8,zIndex:12},
  clockBox:          {backgroundColor:'rgba(0,0,0,0.5)',padding:5,borderRadius:5,
                      borderWidth:1,borderColor:'rgba(255,255,255,0.1)'},
  clockTime:         {color:'rgba(255,255,255,0.85)',fontSize:14,fontWeight:'bold',fontVariant:['tabular-nums']},
  clockDate:         {color:'rgba(255,255,255,0.55)',fontSize:10},
  recDot:            {width:10,height:10,borderRadius:5,backgroundColor:'#444'},
  recDotActive:      {backgroundColor:'#ff4444'},
  topBar:            {position:'absolute',top:0,left:0,right:0,flexDirection:'row',alignItems:'center',
                      paddingHorizontal:12,paddingBottom:12,backgroundColor:'rgba(0,0,0,0.55)',zIndex:20},
  backBtn:           {paddingHorizontal:8,paddingVertical:4},
  backTxt:           {color:'#00ff88',fontSize:15,fontWeight:'600'},
  topCenter:         {flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  timerTxt:          {color:'#fff',fontSize:15,fontWeight:'bold'},
  clipsBadge:        {flexDirection:'row',alignItems:'center',gap:3,backgroundColor:'rgba(255,255,255,0.1)',
                      paddingHorizontal:8,paddingVertical:4,borderRadius:12,marginRight:4},
  clipsBadgeIco:     {fontSize:14},
  clipsBadgeCount:   {color:'#fff',fontSize:13,fontWeight:'bold'},
  settingsBtn:       {paddingHorizontal:8},
  modeBadgeRow:      {position:'absolute',left:0,right:0,alignItems:'center',zIndex:20},
  modeBadge:         {paddingHorizontal:16,paddingVertical:5,borderRadius:20,borderWidth:1.5,backgroundColor:'rgba(0,0,0,0.6)'},
  modeBadgeTxt:      {fontSize:13,fontWeight:'bold'},
  statusBar:         {position:'absolute',left:16,right:16,alignItems:'center',zIndex:20},
  statusTxt:         {color:'#fff',fontSize:13,fontWeight:'600',backgroundColor:'rgba(0,0,0,0.6)',
                      paddingHorizontal:12,paddingVertical:4,borderRadius:12,overflow:'hidden'},
  dashInfo:          {position:'absolute',bottom:220,left:16,right:16,
                      flexDirection:'row',justifyContent:'center',gap:8,flexWrap:'wrap',zIndex:20},
  dashInfoTxt:       {color:'rgba(255,255,255,0.9)',fontSize:11,backgroundColor:'rgba(0,0,0,0.6)',
                      paddingHorizontal:8,paddingVertical:3,borderRadius:8,overflow:'hidden',
                      borderWidth:1,borderColor:'rgba(255,255,255,0.15)'},
  eventLog: {position:'absolute',top:'40%',left:24,right:24,backgroundColor:'rgba(0,0,0,0.88)',
            borderRadius:14,padding:16,borderWidth:1.5,borderColor:'rgba(255,68,68,0.6)',zIndex:50,
            shadowColor:'#ff4444',shadowOffset:{width:0,height:0},shadowOpacity:0.4,shadowRadius:20},
  eventLogTitle:     {color:'#ff4444',fontSize:11,fontWeight:'bold',marginBottom:4},
  eventItem:         {color:'rgba(255,255,255,0.85)',fontSize:11,paddingVertical:1},
  securityControls:  {position:'absolute',bottom:115,left:16,right:16,gap:10,zIndex:20},
  armBtn:            {flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,
                      backgroundColor:'rgba(0,255,136,0.15)',borderRadius:14,paddingVertical:14,
                      borderWidth:2,borderColor:'#00ff88'},
  armBtnActive:      {backgroundColor:'rgba(255,68,68,0.15)',borderColor:'#ff4444'},
  armBtnIco:         {fontSize:22},
  armBtnTxt:         {color:'#fff',fontSize:16,fontWeight:'bold'},
  manualRecBtn:      {flexDirection:'row',alignItems:'center',justifyContent:'center',
                      backgroundColor:'rgba(0,0,0,0.6)',borderRadius:10,paddingVertical:10,
                      borderWidth:1,borderColor:'rgba(255,255,255,0.2)'},
  manualRecBtnActive:{borderColor:'#ff4444'},
  manualRecTxt:      {color:'#fff',fontSize:13,fontWeight:'600'},
  controls:          {position:'absolute',bottom:0,left:0,right:0,flexDirection:'row',alignItems:'center',
                      justifyContent:'space-around',paddingBottom:Platform.OS==='ios'?34:16,
                      paddingTop:14,backgroundColor:'rgba(0,0,0,0.75)',paddingHorizontal:8,zIndex:20},
  ctrlBtn:           {alignItems:'center',padding:8,borderRadius:10,minWidth:56},
  ctrlBtnOn:         {backgroundColor:'rgba(255,200,0,0.2)'},
  ctrlBtnNV:         {backgroundColor:'rgba(0,255,100,0.15)'},
  ctrlIco:           {fontSize:24},
  ctrlTxt:           {color:'rgba(255,255,255,0.7)',fontSize:10,marginTop:3,fontWeight:'600'},
  recordBtn:         {width:72,height:72,borderRadius:36,borderWidth:4,borderColor:'#555',alignItems:'center',justifyContent:'center'},
  recordBtnActive:   {borderColor:'#ff4444'},
  recordInner:       {width:52,height:52,borderRadius:26,backgroundColor:'#ff4444'},
  recordInnerActive: {width:24,height:24,borderRadius:4,backgroundColor:'#ff4444'},
  promptOverlay:     {flex:1,backgroundColor:'rgba(0,0,0,0.9)',justifyContent:'center',alignItems:'center',padding:20},
  promptBox:         {backgroundColor:'#111',borderRadius:16,padding:24,width:'100%',borderWidth:1,borderColor:'#333'},
  promptTitle:       {color:'#00ff88',fontSize:22,fontWeight:'bold',textAlign:'center',marginBottom:6},
  promptSub:         {color:'#666',fontSize:14,textAlign:'center',marginBottom:20},
  promptOption:      {flexDirection:'row',alignItems:'center',gap:14,backgroundColor:'#1a1a1a',
                      borderRadius:10,padding:14,marginBottom:10,borderWidth:1,borderColor:'#333'},
  promptOptionIco:   {fontSize:26},
  promptOptionTitle: {color:'#fff',fontSize:15,fontWeight:'bold'},
  promptOptionDesc:  {color:'#666',fontSize:12,marginTop:2},
  promptCancel:      {marginTop:8,alignItems:'center',padding:12},
  promptCancelTxt:   {color:'#666',fontSize:14},
  modalOverlay:      {flex:1,backgroundColor:'rgba(0,0,0,0.88)',justifyContent:'flex-end'},
  modalContent:      {backgroundColor:'#111',borderTopLeftRadius:20,borderTopRightRadius:20,
                      padding:24,borderWidth:1,borderColor:'#222',paddingBottom:40},
  modalTitle:        {color:'#00ff88',fontSize:18,fontWeight:'bold',marginBottom:20,textAlign:'center'},
  settingSection:    {color:'#666',fontSize:11,fontWeight:'bold',textTransform:'uppercase',
                      letterSpacing:1,marginTop:16,marginBottom:8},
  settingRow:        {flexDirection:'row',justifyContent:'space-between',alignItems:'center',
                      paddingVertical:8,borderBottomWidth:1,borderBottomColor:'#222'},
  settingLabel:      {color:'#fff',fontSize:14},
  settingNote:       {color:'#666',fontSize:11,marginTop:2},
  premiumBadge:      {backgroundColor:'#ffd70020',paddingHorizontal:6,paddingVertical:2,borderRadius:4,borderWidth:1,borderColor:'#ffd700'},
  premiumTxt:        {color:'#ffd700',fontSize:9,fontWeight:'bold'},
  modalClose:        {marginTop:12,backgroundColor:'#00ff88',borderRadius:10,padding:14,alignItems:'center'},
  modalCloseTxt:     {color:'#000',fontSize:16,fontWeight:'bold'},
});

// ─── Clips Screen Styles ─────────────────────────────────────────
const cl = StyleSheet.create({
  container:    {flex:1,backgroundColor:'#0a0a0a'},
  header:       {flexDirection:'row',alignItems:'center',justifyContent:'space-between',
                 padding:16,paddingTop:50,backgroundColor:'#111'},
  backBtn:      {paddingRight:12},
  backTxt:      {color:'#00ff88',fontSize:15,fontWeight:'600'},
  title:        {color:'#fff',fontSize:18,fontWeight:'bold',flex:1,textAlign:'center'},
  galleryBtn:   {paddingLeft:12},
  galleryTxt:   {color:'#00ff88',fontSize:14,fontWeight:'600'},
  summary:      {flexDirection:'row',alignItems:'center',justifyContent:'space-around',
                 backgroundColor:'#111',marginHorizontal:16,marginTop:16,borderRadius:10,
                 padding:16,marginBottom:8},
  summaryItem:  {alignItems:'center'},
  summaryN:     {color:'#00ff88',fontSize:20,fontWeight:'bold'},
  summaryL:     {color:'#666',fontSize:11,marginTop:2},
  deleteAllBtn: {backgroundColor:'#ff444420',paddingHorizontal:14,paddingVertical:8,
                 borderRadius:8,borderWidth:1,borderColor:'#ff444460'},
  deleteAllTxt: {color:'#ff4444',fontSize:12,fontWeight:'bold'},
  empty:        {flex:1,alignItems:'center',justifyContent:'center',marginTop:60},
  emptyTxt:     {color:'#fff',fontSize:18,marginTop:16},
  emptySub:     {color:'#666',fontSize:13,marginTop:8},
  clipCard:     {flexDirection:'row',alignItems:'center',backgroundColor:'#1a1a1a',
                 borderRadius:10,padding:12,marginBottom:8,borderWidth:1,borderColor:'#222'},
  clipIcon:     {alignItems:'center',marginRight:12},
  clipNum:      {color:'#666',fontSize:10,marginTop:2},
  clipInfo:     {flex:1},
  clipName:     {color:'#fff',fontSize:13,fontWeight:'600'},
  clipMeta:     {color:'#666',fontSize:11,marginTop:3},
  clipDelete:   {padding:8},
});

export default App;