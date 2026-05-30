import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, FlatList, KeyboardAvoidingView, Platform, Modal, Animated,
  ScrollView, Switch, Dimensions, StatusBar, Linking, PermissionsAndroid, AppState
} from 'react-native';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioModule } from 'expo-audio';
import NetInfo from '@react-native-community/netinfo';
import { Accelerometer } from 'expo-sensors';
import { io } from 'socket.io-client';

const { width: SW, height: SH } = Dimensions.get('window');
const API_URL = 'https://whale-app-hxokg.ondigitalocean.app';
const api = axios.create({ baseURL: API_URL, timeout: 10000 });
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

const Stack = createNativeStackNavigator();
const EVENTS_KEY   = 'motion_events_log';
const SUB_KEY      = 'subscription_tier'; // 'free' | 'pro' | 'enterprise'

// Subscription tiers
const TIERS = {
  free:       { label:'Free',        price:'$0/mo',   color:'#666',    features:['Local recording','Night Vision','1 camera','Basic alerts'] },
  pro:        { label:'Pro',         price:'$9.99/mo', color:'#00ff88', features:['Everything in Free','Loop Forever','Cloud storage 50GB','5 cameras','Priority support'] },
  enterprise: { label:'Enterprise',  price:'$24.99/mo',color:'#ffd700', features:['Everything in Pro','Unlimited cameras','Cloud storage 500GB','Multi-admin (3 users)','Advanced analytics','API access'] },
};

const LOOP_OPTIONS = [
  { label:'1 min',  value:60  },
  { label:'5 min',  value:300 },
  { label:'15 min', value:900 },
  { label:'30 min', value:1800},
];

const CLIP_SIZE_OPTIONS = [
  { label:'1 min clips', value:60  },
  { label:'3 min clips', value:180 },
  { label:'5 min clips', value:300 },
];

// ─── Helpers ─────────────────────────────────────────────────────
const formatSize = (b) => {
  if (!b) return '0 KB';
  if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/(1024*1024)).toFixed(1)} MB`;
};

const saveEventToLog = async (event) => {
  try {
    // Save locally
    const raw = await AsyncStorage.getItem(EVENTS_KEY);
    const log = raw ? JSON.parse(raw) : [];
    log.unshift(event);
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(log.slice(0,200)));
    // Also save to backend so web admin can see events remotely
    const token = await AsyncStorage.getItem('accessToken');
    if (token) {
      api.post('/api/motion/detect', {
        device_id: event.deviceId,
        device_name: event.deviceName,
        type: event.type,
        confidence: 90,
        timestamp: new Date(event.id).toISOString(),
        cam_mode: event.camMode,
      }).catch(()=>{});
    }
  } catch {}
};

const openVideoFile = (uri) => {
  if (Platform.OS === 'android') {
    Linking.openURL(`content://${uri}`).catch(() => {
      // fallback: open with intent
      Linking.sendIntent('android.intent.action.VIEW', [
        { key: 'android.intent.extra.STREAM', value: uri }
      ]).catch(() => Alert.alert('Cannot open', 'Please open from your Gallery app.'));
    });
  } else {
    Linking.openURL(uri).catch(() => Alert.alert('Cannot open', 'Please open from Photos app.'));
  }
};

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
          const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
          if (!ok) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            { title:'Network', message:'Needed to show WiFi name.', buttonPositive:'Allow', buttonNegative:'Skip' });
        } catch {}
      }
      const apply = (st) => {
        if (st.type==='wifi' && st.isConnected) {
          const n = st.details?.ssid;
          setSsid(n && n!=='<unknown ssid>' ? n : 'WiFi');
          const s = st.details?.strength;
          setStrength(s!=null ? Math.min(4,Math.round((s/100)*4)) : 3);
        } else if (st.isConnected) { setSsid('Mobile'); setStrength(2); }
        else { setSsid('Offline'); setStrength(0); }
      };
      apply(await NetInfo.fetch());
      unsub = NetInfo.addEventListener(apply);
    };
    init();
    return () => { if (unsub) unsub(); };
  }, []);
  const openWifi = () => {
    if (Platform.OS==='android') Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(()=>Linking.openSettings());
    else Linking.openURL('App-Prefs:WIFI').catch(()=>{});
  };
  return (
    <TouchableOpacity style={s.stat} onPress={openWifi}>
      <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
        <Text style={[s.statN,{fontSize:12}]} numberOfLines={1}>{ssid.length>9?ssid.substring(0,8)+'…':ssid}</Text>
        <SignalBars strength={strength}/>
      </View>
      <Text style={s.statL}>Network ›</Text>
    </TouchableOpacity>
  );
}

// ─── Live Clock ──────────────────────────────────────────────────
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t); }, []);
  const pad = n => String(n).padStart(2,'0');
  return (
    <View style={cs.clockBox}>
      <Text style={cs.clockTime}>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</Text>
      <Text style={cs.clockDate}>{now.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}</Text>
    </View>
  );
}

// ─── Night Vision ─────────────────────────────────────────────────
function NightVisionOverlay({ active, premium }) {
  if (!active) return null;
  if (premium) return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill,{zIndex:10}]}>
      <View style={cs.nvDark}/><View style={cs.nvGreen}/><View style={cs.nvVignette}/>
      <View style={cs.nvLabel}><Text style={cs.nvLabelTxt}>🌙 NIGHT VISION PRO</Text></View>
    </View>
  );
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill,{zIndex:10}]}>
      <View style={cs.nvBright}/>
      <View style={cs.nvLabel}><Text style={cs.nvLabelTxt}>🌙 NIGHT MODE</Text></View>
    </View>
  );
}

// ─── Motion Alert Popup (auto-dismiss 14s) ────────────────────────
function MotionPopup({ event, onDismiss }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!event) return;
    opacity.setValue(0);
    Animated.timing(opacity,{toValue:1,duration:300,useNativeDriver:true}).start();
    const t = setTimeout(()=>{
      Animated.timing(opacity,{toValue:0,duration:500,useNativeDriver:true}).start(()=>onDismiss());
    },14000);
    return ()=>clearTimeout(t);
  },[event?.id]);
  if (!event) return null;
  return (
    <Animated.View style={[cs.motionPopup,{opacity}]} pointerEvents="box-none">
      <View style={cs.motionPopupInner}>
        <Text style={cs.motionPopupIco}>{event.type==='motion'?'👁':'🔊'}</Text>
        <View style={{flex:1}}>
          <Text style={cs.motionPopupTitle}>{event.type==='motion'?'Motion Detected!':'Sound Detected!'}</Text>
          <Text style={cs.motionPopupMeta}>{event.deviceName} • {event.camMode==='security'?'Security Cam':'Dash Cam'}</Text>
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

// ─── PiP Front Camera (Dash Cam) ─────────────────────────────────
function PiPCamera({ visible }) {
  if (!visible) return null;
  return (
    <View style={cs.pipContainer}>
      <CameraView style={StyleSheet.absoluteFill} facing="front" mode="video"/>
      <Text style={cs.pipLabel}>FRONT</Text>
    </View>
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
  },[recording]);
  return <Animated.View style={[cs.recDot,recording&&cs.recDotActive,{opacity:anim}]}/>;
}

// ─── Recording Banner ────────────────────────────────────────────
function RecordingBanner({ recording, armed, formatTime, recordingTime, clipCount }) {
  if (!recording && !armed) return null;
  return (
    <View style={[cs.recBanner,{backgroundColor:recording?'#cc0000':'#005522'}]}>
      <Text style={cs.recBannerTxt}>
        {recording ? `● REC  ${formatTime(recordingTime)}   •   ${clipCount} clip${clipCount!==1?'s':''} saved`
                   : '🟢  Armed — monitoring for motion & sound'}
      </Text>
    </View>
  );
}

// ─── Subscription Screen ─────────────────────────────────────────
function SubscriptionScreen({ navigation }) {
  const [current, setCurrent] = useState('free');
  useEffect(()=>{ AsyncStorage.getItem(SUB_KEY).then(v=>{ if(v) setCurrent(v); }); },[]);

  const subscribe = async (tier) => {
    if (tier === 'free') {
      await AsyncStorage.setItem(SUB_KEY, 'free');
      setCurrent('free');
      Alert.alert('Downgraded','You are now on the Free plan.');
      return;
    }
    Alert.alert(
      `Subscribe to ${TIERS[tier].label}`,
      `${TIERS[tier].price}\n\nIn a production build this would open your payment processor.\n\nFor testing, tap Activate to unlock this tier.`,
      [
        {text:'Cancel'},
        {text:'Activate (Test)', onPress: async () => {
          await AsyncStorage.setItem(SUB_KEY, tier);
          setCurrent(tier);
          Alert.alert('✅ Activated', `You now have ${TIERS[tier].label} access!`);
        }},
      ]
    );
  };

  return (
    <View style={sub.container}>
      <View style={sub.header}>
        <TouchableOpacity onPress={()=>navigation.goBack()} style={sub.backBtn}>
          <Text style={sub.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={sub.title}>⭐ Subscription</Text>
        <View style={{width:60}}/>
      </View>
      <ScrollView contentContainerStyle={{padding:16}}>
        <Text style={sub.tagline}>Unlock the full power of Real Security Camera</Text>
        {Object.entries(TIERS).map(([key, tier])=>(
          <View key={key} style={[sub.tierCard, current===key && {borderColor:tier.color,borderWidth:2}]}>
            <View style={sub.tierHeader}>
              <View>
                <Text style={[sub.tierName,{color:tier.color}]}>{tier.label}</Text>
                <Text style={sub.tierPrice}>{tier.price}</Text>
              </View>
              {current===key && <View style={[sub.currentBadge,{backgroundColor:tier.color+'30',borderColor:tier.color}]}>
                <Text style={[sub.currentBadgeTxt,{color:tier.color}]}>CURRENT</Text>
              </View>}
            </View>
            {tier.features.map((f,i)=>(
              <Text key={i} style={sub.feature}>✓ {f}</Text>
            ))}
            {current!==key && (
              <TouchableOpacity style={[sub.subBtn,{backgroundColor:tier.color}]} onPress={()=>subscribe(key)}>
                <Text style={sub.subBtnTxt}>{key==='free'?'Downgrade to Free':`Subscribe — ${tier.price}`}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <Text style={sub.note}>
          💡 Loop Forever recording and Cloud Storage require a Pro or Enterprise subscription.{'\n'}
          Storage costs: Pro ~$0.02/GB/day · Enterprise ~$0.015/GB/day
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Clips Screen ─────────────────────────────────────────────────
function ClipsScreen({ navigation }) {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalSize, setTotalSize] = useState(0);

  useFocusEffect(useCallback(()=>{ loadClips(); },[]) );

  const loadClips = async () => {
    setLoading(true);
    try {
      const dir = FileSystem.documentDirectory;
      const files = await FileSystem.readDirectoryAsync(dir);
      const mp4s = files.filter(f=>f.endsWith('.mp4'));
      const details = await Promise.all(mp4s.map(async f=>{
        const info = await FileSystem.getInfoAsync(dir+f);
        const parts = f.replace('.mp4','').split('_');
        const mode = parts[1]||'dashcam';
        const deviceName = parts.slice(2,-1).join(' ')||'Unknown';
        const ts = parseInt(parts[parts.length-1])||0;
        return { name:f, uri:dir+f, size:info.size||0, modTime:info.modificationTime||0, mode, deviceName, timestamp:ts };
      }));
      details.sort((a,b)=>b.modTime-a.modTime);
      setClips(details);
      setTotalSize(details.reduce((acc,c)=>acc+c.size,0));
    } catch(e) { console.log('Load clips:',e.message); }
    setLoading(false);
  };

  const playClip = async (clip) => {
    try {
      // Save to media library first to ensure we have a content URI
      if (clip.mediaPerm) {
        const asset = await MediaLibrary.createAssetAsync(clip.uri);
        Linking.openURL(asset.uri).catch(()=>openVideoFile(clip.uri));
      } else {
        openVideoFile(clip.uri);
      }
    } catch { openVideoFile(clip.uri); }
  };

  const deleteClip = (clip) => {
    Alert.alert('Delete Clip','Delete this clip?',[
      {text:'Cancel'},
      {text:'Delete',style:'destructive',onPress:async()=>{
        try { await FileSystem.deleteAsync(clip.uri); loadClips(); }
        catch { Alert.alert('Error','Could not delete clip'); }
      }},
    ]);
  };

  const deleteAll = () => {
    Alert.alert('Delete All',`Delete all ${clips.length} clips?`,[
      {text:'Cancel'},
      {text:'Delete All',style:'destructive',onPress:async()=>{
        try { await Promise.all(clips.map(c=>FileSystem.deleteAsync(c.uri))); loadClips(); }
        catch { Alert.alert('Error','Could not delete all clips'); }
      }},
    ]);
  };

  const openGallery = () => {
    if (Platform.OS==='android') {
      Linking.sendIntent('android.intent.action.VIEW',
        [{key:'android.intent.type',value:'video/*'}]).catch(()=>Linking.openSettings());
    } else Linking.openURL('photos-redirect://').catch(()=>{});
  };

  const dashClips = clips.filter(c=>c.mode==='dashcam');
  const secClips  = clips.filter(c=>c.mode==='security');

  const ClipRow = ({item,index,total}) => (
    <TouchableOpacity style={cl.clipCard} onPress={()=>playClip(item)}>
      <View style={cl.clipIcon}>
        <Text style={{fontSize:22}}>{item.mode==='dashcam'?'🚗':'🔒'}</Text>
        <Text style={cl.clipNum}>#{total-index}</Text>
      </View>
      <View style={cl.clipInfo}>
        <Text style={cl.clipDevice}>{item.deviceName}</Text>
        <Text style={cl.clipName}>{new Date(item.timestamp||item.modTime*1000).toLocaleString('en-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</Text>
        <Text style={cl.clipMeta}>{formatSize(item.size)} • {item.mode==='dashcam'?'🚗 Dash Cam':'🔒 Security Cam'} • tap to play</Text>
      </View>
      <TouchableOpacity style={cl.clipDelete} onPress={()=>deleteClip(item)}>
        <Text style={{fontSize:18}}>🗑</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={cl.container}>
      <View style={cl.header}>
        <TouchableOpacity onPress={()=>navigation.goBack()} style={cl.backBtn}><Text style={cl.backTxt}>← Back</Text></TouchableOpacity>
        <Text style={cl.title}>📼 Saved Clips</Text>
        <TouchableOpacity onPress={openGallery} style={cl.galleryBtn}><Text style={cl.galleryTxt}>Gallery ›</Text></TouchableOpacity>
      </View>
      <View style={cl.summary}>
        <View style={cl.summaryItem}><Text style={cl.summaryN}>{clips.length}</Text><Text style={cl.summaryL}>Total</Text></View>
        <View style={cl.summaryItem}><Text style={[cl.summaryN,{color:'#00ff88'}]}>{dashClips.length}</Text><Text style={cl.summaryL}>🚗 Dash</Text></View>
        <View style={cl.summaryItem}><Text style={[cl.summaryN,{color:'#4488ff'}]}>{secClips.length}</Text><Text style={cl.summaryL}>🔒 Sec</Text></View>
        <View style={cl.summaryItem}><Text style={cl.summaryN}>{formatSize(totalSize)}</Text><Text style={cl.summaryL}>Used</Text></View>
        {clips.length>0&&<TouchableOpacity style={cl.deleteAllBtn} onPress={deleteAll}><Text style={cl.deleteAllTxt}>🗑 All</Text></TouchableOpacity>}
      </View>
      {loading?<ActivityIndicator color="#00ff88" style={{marginTop:40}}/>:
        clips.length===0?(
          <View style={cl.empty}><Text style={{fontSize:48}}>📭</Text><Text style={cl.emptyTxt}>No clips yet</Text><Text style={cl.emptySub}>Start recording to save clips here</Text></View>
        ):(
          <ScrollView contentContainerStyle={{padding:12}}>
            {dashClips.length>0&&<>
              <Text style={cl.sectionHeader}>🚗 Dash Cam ({dashClips.length})</Text>
              {dashClips.map((item,i)=><ClipRow key={item.name} item={item} index={i} total={dashClips.length}/>)}
            </>}
            {secClips.length>0&&<>
              <Text style={cl.sectionHeader}>🔒 Security Cam ({secClips.length})</Text>
              {secClips.map((item,i)=><ClipRow key={item.name} item={item} index={i} total={secClips.length}/>)}
            </>}
          </ScrollView>
        )
      }
    </View>
  );
}

// ─── Events Log Screen ────────────────────────────────────────────
function EventsLogScreen({ navigation }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(()=>{
    loadEvents();
    // Auto-refresh every 5s while screen is focused
    const t = setInterval(loadEvents, 5000);
    return ()=>clearInterval(t);
  },[]));

  const loadEvents = async () => {
    try {
      const raw = await AsyncStorage.getItem(EVENTS_KEY);
      setEvents(raw ? JSON.parse(raw) : []);
    } catch {}
    setLoading(false);
  };

  const clearLog = () => {
    Alert.alert('Clear Log','Clear all motion events?',[
      {text:'Cancel'},
      {text:'Clear',style:'destructive',onPress:async()=>{ await AsyncStorage.removeItem(EVENTS_KEY); setEvents([]); }},
    ]);
  };

  const openRelatedClip = async (event) => {
    // Find the clip closest to the event timestamp
    try {
      const dir = FileSystem.documentDirectory;
      const files = await FileSystem.readDirectoryAsync(dir);
      const mp4s = files.filter(f=>f.endsWith('.mp4'));
      const eventTs = event.id;
      let closest = null, minDiff = Infinity;
      mp4s.forEach(f=>{
        const parts = f.replace('.mp4','').split('_');
        const ts = parseInt(parts[parts.length-1])||0;
        const diff = Math.abs(ts - eventTs);
        if (diff < minDiff) { minDiff=diff; closest=f; }
      });
      if (closest && minDiff < 120000) { // within 2 min
        openVideoFile(dir+closest);
      } else {
        Alert.alert('No clip found','No recording found near this event time. The clip may have been deleted.');
      }
    } catch { Alert.alert('Error','Could not find related clip.'); }
  };

  return (
    <View style={cl.container}>
      <View style={cl.header}>
        <TouchableOpacity onPress={()=>navigation.goBack()} style={cl.backBtn}><Text style={cl.backTxt}>← Back</Text></TouchableOpacity>
        <Text style={cl.title}>🚨 Event Log</Text>
        {events.length>0&&<TouchableOpacity onPress={clearLog} style={cl.galleryBtn}><Text style={[cl.galleryTxt,{color:'#ff4444'}]}>Clear</Text></TouchableOpacity>}
      </View>
      {loading?<ActivityIndicator color="#00ff88" style={{marginTop:40}}/>:
        events.length===0?(
          <View style={cl.empty}><Text style={{fontSize:48}}>📋</Text><Text style={cl.emptyTxt}>No events yet</Text><Text style={cl.emptySub}>Motion and sound events appear here</Text></View>
        ):(
          <FlatList
            data={events} keyExtractor={i=>String(i.id)}
            contentContainerStyle={{padding:12}}
            renderItem={({item})=>(
              <TouchableOpacity style={cl.eventCard} onPress={()=>openRelatedClip(item)}>
                <Text style={cl.eventIco}>{item.type==='motion'?'👁':'🔊'}</Text>
                <View style={{flex:1}}>
                  <Text style={cl.eventTitle}>{item.type==='motion'?'Motion Detected':'Sound Detected'}</Text>
                  <Text style={cl.eventDevice}>{item.deviceName}</Text>
                  <Text style={cl.eventTime}>{item.time}  •  {item.date}</Text>
                  <Text style={cl.eventTap}>tap to open clip</Text>
                </View>
                <View style={[cl.eventMode,{
                  backgroundColor:item.camMode==='security'?'#4488ff20':'#00ff8820',
                  borderColor:item.camMode==='security'?'#4488ff60':'#00ff8860',
                }]}>
                  <Text style={{color:item.camMode==='security'?'#4488ff':'#00ff88',fontSize:10,fontWeight:'bold'}}>
                    {item.camMode==='security'?'SEC CAM':'DASH'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )
      }
    </View>
  );
}

// ─── Login ───────────────────────────────────────────────────────
function LoginScreen({ navigation, setToken }) {
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [loading,setLoading]=useState(false);
  const login = async () => {
    if (!email||!password) return Alert.alert('Error','Enter email and password');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login',{email,password});
      await AsyncStorage.setItem('accessToken',res.data.data.accessToken);
      await setToken(res.data.data.accessToken);
    } catch(e) { Alert.alert('Login Failed',e.response?.data?.message||'Check credentials'); }
    setLoading(false);
  };
  return (
    <KeyboardAvoidingView style={s.c} behavior={Platform.OS==='ios'?'padding':'height'}>
      <Text style={s.appIcon}>🔒</Text><Text style={s.appName}>Real Security Camera</Text><Text style={s.sub}>Enterprise Security System</Text>
      <TextInput style={s.input} placeholder="Email" placeholderTextColor="#666" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!loading}/>
      <TextInput style={s.input} placeholder="Password" placeholderTextColor="#666" value={password} onChangeText={setPassword} secureTextEntry editable={!loading}/>
      <TouchableOpacity style={s.btn} onPress={login} disabled={loading}>{loading?<ActivityIndicator color="#000"/>:<Text style={s.btxt}>Login</Text>}</TouchableOpacity>
      <TouchableOpacity onPress={()=>navigation.navigate('Register')} disabled={loading}><Text style={s.link}>Don't have an account? Register</Text></TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ─── Register ────────────────────────────────────────────────────
function RegisterScreen({ navigation, setToken }) {
  const [form,setForm]=useState({email:'',password:'',first_name:'',last_name:'',org_name:''}); const [loading,setLoading]=useState(false);
  const register = async () => {
    if (!form.email||!form.password||!form.first_name||!form.last_name) return Alert.alert('Error','Fill all fields');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/register',form);
      await AsyncStorage.setItem('accessToken',res.data.data.accessToken);
      await setToken(res.data.data.accessToken);
    } catch(e) { Alert.alert('Failed',e.response?.data?.message||'Try again'); }
    setLoading(false);
  };
  return (
    <KeyboardAvoidingView style={s.c} behavior={Platform.OS==='ios'?'padding':'height'}>
      <Text style={s.appIcon}>🔒</Text><Text style={s.appName}>Real Security Camera</Text><Text style={s.sub}>Create Account</Text>
      {['first_name','last_name','email','org_name'].map(f=>(
        <TextInput key={f} style={s.input} placeholder={f.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} placeholderTextColor="#666" value={form[f]} onChangeText={v=>setForm(p=>({...p,[f]:v}))} autoCapitalize={f==='email'?'none':'words'} editable={!loading}/>
      ))}
      <TextInput style={s.input} placeholder="Password" placeholderTextColor="#666" value={form.password} onChangeText={v=>setForm(p=>({...p,password:v}))} secureTextEntry editable={!loading}/>
      <TouchableOpacity style={s.btn} onPress={register} disabled={loading}>{loading?<ActivityIndicator color="#000"/>:<Text style={s.btxt}>Create Account</Text>}</TouchableOpacity>
      <TouchableOpacity onPress={()=>navigation.navigate('Login')} disabled={loading}><Text style={s.link}>Already have an account? Login</Text></TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────
function DashboardScreen({ navigation, logout, socket }) {
  const [devices,setDevices]=useState([]); const [loading,setLoading]=useState(true);
  const [clipCounts,setClipCounts]=useState({});
  const [showAddModal,setShowAddModal]=useState(false); const [deviceName,setDeviceName]=useState('');
  const [deviceLocation,setDeviceLocation]=useState(''); const [step,setStep]=useState(1);
  const [isCreating,setIsCreating]=useState(false);
  const [editingDevice,setEditingDevice]=useState(null); const [editName,setEditName]=useState(''); const [editLocation,setEditLocation]=useState('');
  const [deleteConfirm,setDeleteConfirm]=useState(null);
  const [recentEvents,setRecentEvents]=useState([]);
  const [onlineMap,setOnlineMap]=useState({});
  const [showEventsDropdown,setShowEventsDropdown]=useState(false);

  // Track cameras online via socket
  useEffect(()=>{
    if (!socket) return;
    const onOnline  = ({deviceId})=>setOnlineMap(m=>({...m,[deviceId]:true}));
    const onOffline = ({deviceId})=>setOnlineMap(m=>({...m,[deviceId]:false}));
    socket.on('camera:online',  onOnline);
    socket.on('camera:offline', onOffline);
    return ()=>{ socket.off('camera:online',onOnline); socket.off('camera:offline',onOffline); };
  },[socket]);

  // Refresh on focus + every 10s
  useFocusEffect(useCallback(()=>{
    loadAll();
    const t = setInterval(loadAll,10000);
    return ()=>clearInterval(t);
  },[]));

  const loadAll = () => { loadDevices(); loadClipCounts(); loadRecentEvents(); };

  const loadDevices = async () => {
    try { const res=await api.get('/api/devices'); setDevices(res.data.data||[]); } catch(e){}
    setLoading(false);
  };

  const loadClipCounts = async () => {
    try {
      const dir = FileSystem.documentDirectory;
      const files = await FileSystem.readDirectoryAsync(dir);
      const counts = {};
      files.filter(f=>f.endsWith('.mp4')).forEach(f=>{
        const parts = f.replace('.mp4','').split('_');
        const mode = parts[1]||'dashcam';
        const deviceId = parts[2]||'unknown';
        if (!counts[deviceId]) counts[deviceId]={dashcam:0,security:0};
        counts[deviceId][mode]=(counts[deviceId][mode]||0)+1;
      });
      setClipCounts(counts);
    } catch {}
  };

  const loadRecentEvents = async () => {
    try {
      const raw=await AsyncStorage.getItem(EVENTS_KEY);
      setRecentEvents(raw?JSON.parse(raw).slice(0,10):[]);
    } catch {}
  };

  const closeAddModal = ()=>{ setShowAddModal(false); setDeviceName(''); setDeviceLocation(''); setStep(1); };

  const handleAddDevice = async () => {
    if (!deviceLocation.trim()){ Alert.alert('Error','Please enter a location'); return; }
    setIsCreating(true);
    try {
      await api.post('/api/devices',{name:deviceName,location:deviceLocation,rtspUrl:''});
      Alert.alert('Success','Camera added!'); closeAddModal(); loadDevices();
    } catch(e){ Alert.alert('Error',e.response?.data?.message||'Failed'); }
    setIsCreating(false);
  };

  const saveDeviceChanges = async () => {
    if (!editName.trim()){ Alert.alert('Error','Name cannot be empty'); return; }
    try {
      await api.put(`/api/devices/${editingDevice.id}`,{name:editName,location:editLocation});
      Alert.alert('Success','Updated!'); setEditingDevice(null); loadDevices();
    } catch(e){ Alert.alert('Error',e.response?.data?.message||'Failed'); }
  };

  const handleDeleteDevice = async (id) => {
    try { await api.delete(`/api/devices/${id}`); setDeleteConfirm(null); loadDevices(); }
    catch(e){ Alert.alert('Error',e.response?.data?.message||'Failed'); }
  };

  const openCamera = (device,mode) => navigation.navigate('Camera',{device,initialMode:mode==='camera'?'dashcam':'security'});

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>🔒 Real Security Camera</Text>
        <View style={{flexDirection:'row',gap:8}}>
          <TouchableOpacity onPress={()=>navigation.navigate('Subscription')} style={s.subBtn}>
            <Text style={s.subBtnTxt}>⭐</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} style={s.logoutBtn}><Text style={s.logout}>Logout</Text></TouchableOpacity>
        </View>
      </View>

      {/* Stats row */}
      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statN}>{devices.length}</Text><Text style={s.statL}>Cameras</Text></View>
        <View style={s.stat}><Text style={s.statN}>{devices.filter(d=>onlineMap[d.id]||d.is_active).length}</Text><Text style={s.statL}>Online</Text></View>
        <WiFiStat/>
        <View style={s.stat}>
          <Text style={[s.statN,{color:socket?.connected?'#00ff88':'#ff4444',fontSize:16}]}>{socket?.connected?'●':'○'}</Text>
          <Text style={[s.statL,{color:socket?.connected?'#00ff88':'#888'}]}>{socket?.connected?'Live':'Offline'}</Text>
        </View>
        {/* Events dropdown trigger */}
        <TouchableOpacity style={s.stat} onPress={()=>setShowEventsDropdown(v=>!v)}>
          <Text style={s.statN}>{recentEvents.length}</Text>
          <Text style={[s.statL,{color:'#ff8844'}]}>Events {showEventsDropdown?'▲':'▼'}</Text>
        </TouchableOpacity>
      </View>

      {/* Events dropdown */}
      {showEventsDropdown && (
        <View style={s.eventsDropdown}>
          <View style={s.eventsDropdownHeader}>
            <Text style={s.eventsDropdownTitle}>🚨 Recent Events</Text>
            <TouchableOpacity onPress={()=>{ setShowEventsDropdown(false); navigation.navigate('EventsLog'); }}>
              <Text style={s.eventsDropdownAll}>View All ›</Text>
            </TouchableOpacity>
          </View>
          {recentEvents.length===0 && <Text style={s.eventsDropdownEmpty}>No events yet</Text>}
          {recentEvents.slice(0,5).map(e=>(
            <TouchableOpacity key={e.id} style={s.eventsDropdownItem}
              onPress={()=>{ setShowEventsDropdown(false); navigation.navigate('EventsLog'); }}>
              <Text style={s.eventsDropdownIco}>{e.type==='motion'?'👁':'🔊'}</Text>
              <View style={{flex:1}}>
                <Text style={s.eventsDropdownDevice}>{e.deviceName}</Text>
                <Text style={s.eventsDropdownTime}>{e.time} • {e.camMode==='security'?'Security Cam':'Dash Cam'}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading?<ActivityIndicator color="#00ff88" style={{marginTop:40}}/>:
        <FlatList
          data={devices} keyExtractor={i=>i.id} numColumns={2}
          contentContainerStyle={{padding:8}} refreshing={loading}
          onRefresh={loadAll}
          ListEmptyComponent={
            <View style={{alignItems:'center',marginTop:60}}>
              <Text style={{fontSize:48}}>📷</Text>
              <Text style={{color:'#fff',fontSize:18,marginTop:16}}>No cameras yet</Text>
              <Text style={{color:'#666',marginTop:8}}>Tap + to add one</Text>
            </View>
          }
          renderItem={({item})=>{
            const counts=clipCounts[item.id]||{dashcam:0,security:0};
            return (
              <View style={{flex:1}}>
                <TouchableOpacity style={s.card} onLongPress={()=>{ setEditingDevice(item); setEditName(item.name); setEditLocation(item.location||''); }} delayLongPress={400}>
                  <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <Text style={{fontSize:26}}>📷</Text>
                    <View style={[s.dot,{backgroundColor:(onlineMap[item.id]||item.is_active)?'#00ff88':'#666'}]}/>
                  </View>
                  <Text style={s.cardName}>{item.name}</Text>
                  <Text style={s.cardLoc}>📍 {item.location||'No location'}</Text>
                  <Text style={s.cardHint}>Hold to edit</Text>
                  <View style={s.clipCountRow}>
                    <TouchableOpacity style={s.clipCountBadge} onPress={()=>navigation.navigate('Clips')}>
                      <Text style={s.clipCountTxt}>🚗 {counts.dashcam}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.clipCountBadge,{borderColor:'#4488ff40',backgroundColor:'#4488ff10'}]} onPress={()=>navigation.navigate('Clips')}>
                      <Text style={[s.clipCountTxt,{color:'#4488ff'}]}>🔒 {counts.security}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.cardActions}>
                    <TouchableOpacity style={[s.cardActionBtn,{backgroundColor:'#00ff8818',borderColor:'#00ff8860'}]} onPress={()=>openCamera(item,'camera')}>
                      <Text style={s.cardActionIco}>🚗</Text><Text style={[s.cardActionTxt,{color:'#00ff88'}]}>Dash Cam</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.cardActionBtn,{backgroundColor:'#4488ff18',borderColor:'#4488ff60'}]} onPress={()=>openCamera(item,'viewer')}>
                      <Text style={s.cardActionIco}>🔒</Text><Text style={[s.cardActionTxt,{color:'#4488ff'}]}>Security</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={s.deleteBtn} onPress={()=>setDeleteConfirm(item.id)}>
                  <Text style={s.deleteBtnTxt}>🗑 Delete</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      }
      <TouchableOpacity style={s.fab} onPress={()=>setShowAddModal(true)}>
        <Text style={{color:'#000',fontSize:32,fontWeight:'bold'}}>+</Text>
      </TouchableOpacity>

      {/* Modals */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={closeAddModal}>
        <View style={s.modalBg}><View style={s.modalBox}>
          {step===1?(<>
            <Text style={s.modalTitle}>Add Camera</Text><Text style={s.modalSub}>Enter device name</Text>
            <TextInput style={s.input} placeholder="Device Name" placeholderTextColor="#666" value={deviceName} onChangeText={setDeviceName} editable={!isCreating}/>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalBtnCancel} onPress={closeAddModal}><Text style={s.modalBtnCancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalBtnPrimary} onPress={()=>setStep(2)} disabled={!deviceName.trim()}><Text style={s.modalBtnPrimaryTxt}>Next</Text></TouchableOpacity>
            </View>
          </>):(<>
            <Text style={s.modalTitle}>Enter Location</Text><Text style={s.modalSub}>Where is this camera?</Text>
            <TextInput style={s.input} placeholder="Location" placeholderTextColor="#666" value={deviceLocation} onChangeText={setDeviceLocation} editable={!isCreating}/>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalBtnCancel} onPress={()=>setStep(1)}><Text style={s.modalBtnCancelTxt}>Back</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalBtnPrimary} onPress={handleAddDevice} disabled={isCreating}>{isCreating?<ActivityIndicator color="#000"/>:<Text style={s.modalBtnPrimaryTxt}>Add Device</Text>}</TouchableOpacity>
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
          <Text style={[s.modalTitle,{color:'#ff4444'}]}>Delete Camera?</Text><Text style={s.modalSub}>This cannot be undone.</Text>
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
function CameraScreen({ navigation, route, socket }) {
  const { device, initialMode } = route.params || {};

  const [camPerm,       requestCamPerm]  = useCameraPermissions();
  const [micPerm,       requestMicPerm]  = useMicrophonePermissions();
  const [mediaPerm,     setMediaPerm]    = useState(false);
  const [facing,        setFacing]       = useState('back');
  const [nightVision,   setNightVision]  = useState(false);
  const [nightVisionPro,setNightVisionPro]=useState(false);
  const [torch,         setTorch]        = useState(false);
  const [zoom,          setZoom]         = useState(0);
  const [showPiP,       setShowPiP]      = useState(false);
  const [camMode]                        = useState(initialMode||'dashcam');
  const [isRecording,   setIsRecording]  = useState(false);
  const [isArmed,       setIsArmed]      = useState(false);
  const [recordingTime, setRecordingTime]= useState(0);
  const [clipCount,     setClipCount]    = useState(0);
  const [loopDuration,  setLoopDuration] = useState(300);
  const [loopForever,   setLoopForever]  = useState(false);
  const [clipSize,      setClipSize]     = useState(300);
  const [cloudUpload,   setCloudUpload]  = useState(false);
  const [motionEnabled, setMotionEnabled]= useState(true);
  const [soundEnabled,  setSoundEnabled] = useState(true);
  const [activePopup,   setActivePopup]  = useState(null);
  const [showSettings,  setShowSettings] = useState(false);
  const [showLoopPrompt,setShowLoopPrompt]=useState(false);
  const [showClipSize,  setShowClipSize] = useState(false);
  const [statusMsg,     setStatusMsg]    = useState(initialMode==='dashcam'?'Tap record to start':'Ready to monitor');
  const [subscription,  setSubscription] = useState('free');
  // Status message auto-clear
  const statusTimerRef = useRef(null);

  // Refs
  const cameraRef        = useRef(null);
  const timerRef         = useRef(null);
  const loopRef          = useRef(null);
  const recorderRef      = useRef(null);
  const soundMeterRef    = useRef(null);
  const accelSubRef      = useRef(null);
  const alertAnim        = useRef(new Animated.Value(0)).current;
  const isRecordingRef   = useRef(false);
  const isArmedRef       = useRef(false);
  const alertActiveRef   = useRef(false);
  const motionEnabledRef = useRef(true);
  const soundEnabledRef  = useRef(true);
  const loopForeverRef   = useRef(false);
  const loopDurationRef  = useRef(300);
  const clipSizeRef      = useRef(300);
  const camModeRef       = useRef(initialMode||'dashcam');
  const camPermRef       = useRef(false);
  const micPermRef       = useRef(false);
  const motionCoolRef    = useRef(false);
  // Accelerometer baseline
  const accelBaseRef     = useRef(null);
  const accelLastRef     = useRef({x:0,y:0,z:0});

  useEffect(()=>{ motionEnabledRef.current=motionEnabled; },[motionEnabled]);
  useEffect(()=>{ soundEnabledRef.current=soundEnabled;   },[soundEnabled]);
  useEffect(()=>{ loopForeverRef.current=loopForever;     },[loopForever]);
  useEffect(()=>{ loopDurationRef.current=loopDuration;   },[loopDuration]);
  useEffect(()=>{ clipSizeRef.current=clipSize;           },[clipSize]);

  useEffect(()=>{
    (async()=>{
      const sub = await AsyncStorage.getItem(SUB_KEY);
      setSubscription(sub||'free');
      if (!camPerm?.granted) { const r=await requestCamPerm(); camPermRef.current=r?.granted??false; }
      else camPermRef.current=true;
      if (!micPerm?.granted) { const r=await requestMicPerm(); micPermRef.current=r?.granted??false; }
      else micPermRef.current=true;
      const ms=await MediaLibrary.getPermissionsAsync();
      if (ms.status==='granted') setMediaPerm(true);
      else { const {status}=await MediaLibrary.requestPermissionsAsync(); setMediaPerm(status==='granted'); }
    })();
    if (initialMode==='dashcam') setTimeout(()=>setShowLoopPrompt(true),700);

    // Announce online after a short delay to ensure socket is stable
    const announceTimer = setTimeout(()=>{
      if (socket && device?.id) {
        AsyncStorage.getItem('accessToken').then(token=>{
          if (!token) return;
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            socket.emit('auth',{
              deviceId: device.id,
              deviceName: device.name || 'Mobile Camera',
              role: 'camera',
              organizationId: payload.organizationId,
              userId: payload.userId || payload.id,
            });
            console.log('📷 Announced camera online:', device.name);
          } catch(e) { console.log('Socket auth error:', e.message); }
        });
      }
    }, 1000);

    return ()=>{
      clearTimeout(announceTimer);
      stopAll();
      // Announce offline when leaving camera screen
      if (socket && device?.id) {
        socket.emit('camera:offline',{deviceId:device.id});
        console.log('📷 Announced camera offline:', device.name);
      }
    };
  },[]);

  const stopAll = () => {
    clearInterval(timerRef.current); clearInterval(loopRef.current);
    clearInterval(soundMeterRef.current); clearTimeout(statusTimerRef.current);
    stopAccel();
    if (recorderRef.current) { try { recorderRef.current.stop(); } catch {} recorderRef.current=null; }
  };

  const startTimer = ()=>{ setRecordingTime(0); timerRef.current=setInterval(()=>setRecordingTime(t=>t+1),1000); };
  const stopTimer  = ()=>{ clearInterval(timerRef.current); setRecordingTime(0); };
  const formatTime = (sec)=>`${Math.floor(sec/60).toString().padStart(2,'0')}:${(sec%60).toString().padStart(2,'0')}`;

  const setStatus = (msg, autoClear=0) => {
    setStatusMsg(msg);
    clearTimeout(statusTimerRef.current);
    if (autoClear>0) statusTimerRef.current=setTimeout(()=>setStatusMsg(isArmedRef.current?'🟢 Armed — monitoring...':'Ready'),autoClear);
  };

  // ── Accelerometer motion detection ───────────────────────────
  // Uses the device accelerometer to detect physical movement of the camera.
  // Measures delta from baseline to detect significant motion in the scene.
  const startAccel = () => {
    Accelerometer.setUpdateInterval(200);
    accelSubRef.current = Accelerometer.addListener(data=>{
      if (!isArmedRef.current || !motionEnabledRef.current || motionCoolRef.current || alertActiveRef.current) {
        accelLastRef.current = data;
        return;
      }
      const prev = accelLastRef.current;
      const delta = Math.sqrt(
        Math.pow(data.x-prev.x,2) +
        Math.pow(data.y-prev.y,2) +
        Math.pow(data.z-prev.z,2)
      );
      accelLastRef.current = data;
      // Threshold: 0.15g delta = significant movement detected
      if (delta > 0.15) {
        console.log('📱 Accelerometer motion detected, delta:', delta.toFixed(3));
        triggerAlert('motion');
      }
    });
  };

  const stopAccel = () => {
    if (accelSubRef.current) { accelSubRef.current.remove(); accelSubRef.current=null; }
  };

  // ── Loop choice ───────────────────────────────────────────────
  const handleLoopChoice = (forever, duration) => {
    if (forever) {
      // Check subscription
      if (subscription==='free') {
        setShowLoopPrompt(false);
        Alert.alert('⭐ Premium Feature','Loop Forever requires a Pro or Enterprise subscription.\n\nCloud storage is required for continuous recording.',
          [{text:'Not Now'},{text:'Upgrade',onPress:()=>navigation.navigate('Subscription')}]);
        return;
      }
      setShowLoopPrompt(false); setShowClipSize(true);
    } else {
      setLoopForever(false); loopForeverRef.current=false;
      setLoopDuration(duration); loopDurationRef.current=duration;
      setShowLoopPrompt(false);
      if (camModeRef.current==='dashcam') setTimeout(()=>startRecording(),200);
      else armSecurity();
    }
  };

  const handleClipSizeChoice = (size) => {
    setClipSize(size); clipSizeRef.current=size;
    setLoopForever(true); loopForeverRef.current=true;
    setShowClipSize(false);
    if (camModeRef.current==='dashcam') setTimeout(()=>startRecording(),200);
    else armSecurity();
  };

  const armSecurity = async () => {
    isArmedRef.current=true; setIsArmed(true);
    setStatus('🟢 Armed — monitoring...');
    startAccel();
    if (soundEnabledRef.current) startSoundMonitor();
  };

  const handleArmToggle = async () => {
    if (isArmedRef.current) {
      isArmedRef.current=false; setIsArmed(false);
      stopAccel(); await stopSoundMonitor();
      if (isRecordingRef.current) await stopRecording();
      setStatus('Ready to monitor');
    } else { setShowLoopPrompt(true); }
  };

  // ── Sound monitor ─────────────────────────────────────────────
  const startSoundMonitor = async () => {
    if (!soundEnabledRef.current) return;
    try {
      const perm=await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      const rec=new AudioModule.AudioRecorder({
        android:{extension:'.m4a',outputFormat:'mpeg4',audioEncoder:'aac'},
        ios:{extension:'.m4a',outputFormat:'mpeg4',audioQuality:'medium'},web:{},
      });
      recorderRef.current=rec;
      await rec.prepareToRecordAsync(); await rec.record();
      soundMeterRef.current=setInterval(async()=>{
        try {
          const level=rec.currentMeteringLevel??-160;
          if (level>-40 && isArmedRef.current && !motionCoolRef.current) triggerAlert('sound');
        } catch {}
      },600);
    } catch(e){ console.log('Sound monitor:',e.message); }
  };

  const stopSoundMonitor = async () => {
    clearInterval(soundMeterRef.current);
    if (recorderRef.current) { try { await recorderRef.current.stop(); } catch {} recorderRef.current=null; }
  };

  // ── Trigger alert ─────────────────────────────────────────────
  const triggerAlert = (type) => {
    if (alertActiveRef.current||motionCoolRef.current) return;
    alertActiveRef.current=true; motionCoolRef.current=true;
    const now=new Date();
    const event={
      type, id:Date.now(),
      time:now.toLocaleTimeString(),
      date:now.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}),
      deviceName:device?.name||'Camera',
      camMode:camModeRef.current,
    };
    setActivePopup(event);
    setStatus(`⚠️ ${type==='motion'?'Motion':'Sound'} detected!`);
    saveEventToLog(event);
    Animated.sequence([
      Animated.timing(alertAnim,{toValue:1,duration:150,useNativeDriver:true}),
      Animated.timing(alertAnim,{toValue:0,duration:150,useNativeDriver:true}),
      Animated.timing(alertAnim,{toValue:1,duration:150,useNativeDriver:true}),
      Animated.timing(alertAnim,{toValue:0,duration:300,useNativeDriver:true}),
    ]).start();
    setTimeout(()=>{ if (!isRecordingRef.current&&cameraRef.current) startRecording(true); },300);
    api.post('/api/motion/detect',{device_id:device?.id,confidence:85,type}).catch(()=>{});
    setTimeout(()=>{ alertActiveRef.current=false; setStatus(isArmedRef.current?'🟢 Armed — monitoring...':'Ready'); },14000);
  };

  // ── Recording ─────────────────────────────────────────────────
  const startRecording = async (triggered=false) => {
    if (!cameraRef.current||isRecordingRef.current) return;
    if (!camPermRef.current||!micPermRef.current) { console.log('Permissions not granted'); return; }
    try {
      isRecordingRef.current=true; setIsRecording(true);
      setStatus(triggered?'🔴 Recording (triggered)':'🔴 Recording...');
      startTimer();
      const isForever=loopForeverRef.current;
      const clipDur=isForever?clipSizeRef.current:loopDurationRef.current;
      if (camModeRef.current==='dashcam'&&!isForever&&clipDur>0) {
        clearInterval(loopRef.current);
        loopRef.current=setInterval(()=>rotateClip(),clipDur*1000);
      }
      const opts={mute:false};
      if (clipDur>0) opts.maxDuration=clipDur;
      cameraRef.current.recordAsync(opts)
        .then(async(video)=>{ if(video?.uri) await saveClip(video.uri,triggered); })
        .catch((e)=>{ if(!e.message?.includes('cancelled')&&!e.message?.includes('stopped')) console.log('Record:',e.message); });
    } catch(e) {
      console.log('startRecording:',e.message);
      isRecordingRef.current=false; setIsRecording(false); setStatus('Error — tap to retry');
    }
  };

  const stopRecording = async () => {
    clearInterval(loopRef.current); stopTimer();
    if (cameraRef.current&&isRecordingRef.current) { try { cameraRef.current.stopRecording(); } catch {} }
    isRecordingRef.current=false; setIsRecording(false);
    setStatus(isArmedRef.current?'🟢 Armed — monitoring...':'Ready');
  };

  const rotateClip = () => {
    if (cameraRef.current) { try { cameraRef.current.stopRecording(); } catch {} }
    setTimeout(()=>{
      if (cameraRef.current&&isRecordingRef.current) {
        const isForever=loopForeverRef.current;
        const clipDur=isForever?clipSizeRef.current:loopDurationRef.current;
        const opts={mute:false};
        if (clipDur>0) opts.maxDuration=clipDur;
        cameraRef.current.recordAsync(opts)
          .then(async(v)=>{ if(v?.uri) await saveClip(v.uri,false); })
          .catch(()=>{});
      }
    },400);
  };

  const saveClip = async (uri, triggered=false) => {
    try {
      const mode=camModeRef.current;
      const devName=(device?.name||'cam').replace(/\s+/g,'-');
      const ts=Date.now();
      const filename=`clip_${mode}_${device?.id||'unknown'}_${ts}.mp4`;
      const dest=FileSystem.documentDirectory+filename;
      await FileSystem.moveAsync({from:uri,to:dest});
      if (mediaPerm) {
        try {
          // Save to a dedicated album — no "where to save" prompt
          const asset = await MediaLibrary.createAssetAsync(dest);
          let album = await MediaLibrary.getAlbumAsync('Real Security Camera');
          if (!album) {
            await MediaLibrary.createAlbumAsync('Real Security Camera', asset, false);
          } else {
            await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
          }
        } catch(e) { console.log('MediaLibrary album error:', e.message); }
      }
      setClipCount(c=>c+1);
      if (!alertActiveRef.current) {
        setStatus('✅ Clip saved',14000);
      }
      if (cloudUpload&&(subscription==='pro'||subscription==='enterprise')) uploadClip(dest,filename);

      // Dashcam loop forever: rotate
      if (mode==='dashcam'&&loopForeverRef.current&&isRecordingRef.current) { rotateClip(); return; }
      // Dashcam non-forever: done
      if (mode==='dashcam'&&!loopForeverRef.current) {
        isRecordingRef.current=false; setIsRecording(false); stopTimer(); clearInterval(loopRef.current);
        setStatus('✅ Clip saved — tap record again',14000);
        return;
      }
      // Security: stop recording — cooldown releases NOW (clip fully saved)
      // Motion won't re-trigger until this point
      if (mode==='security') {
        isRecordingRef.current=false; setIsRecording(false); stopTimer();
        motionCoolRef.current=false;
        alertActiveRef.current=false;
        if (isArmedRef.current) setStatus('🟢 Armed — monitoring...');
      }
    } catch(e){ console.log('saveClip:',e.message); }
  };

  const uploadClip = async (uri,filename) => {
    try {
      const token=await AsyncStorage.getItem('accessToken');
      await FileSystem.uploadAsync(`${API_URL}/api/recordings/upload`,uri,{
        httpMethod:'POST',uploadType:FileSystem.FileSystemUploadType.MULTIPART,
        fieldName:'video',headers:{Authorization:'Bearer '+token},
        parameters:{device_id:device?.id,filename},
      });
    } catch(e){ console.log('upload:',e.message); }
  };

  if (!camPerm) return <View style={cs.container}><Text style={cs.permText}>Requesting permissions...</Text></View>;
  if (!camPerm.granted) return (
    <View style={cs.container}>
      <Text style={cs.permText}>Camera permission required.</Text>
      <TouchableOpacity style={cs.permBtn} onPress={requestCamPerm}><Text style={cs.permBtnTxt}>Grant Permission</Text></TouchableOpacity>
    </View>
  );

  const bannerVisible=isRecording||isArmed;
  const borderColor=alertAnim.interpolate({inputRange:[0,1],outputRange:['transparent','#ff4444']});
  const modeColor=camMode==='dashcam'?'#00ff88':'#4488ff';
  const modeLabel=camMode==='dashcam'?'🚗 Dash Cam':'🔒 Security Cam';
  const topPT=bannerVisible?(Platform.OS==='ios'?72:54):(Platform.OS==='ios'?50:30);
  const loopLabel=loopForever?`♾️ ${CLIP_SIZE_OPTIONS.find(o=>o.value===clipSize)?.label||'Loop'}`:(LOOP_OPTIONS.find(o=>o.value===loopDuration)?.label||'');

  return (
    <View style={cs.container}>
      <StatusBar barStyle="light-content" backgroundColor={isRecording?'#cc0000':isArmed?'#005522':'#000'}/>
      <RecordingBanner recording={isRecording} armed={isArmed} formatTime={formatTime} recordingTime={recordingTime} clipCount={clipCount}/>

      <Animated.View style={[cs.cameraContainer,{borderWidth:3,borderColor}]}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} enableTorch={torch} zoom={zoom} mode="video"/>
      </Animated.View>

      {/* PiP front camera for dash cam */}
      {camMode==='dashcam' && <PiPCamera visible={showPiP}/>}

      <NightVisionOverlay active={nightVision} premium={nightVisionPro}/>
      <View style={cs.clockWrapper} pointerEvents="none"><LiveClock/></View>
      <MotionPopup event={activePopup} onDismiss={()=>setActivePopup(null)}/>

      {/* Top bar */}
      <View style={[cs.topBar,{paddingTop:topPT}]}>
        <TouchableOpacity onPress={()=>{ stopAll(); navigation.goBack(); }} style={cs.backBtn}>
          <Text style={cs.backTxt}>← Back</Text>
        </TouchableOpacity>
        <View style={cs.topCenter}>
          <RecDot recording={isRecording}/>
          <Text style={cs.timerTxt}>{isRecording?formatTime(recordingTime):device?.name||'Camera'}</Text>
        </View>
        <TouchableOpacity style={cs.clipsBadge} onPress={()=>navigation.navigate('Clips')}>
          <Text style={cs.clipsBadgeIco}>📼</Text><Text style={cs.clipsBadgeCount}>{clipCount}</Text>
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
      {(isRecording||clipCount>0)&&(
        <View style={cs.dashInfo}>
          {loopLabel?<Text style={cs.dashInfoTxt}>{loopLabel}</Text>:null}
          <Text style={cs.dashInfoTxt}>📼 {clipCount} clip{clipCount!==1?'s':''}</Text>
          {isRecording&&<Text style={[cs.dashInfoTxt,{borderColor:'#ff4444',color:'#ff8888'}]}>● REC</Text>}
        </View>
      )}

      {/* Security arm controls */}
      {camMode==='security'&&(
        <View style={cs.securityControls}>
          <TouchableOpacity style={[cs.armBtn,isArmed&&cs.armBtnActive]} onPress={handleArmToggle}>
            <Text style={cs.armBtnIco}>{isArmed?'🔴':'🟢'}</Text>
            <Text style={cs.armBtnTxt}>{isArmed?'Stop Monitoring':'Start Monitoring'}</Text>
          </TouchableOpacity>
          {isArmed&&(
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

        {camMode==='dashcam'?(
          <TouchableOpacity style={[cs.recordBtn,isRecording&&cs.recordBtnActive]}
            onPress={()=>isRecording?stopRecording():setShowLoopPrompt(true)}>
            <View style={[cs.recordInner,isRecording&&cs.recordInnerActive]}/>
          </TouchableOpacity>
        ):(
          <View style={[cs.recordBtn,isArmed&&{borderColor:isRecording?'#ff4444':'#00ff88'}]}>
            <Text style={{fontSize:28}}>{isArmed?(isRecording?'🔴':'🟢'):'⚫'}</Text>
          </View>
        )}

        {camMode==='dashcam'?(
          <TouchableOpacity style={[cs.ctrlBtn,showPiP&&cs.ctrlBtnOn]} onPress={()=>setShowPiP(p=>!p)}>
            <Text style={cs.ctrlIco}>📷</Text><Text style={cs.ctrlTxt}>{showPiP?'PiP ON':'PiP'}</Text>
          </TouchableOpacity>
        ):(
          <TouchableOpacity style={[cs.ctrlBtn,nightVision&&cs.ctrlBtnNV]} onPress={()=>setNightVision(n=>!n)}>
            <Text style={cs.ctrlIco}>🌙</Text><Text style={cs.ctrlTxt}>{nightVision?(nightVisionPro?'NV PRO':'NV ON'):'Night'}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={cs.ctrlBtn} onPress={()=>setZoom(z=>z>=0.5?0:parseFloat((z+0.1).toFixed(1)))}>
          <Text style={cs.ctrlIco}>🔍</Text><Text style={cs.ctrlTxt}>{zoom>0?`${Math.round(zoom*10)}x`:'Zoom'}</Text>
        </TouchableOpacity>
      </View>

      {/* Loop prompt */}
      <Modal visible={showLoopPrompt} transparent animationType="fade" onRequestClose={()=>setShowLoopPrompt(false)}>
        <View style={cs.promptOverlay}><View style={cs.promptBox}>
          <Text style={cs.promptTitle}>{camMode==='dashcam'?'🚗 Dash Cam Mode':'🔒 Security Cam Mode'}</Text>
          <Text style={cs.promptSub}>How would you like to record?</Text>
          <TouchableOpacity style={cs.promptOption} onPress={()=>handleLoopChoice(true,0)}>
            <Text style={cs.promptOptionIco}>♾️</Text>
            <View style={{flex:1}}>
              <Text style={cs.promptOptionTitle}>Loop Forever</Text>
              <Text style={cs.promptOptionDesc}>Continuous recording — choose clip length</Text>
              {subscription==='free'&&<Text style={[cs.promptOptionDesc,{color:'#ffd700',marginTop:2}]}>⭐ Pro/Enterprise required</Text>}
            </View>
          </TouchableOpacity>
          {LOOP_OPTIONS.map(opt=>(
            <TouchableOpacity key={opt.value} style={cs.promptOption} onPress={()=>handleLoopChoice(false,opt.value)}>
              <Text style={cs.promptOptionIco}>⏱</Text>
              <View style={{flex:1}}>
                <Text style={cs.promptOptionTitle}>{opt.label}</Text>
                <Text style={cs.promptOptionDesc}>{camMode==='dashcam'?'Record one clip then stop':'Record when triggered up to this duration'}</Text>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={cs.promptCancel} onPress={()=>setShowLoopPrompt(false)}>
            <Text style={cs.promptCancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </View></View>
      </Modal>

      {/* Clip size prompt */}
      <Modal visible={showClipSize} transparent animationType="fade" onRequestClose={()=>setShowClipSize(false)}>
        <View style={cs.promptOverlay}><View style={cs.promptBox}>
          <Text style={cs.promptTitle}>♾️ Loop Forever</Text>
          <Text style={cs.promptSub}>Choose your clip length</Text>
          {CLIP_SIZE_OPTIONS.map(opt=>(
            <TouchableOpacity key={opt.value} style={cs.promptOption} onPress={()=>handleClipSizeChoice(opt.value)}>
              <Text style={cs.promptOptionIco}>🎬</Text>
              <View style={{flex:1}}>
                <Text style={cs.promptOptionTitle}>{opt.label}</Text>
                <Text style={cs.promptOptionDesc}>Each clip will be {opt.label.replace(' clips','')} long</Text>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={cs.promptCancel} onPress={()=>setShowClipSize(false)}>
            <Text style={cs.promptCancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </View></View>
      </Modal>

      {/* Settings */}
      <Modal visible={showSettings} transparent animationType="slide" onRequestClose={()=>setShowSettings(false)}>
        <View style={cs.modalOverlay}><ScrollView><View style={cs.modalContent}>
          <Text style={cs.modalTitle}>⚙️ Camera Settings</Text>
          <Text style={cs.settingSection}>🔒 Security Detection</Text>
          <View style={cs.settingRow}><Text style={cs.settingLabel}>Motion (Accelerometer)</Text><Switch value={motionEnabled} onValueChange={setMotionEnabled} trackColor={{true:'#00ff88'}} thumbColor="#fff"/></View>
          <View style={cs.settingRow}><Text style={cs.settingLabel}>Sound Detection</Text><Switch value={soundEnabled} onValueChange={setSoundEnabled} trackColor={{true:'#00ff88'}} thumbColor="#fff"/></View>
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
            <Switch value={nightVisionPro} onValueChange={(v)=>{ setNightVisionPro(v); if(v) setNightVision(true); }} trackColor={{true:'#ffd700'}} thumbColor="#fff"/>
          </View>
          <Text style={cs.settingSection}>☁️ Storage</Text>
          <View style={cs.settingRow}>
            <View>
              <Text style={cs.settingLabel}>Cloud Upload</Text>
              <Text style={cs.settingNote}>Pro/Enterprise only • {subscription==='free'?'Upgrade to enable':'Active'}</Text>
            </View>
            <Switch value={cloudUpload&&subscription!=='free'} onValueChange={(v)=>{
              if (v&&subscription==='free') { Alert.alert('⭐ Pro Feature','Cloud upload requires a Pro subscription.',
                [{text:'Not Now'},{text:'Upgrade',onPress:()=>{ setShowSettings(false); navigation.navigate('Subscription'); }}]); }
            }} trackColor={{true:'#00ff88'}} thumbColor="#fff"/>
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
            <Switch value={nightVisionPro} onValueChange={(v)=>{ setNightVisionPro(v); if(v) setNightVision(true); }} trackColor={{true:'#ffd700'}} thumbColor="#fff"/>
          </View>
          <Text style={cs.settingSection}>☁️ Storage</Text>
          <View style={cs.settingRow}>
            <View>
              <Text style={cs.settingLabel}>Cloud Upload</Text>
              <Text style={cs.settingNote}>Pro/Enterprise only • {subscription==='free'?'Upgrade to enable':'Active'}</Text>
            </View>
            <Switch value={cloudUpload&&subscription!=='free'} onValueChange={(v)=>{
              if (v&&subscription==='free') { Alert.alert('⭐ Pro Feature','Cloud upload requires a Pro subscription.',
                [{text:'Not Now'},{text:'Upgrade',onPress:()=>{ setShowSettings(false); navigation.navigate('Subscription'); }}]); }
              else setCloudUpload(v);
            }} trackColor={{true:'#00ff88'}} thumbColor="#fff"/>
          </View>
          <TouchableOpacity style={[cs.modalClose,{marginTop:16,backgroundColor:'#1a1a1a',borderWidth:1,borderColor:'#ffd700'}]}
            onPress={()=>{ setShowSettings(false); navigation.navigate('Subscription'); }}>
            <Text style={[cs.modalCloseTxt,{color:'#ffd700'}]}>⭐ Manage Subscription ({subscription})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[cs.modalClose,{backgroundColor:'#1a1a1a',borderWidth:1,borderColor:'#333'}]}
            onPress={()=>{ setShowSettings(false); navigation.navigate('Clips'); }}>
            <Text style={[cs.modalCloseTxt,{color:'#00ff88'}]}>📼 Manage Clips ({clipCount})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={cs.modalClose} onPress={()=>setShowSettings(false)}>
            <Text style={cs.modalCloseTxt}>Done</Text>
          </TouchableOpacity>
        </View></ScrollView></View>
      </Modal>
    </View>
  );
}

// ─── App Root ────────────────────────────────────────────────────
function App() {
  const [ready,  setReady]  = useState(false);
  const [token,  setToken]  = useState(null);
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);

  useEffect(()=>{
    AsyncStorage.getItem('accessToken').then(t=>{ setToken(t); setReady(true); });
  },[]);

  // Connect socket when token available
  useEffect(()=>{
    if (!token) { if(socketRef.current){socketRef.current.disconnect();socketRef.current=null;setSocket(null);} return; }
    const s = io(API_URL, { auth:{token}, transports:['websocket','polling'] });
    s.on('connect', async()=>{
      console.log('📡 Socket connected');
      // Decode token to get user info
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        s.emit('auth',{
          userId: payload.userId || payload.id,
          organizationId: payload.organizationId,
          role: 'viewer',
          deviceName: 'Mobile App',
        });
      } catch(e){ console.log('Token decode error:', e.message); }
    });
    s.on('camera:online',  ({deviceId,deviceName})=>{ console.log('📷 Camera online:', deviceName); });
    s.on('camera:offline', ({deviceId})=>{ console.log('📷 Camera offline:', deviceId); });
    s.on('disconnect', ()=>{ console.log('📡 Socket disconnected'); });
    socketRef.current = s;
    setSocket(s);
    return ()=>{ s.disconnect(); socketRef.current=null; };
  },[token]);

  const logout = async()=>{
    await AsyncStorage.removeItem('accessToken');
    setToken(null);
    setSocket(null);
  };
  if (!ready) return <View style={s.c}><Text style={s.appIcon}>🔒</Text><Text style={s.appName}>Real Security Camera</Text></View>;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{headerShown:false}}>
        {!token?(<>
          <Stack.Screen name="Login">{p=><LoginScreen {...p} setToken={setToken}/>}</Stack.Screen>
          <Stack.Screen name="Register">{p=><RegisterScreen {...p} setToken={setToken}/>}</Stack.Screen>
        </>):(<>
          <Stack.Screen name="Dashboard">{p=><DashboardScreen {...p} logout={logout} socket={socket}/>}</Stack.Screen>
          <Stack.Screen name="Camera">{p=><CameraScreen {...p} socket={socket}/>}</Stack.Screen>
          <Stack.Screen name="Clips" component={ClipsScreen}/>
          <Stack.Screen name="EventsLog" component={EventsLogScreen}/>
          <Stack.Screen name="Subscription" component={SubscriptionScreen}/>
        </>)}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ─── Dashboard Styles ────────────────────────────────────────────
const s = StyleSheet.create({
  c:                   {flex:1,backgroundColor:'#0a0a0a',justifyContent:'center',alignItems:'center',padding:24},
  container:           {flex:1,backgroundColor:'#0a0a0a'},
  appIcon:             {fontSize:56,marginBottom:8},
  appName:             {color:'#00ff88',fontSize:26,fontWeight:'bold',textAlign:'center',marginBottom:4},
  sub:                 {color:'#666',fontSize:14,marginBottom:32,textAlign:'center'},
  input:               {backgroundColor:'#1a1a1a',color:'#fff',padding:14,borderRadius:8,marginBottom:12,fontSize:16,borderWidth:1,borderColor:'#333',width:'100%'},
  btn:                 {backgroundColor:'#00ff88',padding:16,borderRadius:8,alignItems:'center',width:'100%',marginBottom:12},
  btxt:                {color:'#000',fontSize:16,fontWeight:'bold'},
  link:                {color:'#00ff88',textAlign:'center',marginTop:8},
  header:              {flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:16,paddingTop:50,backgroundColor:'#111'},
  headerTitle:         {color:'#00ff88',fontSize:18,fontWeight:'bold',flex:1},
  logoutBtn:           {paddingHorizontal:12,paddingVertical:6,borderWidth:1,borderColor:'#ff4444',borderRadius:6},
  logout:              {color:'#ff4444',fontSize:12,fontWeight:'bold'},
  subBtn:              {paddingHorizontal:10,paddingVertical:6,borderWidth:1,borderColor:'#ffd700',borderRadius:6},
  subBtnTxt:           {fontSize:14},
  stats:               {flexDirection:'row',justifyContent:'space-around',backgroundColor:'#111',marginHorizontal:16,marginTop:16,borderRadius:10,padding:12,marginBottom:4},
  stat:                {alignItems:'center'},
  statN:               {color:'#00ff88',fontSize:16,fontWeight:'bold'},
  statL:               {color:'#666',fontSize:11,marginTop:2},
  eventsDropdown:      {marginHorizontal:16,marginBottom:8,backgroundColor:'#1a0a0a',borderRadius:8,borderWidth:1,borderColor:'#ff444440',overflow:'hidden'},
  eventsDropdownHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:10,borderBottomWidth:1,borderBottomColor:'#ff444420'},
  eventsDropdownTitle: {color:'#ff8844',fontSize:12,fontWeight:'bold'},
  eventsDropdownAll:   {color:'#ff8844',fontSize:12},
  eventsDropdownEmpty: {color:'#666',fontSize:12,padding:10,textAlign:'center'},
  eventsDropdownItem:  {flexDirection:'row',alignItems:'center',padding:8,borderBottomWidth:1,borderBottomColor:'#1a1a1a',gap:8},
  eventsDropdownIco:   {fontSize:16},
  eventsDropdownDevice:{color:'#fff',fontSize:12,fontWeight:'600'},
  eventsDropdownTime:  {color:'#666',fontSize:11},
  card:                {flex:1,margin:6,marginBottom:2,backgroundColor:'#1a1a1a',borderRadius:12,padding:12,borderWidth:1,borderColor:'#222'},
  dot:                 {width:10,height:10,borderRadius:5},
  cardName:            {color:'#fff',fontSize:14,fontWeight:'bold',marginTop:4},
  cardLoc:             {color:'#666',fontSize:11,marginTop:2,marginBottom:2},
  cardHint:            {color:'#333',fontSize:9,marginBottom:4},
  clipCountRow:        {flexDirection:'row',gap:4,marginBottom:6},
  clipCountBadge:      {flex:1,paddingVertical:3,borderRadius:6,alignItems:'center',backgroundColor:'#00ff8810',borderWidth:1,borderColor:'#00ff8840'},
  clipCountTxt:        {color:'#00ff88',fontSize:10,fontWeight:'bold'},
  cardActions:         {flexDirection:'row',gap:6},
  cardActionBtn:       {flex:1,paddingVertical:8,borderRadius:8,alignItems:'center',borderWidth:1},
  cardActionIco:       {fontSize:16},
  cardActionTxt:       {fontSize:10,fontWeight:'bold',marginTop:2},
  deleteBtn:           {marginHorizontal:6,marginBottom:8,paddingVertical:5,backgroundColor:'#ff444415',borderRadius:6,alignItems:'center',borderWidth:1,borderColor:'#ff444430'},
  deleteBtnTxt:        {color:'#ff4444',fontSize:11,fontWeight:'600'},
  fab:                 {position:'absolute',bottom:30,right:20,width:60,height:60,borderRadius:30,backgroundColor:'#00ff88',justifyContent:'center',alignItems:'center'},
  modalBg:             {flex:1,backgroundColor:'rgba(0,0,0,0.7)',justifyContent:'center',alignItems:'center'},
  modalBox:            {backgroundColor:'#111',borderRadius:12,padding:24,width:'85%',borderWidth:1,borderColor:'#333'},
  modalTitle:          {color:'#00ff88',fontSize:20,fontWeight:'bold',marginBottom:8,textAlign:'center'},
  modalSub:            {color:'#666',fontSize:14,marginBottom:16,textAlign:'center'},
  modalBtns:           {flexDirection:'row',gap:12,marginTop:4},
  modalBtnCancel:      {flex:1,backgroundColor:'#1a1a1a',borderWidth:1,borderColor:'#666',paddingVertical:12,borderRadius:6,alignItems:'center'},
  modalBtnCancelTxt:   {color:'#fff',fontSize:14,fontWeight:'bold'},
  modalBtnPrimary:     {flex:1,backgroundColor:'#00ff88',paddingVertical:12,borderRadius:6,alignItems:'center'},
  modalBtnPrimaryTxt:  {color:'#000',fontSize:14,fontWeight:'bold'},
});

// ─── Camera Styles ───────────────────────────────────────────────
const cs = StyleSheet.create({
  container:          {flex:1,backgroundColor:'#000'},
  cameraContainer:    {...StyleSheet.absoluteFillObject},
  permText:           {color:'#fff',textAlign:'center',marginTop:100,fontSize:16},
  permBtn:            {marginTop:20,alignSelf:'center',backgroundColor:'#00ff88',padding:12,borderRadius:8},
  permBtnTxt:         {color:'#000',fontWeight:'bold'},
  pipContainer:       {position:'absolute',top:100,right:12,width:100,height:140,borderRadius:8,overflow:'hidden',borderWidth:2,borderColor:'#00ff88',zIndex:15},
  pipLabel:           {position:'absolute',bottom:4,left:0,right:0,textAlign:'center',color:'#fff',fontSize:9,fontWeight:'bold',backgroundColor:'rgba(0,0,0,0.5)'},
  recBanner:          {position:'absolute',top:0,left:0,right:0,zIndex:100,paddingTop:Platform.OS==='ios'?44:24,paddingBottom:8,paddingHorizontal:16,alignItems:'center'},
  recBannerTxt:       {color:'#fff',fontSize:12,fontWeight:'bold'},
  nvBright:           {...StyleSheet.absoluteFillObject,backgroundColor:'rgba(255,255,200,0.08)',zIndex:10},
  nvDark:             {...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,15,0,0.5)',zIndex:10},
  nvGreen:            {...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,255,70,0.22)',zIndex:11},
  nvVignette:         {...StyleSheet.absoluteFillObject,borderWidth:60,borderColor:'rgba(0,20,0,0.85)',borderRadius:1,zIndex:12},
  nvLabel:            {position:'absolute',top:90,right:8,backgroundColor:'rgba(0,30,0,0.85)',paddingHorizontal:8,paddingVertical:3,borderRadius:4,borderWidth:1,borderColor:'#00cc44',zIndex:13},
  nvLabelTxt:         {color:'#00ff88',fontSize:10,fontWeight:'bold'},
  motionPopup:        {position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:50,justifyContent:'center',alignItems:'center'},
  motionPopupInner:   {marginHorizontal:20,backgroundColor:'rgba(20,0,0,0.96)',borderRadius:14,padding:18,flexDirection:'row',alignItems:'center',gap:14,borderWidth:2,borderColor:'#ff4444',width:SW-40},
  motionPopupIco:     {fontSize:34},
  motionPopupTitle:   {color:'#fff',fontSize:16,fontWeight:'bold'},
  motionPopupMeta:    {color:'#aaa',fontSize:12,marginTop:2},
  motionPopupTime:    {color:'#666',fontSize:11,marginTop:1},
  motionPopupClose:   {padding:6},
  motionPopupCloseTxt:{color:'#666',fontSize:18,fontWeight:'bold'},
  clockWrapper:       {position:'absolute',bottom:100,right:8,zIndex:12},
  clockBox:           {backgroundColor:'rgba(0,0,0,0.5)',padding:5,borderRadius:5,borderWidth:1,borderColor:'rgba(255,255,255,0.1)'},
  clockTime:          {color:'rgba(255,255,255,0.85)',fontSize:14,fontWeight:'bold',fontVariant:['tabular-nums']},
  clockDate:          {color:'rgba(255,255,255,0.55)',fontSize:10},
  recDot:             {width:10,height:10,borderRadius:5,backgroundColor:'#444'},
  recDotActive:       {backgroundColor:'#ff4444'},
  topBar:             {position:'absolute',top:0,left:0,right:0,flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingBottom:12,backgroundColor:'rgba(0,0,0,0.55)',zIndex:20},
  backBtn:            {paddingHorizontal:8,paddingVertical:4},
  backTxt:            {color:'#00ff88',fontSize:15,fontWeight:'600'},
  topCenter:          {flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  timerTxt:           {color:'#fff',fontSize:15,fontWeight:'bold'},
  clipsBadge:         {flexDirection:'row',alignItems:'center',gap:3,backgroundColor:'rgba(255,255,255,0.1)',paddingHorizontal:8,paddingVertical:4,borderRadius:12,marginRight:4},
  clipsBadgeIco:      {fontSize:14},
  clipsBadgeCount:    {color:'#fff',fontSize:13,fontWeight:'bold'},
  settingsBtn:        {paddingHorizontal:8},
  modeBadgeRow:       {position:'absolute',left:0,right:0,alignItems:'center',zIndex:20},
  modeBadge:          {paddingHorizontal:16,paddingVertical:5,borderRadius:20,borderWidth:1.5,backgroundColor:'rgba(0,0,0,0.6)'},
  modeBadgeTxt:       {fontSize:13,fontWeight:'bold'},
  statusBar:          {position:'absolute',left:16,right:16,alignItems:'center',zIndex:20},
  statusTxt:          {color:'#fff',fontSize:13,fontWeight:'600',backgroundColor:'rgba(0,0,0,0.6)',paddingHorizontal:12,paddingVertical:4,borderRadius:12,overflow:'hidden'},
  dashInfo:           {position:'absolute',bottom:220,left:16,right:16,flexDirection:'row',justifyContent:'center',gap:8,flexWrap:'wrap',zIndex:20},
  dashInfoTxt:        {color:'rgba(255,255,255,0.9)',fontSize:11,backgroundColor:'rgba(0,0,0,0.6)',paddingHorizontal:8,paddingVertical:3,borderRadius:8,overflow:'hidden',borderWidth:1,borderColor:'rgba(255,255,255,0.15)'},
  securityControls:   {position:'absolute',bottom:115,left:16,right:16,gap:10,zIndex:20},
  armBtn:             {flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:'rgba(0,255,136,0.15)',borderRadius:14,paddingVertical:14,borderWidth:2,borderColor:'#00ff88'},
  armBtnActive:       {backgroundColor:'rgba(255,68,68,0.15)',borderColor:'#ff4444'},
  armBtnIco:          {fontSize:22},
  armBtnTxt:          {color:'#fff',fontSize:16,fontWeight:'bold'},
  manualRecBtn:       {flexDirection:'row',alignItems:'center',justifyContent:'center',backgroundColor:'rgba(0,0,0,0.6)',borderRadius:10,paddingVertical:10,borderWidth:1,borderColor:'rgba(255,255,255,0.2)'},
  manualRecBtnActive: {borderColor:'#ff4444'},
  manualRecTxt:       {color:'#fff',fontSize:13,fontWeight:'600'},
  controls:           {position:'absolute',bottom:0,left:0,right:0,flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingBottom:Platform.OS==='ios'?34:16,paddingTop:14,backgroundColor:'rgba(0,0,0,0.75)',paddingHorizontal:8,zIndex:20},
  ctrlBtn:            {alignItems:'center',padding:8,borderRadius:10,minWidth:52},
  ctrlBtnOn:          {backgroundColor:'rgba(255,200,0,0.2)'},
  ctrlBtnNV:          {backgroundColor:'rgba(0,255,100,0.15)'},
  ctrlIco:            {fontSize:22},
  ctrlTxt:            {color:'rgba(255,255,255,0.7)',fontSize:9,marginTop:3,fontWeight:'600'},
  recordBtn:          {width:68,height:68,borderRadius:34,borderWidth:4,borderColor:'#555',alignItems:'center',justifyContent:'center'},
  recordBtnActive:    {borderColor:'#ff4444'},
  recordInner:        {width:48,height:48,borderRadius:24,backgroundColor:'#ff4444'},
  recordInnerActive:  {width:22,height:22,borderRadius:4,backgroundColor:'#ff4444'},
  promptOverlay:      {flex:1,backgroundColor:'rgba(0,0,0,0.9)',justifyContent:'center',alignItems:'center',padding:20},
  promptBox:          {backgroundColor:'#111',borderRadius:16,padding:24,width:'100%',borderWidth:1,borderColor:'#333'},
  promptTitle:        {color:'#00ff88',fontSize:22,fontWeight:'bold',textAlign:'center',marginBottom:6},
  promptSub:          {color:'#666',fontSize:14,textAlign:'center',marginBottom:20},
  promptOption:       {flexDirection:'row',alignItems:'center',gap:14,backgroundColor:'#1a1a1a',borderRadius:10,padding:14,marginBottom:10,borderWidth:1,borderColor:'#333'},
  promptOptionIco:    {fontSize:26},
  promptOptionTitle:  {color:'#fff',fontSize:15,fontWeight:'bold'},
  promptOptionDesc:   {color:'#666',fontSize:12,marginTop:2},
  promptCancel:       {marginTop:8,alignItems:'center',padding:12},
  promptCancelTxt:    {color:'#666',fontSize:14},
  modalOverlay:       {flex:1,backgroundColor:'rgba(0,0,0,0.88)',justifyContent:'flex-end'},
  modalContent:       {backgroundColor:'#111',borderTopLeftRadius:20,borderTopRightRadius:20,padding:24,borderWidth:1,borderColor:'#222',paddingBottom:40},
  modalTitle:         {color:'#00ff88',fontSize:18,fontWeight:'bold',marginBottom:20,textAlign:'center'},
  settingSection:     {color:'#666',fontSize:11,fontWeight:'bold',textTransform:'uppercase',letterSpacing:1,marginTop:16,marginBottom:8},
  settingRow:         {flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:8,borderBottomWidth:1,borderBottomColor:'#222'},
  settingLabel:       {color:'#fff',fontSize:14},
  settingNote:        {color:'#666',fontSize:11,marginTop:2},
  premiumBadge:       {backgroundColor:'#ffd70020',paddingHorizontal:6,paddingVertical:2,borderRadius:4,borderWidth:1,borderColor:'#ffd700'},
  premiumTxt:         {color:'#ffd700',fontSize:9,fontWeight:'bold'},
  modalClose:         {marginTop:10,backgroundColor:'#00ff88',borderRadius:10,padding:14,alignItems:'center'},
  modalCloseTxt:      {color:'#000',fontSize:16,fontWeight:'bold'},
});

// ─── Clips + Events Styles ────────────────────────────────────────
const cl = StyleSheet.create({
  container:    {flex:1,backgroundColor:'#0a0a0a'},
  header:       {flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:16,paddingTop:50,backgroundColor:'#111'},
  backBtn:      {paddingRight:12},
  backTxt:      {color:'#00ff88',fontSize:15,fontWeight:'600'},
  title:        {color:'#fff',fontSize:18,fontWeight:'bold',flex:1,textAlign:'center'},
  galleryBtn:   {paddingLeft:12},
  galleryTxt:   {color:'#00ff88',fontSize:14,fontWeight:'600'},
  summary:      {flexDirection:'row',alignItems:'center',justifyContent:'space-around',backgroundColor:'#111',marginHorizontal:16,marginTop:16,borderRadius:10,padding:12,marginBottom:8,flexWrap:'wrap'},
  summaryItem:  {alignItems:'center',margin:4},
  summaryN:     {color:'#00ff88',fontSize:18,fontWeight:'bold'},
  summaryL:     {color:'#666',fontSize:11,marginTop:2},
  deleteAllBtn: {backgroundColor:'#ff444420',paddingHorizontal:12,paddingVertical:6,borderRadius:8,borderWidth:1,borderColor:'#ff444460'},
  deleteAllTxt: {color:'#ff4444',fontSize:12,fontWeight:'bold'},
  sectionHeader:{color:'#666',fontSize:12,fontWeight:'bold',textTransform:'uppercase',letterSpacing:1,marginTop:16,marginBottom:8},
  empty:        {flex:1,alignItems:'center',justifyContent:'center',marginTop:60},
  emptyTxt:     {color:'#fff',fontSize:18,marginTop:16},
  emptySub:     {color:'#666',fontSize:13,marginTop:8},
  clipCard:     {flexDirection:'row',alignItems:'center',backgroundColor:'#1a1a1a',borderRadius:10,padding:12,marginBottom:8,borderWidth:1,borderColor:'#222'},
  clipIcon:     {alignItems:'center',marginRight:12},
  clipNum:      {color:'#666',fontSize:10,marginTop:2},
  clipInfo:     {flex:1},
  clipDevice:   {color:'#00ff88',fontSize:12,fontWeight:'bold'},
  clipName:     {color:'#fff',fontSize:13,fontWeight:'600',marginTop:1},
  clipMeta:     {color:'#666',fontSize:11,marginTop:3},
  clipDelete:   {padding:8},
  eventCard:    {flexDirection:'row',alignItems:'center',backgroundColor:'#1a1a1a',borderRadius:10,padding:12,marginBottom:8,borderWidth:1,borderColor:'#333'},
  eventIco:     {fontSize:26,marginRight:12},
  eventTitle:   {color:'#fff',fontSize:14,fontWeight:'bold'},
  eventDevice:  {color:'#00ff88',fontSize:12,marginTop:2},
  eventTime:    {color:'#666',fontSize:11,marginTop:2},
  eventTap:     {color:'#444',fontSize:10,marginTop:2},
  eventMode:    {paddingHorizontal:8,paddingVertical:4,borderRadius:6,borderWidth:1,marginLeft:8},
});

// ─── Subscription Styles ──────────────────────────────────────────
const sub = StyleSheet.create({
  container:      {flex:1,backgroundColor:'#0a0a0a'},
  header:         {flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:16,paddingTop:50,backgroundColor:'#111'},
  backBtn:        {paddingRight:12},
  backTxt:        {color:'#00ff88',fontSize:15,fontWeight:'600'},
  title:          {color:'#fff',fontSize:18,fontWeight:'bold',flex:1,textAlign:'center'},
  tagline:        {color:'#666',fontSize:14,textAlign:'center',marginBottom:20,marginTop:8},
  tierCard:       {backgroundColor:'#1a1a1a',borderRadius:12,padding:16,marginBottom:16,borderWidth:1,borderColor:'#333'},
  tierHeader:     {flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12},
  tierName:       {fontSize:20,fontWeight:'bold'},
  tierPrice:      {color:'#fff',fontSize:14,marginTop:2},
  currentBadge:   {paddingHorizontal:10,paddingVertical:4,borderRadius:6,borderWidth:1},
  currentBadgeTxt:{fontSize:11,fontWeight:'bold'},
  feature:        {color:'rgba(255,255,255,0.8)',fontSize:13,marginBottom:4},
  subBtn:         {marginTop:14,padding:14,borderRadius:8,alignItems:'center'},
  subBtnTxt:      {color:'#000',fontSize:15,fontWeight:'bold'},
  note:           {color:'#555',fontSize:12,textAlign:'center',marginTop:8,lineHeight:18},
});

export default App;
