import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

const API_URL = 'https://whale-app-hxokg.ondigitalocean.app';
const api = axios.create({ baseURL: API_URL, timeout: 10000 });
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

const Stack = createNativeStackNavigator();

function LoginScreen({ navigation, setToken }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email || !password) return Alert.alert('Error', 'Enter email and password');
    setLoading(true);
    try {
      console.log('Attempting login with:', email);
      const res = await api.post('/api/auth/login', { email, password });
      console.log('Login response:', res.data);
      
      const token = res.data.data.accessToken;
      if (!token) {
        return Alert.alert('Error', 'No token received from server');
      }
      
      await AsyncStorage.setItem('accessToken', token);
      await setToken(token);
    } catch (e) {
      console.log('Login error:', e.response?.data || e.message);
      Alert.alert('Login Failed', e.response?.data?.message || e.response?.data?.errors?.[0]?.message || 'Check credentials');
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

function RegisterScreen({ navigation, setToken }) {
  const [form, setForm] = useState({ 
    email: '', 
    password: '', 
    first_name: '', 
    last_name: '', 
    org_name: '' 
  });
  const [loading, setLoading] = useState(false);

  const register = async () => {
    if (!form.email || !form.password || !form.first_name || !form.last_name || !form.org_name) {
      return Alert.alert('Error', 'Fill all fields');
    }
    setLoading(true);
    try {
      const res = await api.post('/api/auth/register', {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        password: form.password,
        org_name: form.org_name
      });
      
      console.log('Registration response:', res.data);
      
      await AsyncStorage.setItem('accessToken', res.data.data.accessToken);
      await setToken(res.data.data.accessToken);
    } catch (e) {
      console.log('Registration error:', e.response?.data);
      Alert.alert('Failed', e.response?.data?.message || 'Try again');
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={s.c} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={s.title}>🔒 Real Security Camera</Text>
      <Text style={s.sub}>Create Account</Text>
      {['first_name','last_name','email','org_name'].map(f => (
        <TextInput 
          key={f} 
          style={s.input} 
          placeholder={f.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} 
          placeholderTextColor="#666" 
          value={form[f]} 
          onChangeText={v=>setForm(p=>({...p,[f]:v}))} 
          autoCapitalize={f==='email'?'none':'words'} 
          editable={!loading} 
        />
      ))}
      <TextInput 
        style={s.input} 
        placeholder="Password" 
        placeholderTextColor="#666" 
        value={form.password} 
        onChangeText={v=>setForm(p=>({...p,password:v}))} 
        secureTextEntry 
        editable={!loading} 
      />
      <TouchableOpacity style={s.btn} onPress={register} disabled={loading}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btxt}>Create Account</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
        <Text style={s.link}>Already have an account? Login</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

function DashboardScreen({ navigation, route, logout }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('viewer');
  const user = route.params?.user;

  useEffect(() => { loadDevices(); }, []);

  const loadDevices = async () => {
    try {
      const res = await api.get('/api/devices');
      setDevices(res.data.data || []);
    } catch (e) { console.log('Error:', e.message); }
    setLoading(false);
  };

  const addDevice = () => {
    Alert.prompt('Add Camera', 'Device name:', async (name) => {
      if (!name) return;
      Alert.prompt('Location', 'Location:', async (loc) => {
        try {
          await api.post('/api/devices', { device_name: name, location: loc || 'Unknown', device_type: 'camera' });
          loadDevices();
        } catch (e) { Alert.alert('Error', 'Failed to add device'); }
      });
    });
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
        ListEmptyComponent={<View style={{alignItems:'center',marginTop:60}}><Text style={{fontSize:48}}>📷</Text><Text style={{color:'#fff',fontSize:18,marginTop:16}}>No cameras yet</Text><Text style={{color:'#666',marginTop:8}}>Tap + to add one</Text></View>}
        renderItem={({item}) => (
          <TouchableOpacity style={s.card} onPress={() => navigation.navigate('Camera', { device: item, mode })}>
            <Text style={{fontSize:32}}>📷</Text>
            <View style={[s.dot,{backgroundColor:item.is_active?'#00ff88':'#666'}]} />
            <Text style={s.cardName}>{item.device_name}</Text>
            <Text style={s.cardLoc}>📍 {item.location||'No location'}</Text>
            <View style={s.cardBtn}>
              <Text style={s.cardBtnTxt}>{mode==='camera'?'Use as Camera':'View Stream'}</Text>
            </View>
          </TouchableOpacity>
        )}
      />}
      <TouchableOpacity style={s.fab} onPress={addDevice}>
        <Text style={{color:'#000',fontSize:32,fontWeight:'bold'}}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function CameraScreen({ navigation, route }) {
  const { device, mode } = route.params || {};
  const [torch, setTorch] = useState(false);
  const [motionCount, setMotionCount] = useState(0);
  const [status, setStatus] = useState('Monitoring...');
  const [recording, setRecording] = useState(false);

  const testMotion = async () => {
    setStatus('⚠️ Motion detected!');
    setMotionCount(c => c + 1);
    setRecording(true);
    try {
      await api.post('/api/motion/detect', { device_id: device?.id, confidence: 85 });
    } catch (e) { console.log('Motion error:', e.message); }
    setTimeout(() => { setRecording(false); setStatus('Monitoring...'); }, 30000);
  };

  return (
    <View style={s.container}>
      <View style={s.camHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{color:'#00ff88',fontSize:16}}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.camTitle}>{device?.device_name || 'Camera'}</Text>
        <View style={[s.recDot, recording && s.recDotOn]} />
      </View>
      <View style={s.camBody}>
        <Text style={{fontSize:80}}>📷</Text>
        <Text style={{color:'#00ff88',fontSize:18,marginTop:16}}>{status}</Text>
        <Text style={{color:'#666',marginTop:8}}>Motion events: {motionCount}</Text>
        <Text style={{color:'#444',marginTop:4,fontSize:12}}>{device?.location || ''}</Text>
      </View>
      <View style={s.camControls}>
        <TouchableOpacity style={[s.ctrlBtn, torch && s.ctrlBtnOn]} onPress={() => setTorch(!torch)}>
          <Text style={{fontSize:24}}>{torch ? '🔦' : '💡'}</Text>
          <Text style={s.ctrlTxt}>{torch ? 'Torch ON' : 'Torch OFF'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.ctrlBtn} onPress={testMotion}>
          <Text style={{fontSize:24}}>⚡</Text>
          <Text style={s.ctrlTxt}>Test Motion</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.ctrlBtn}>
          <Text style={{fontSize:24}}>🌙</Text>
          <Text style={s.ctrlTxt}>Night Auto</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem('accessToken').then(t => { 
      setToken(t); 
      setReady(true); 
    });
  }, []);

  const logout = async () => {
    await AsyncStorage.removeItem('accessToken');
    setToken(null);
  };

  const setAuthToken = async (newToken) => {
    setToken(newToken);
  };

  if (!ready) return <View style={s.c}><Text style={s.title}>🔒 Real Security Camera</Text></View>;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <>
            <Stack.Screen name="Login">
              {(props) => <LoginScreen {...props} setToken={setAuthToken} />}
            </Stack.Screen>
            <Stack.Screen name="Register">
              {(props) => <RegisterScreen {...props} setToken={setAuthToken} />}
            </Stack.Screen>
          </>
        ) : (
          <>
            <Stack.Screen name="Dashboard">
              {(props) => <DashboardScreen {...props} logout={logout} />}
            </Stack.Screen>
            <Stack.Screen name="Camera" component={CameraScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const s = StyleSheet.create({
  c: { flex:1, backgroundColor:'#0a0a0a', justifyContent:'center', alignItems:'center', padding:24 },
  container: { flex:1, backgroundColor:'#0a0a0a' },
  title: { color:'#00ff88', fontSize:28, fontWeight:'bold', textAlign:'center' },
  sub: { color:'#666', fontSize:14, marginBottom:32, textAlign:'center' },
  input: { backgroundColor:'#1a1a1a', color:'#fff', padding:14, borderRadius:8, marginBottom:12, fontSize:16, borderWidth:1, borderColor:'#333', width:'100%' },
  btn: { backgroundColor:'#00ff88', padding:16, borderRadius:8, alignItems:'center', width:'100%', marginBottom:12 },
  btxt: { color:'#000', fontSize:16, fontWeight:'bold' },
  link: { color:'#00ff88', textAlign:'center', marginTop:8 },
  header: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:20, paddingTop:50, backgroundColor:'#111' },
  logout: { color:'#ff4444' },
  modeRow: { flexDirection:'row', margin:16, backgroundColor:'#1a1a1a', borderRadius:10, padding:4 },
  modeBtn: { flex:1, padding:10, borderRadius:8, alignItems:'center' },
  modeBtnOn: { backgroundColor:'#00ff88' },
  modeTxt: { color:'#666', fontWeight:'600' },
  modeTxtOn: { color:'#000' },
  stats: { flexDirection:'row', justifyContent:'space-around', backgroundColor:'#111', marginHorizontal:16, borderRadius:10, padding:16, marginBottom:16 },
  stat: { alignItems:'center' },
  statN: { color:'#00ff88', fontSize:24, fontWeight:'bold' },
  statL: { color:'#666', fontSize:11 },
  card: { flex:1, margin:6, backgroundColor:'#1a1a1a', borderRadius:12, padding:16, borderWidth:1, borderColor:'#222' },
  dot: { width:10, height:10, borderRadius:5, position:'absolute', top:16, right:16 },
  cardName: { color:'#fff', fontSize:14, fontWeight:'bold', marginTop:8 },
  cardLoc: { color:'#666', fontSize:11, marginTop:4 },
  cardBtn: { backgroundColor:'#00ff8820', padding:8, borderRadius:6, alignItems:'center', marginTop:8, borderWidth:1, borderColor:'#00ff8840' },
  cardBtnTxt: { color:'#00ff88', fontSize:11, fontWeight:'600' },
  fab: { position:'absolute', bottom:30, right:20, width:60, height:60, borderRadius:30, backgroundColor:'#00ff88', justifyContent:'center', alignItems:'center' },
  camHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:20, paddingTop:50, backgroundColor:'#111' },
  camTitle: { color:'#fff', fontSize:16, fontWeight:'bold' },
  recDot: { width:12, height:12, borderRadius:6, backgroundColor:'#666' },
  recDotOn: { backgroundColor:'#ff0000' },
  camBody: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#000' },
  camControls: { flexDirection:'row', justifyContent:'space-around', padding:20, backgroundColor:'#111' },
  ctrlBtn: { alignItems:'center', backgroundColor:'#1a1a1a', padding:12, borderRadius:8, minWidth:80 },
  ctrlBtnOn: { backgroundColor:'rgba(0,255,136,0.2)', borderWidth:1, borderColor:'#00ff88' },
  ctrlTxt: { color:'#fff', fontSize:10, marginTop:4 },
});

export default App;