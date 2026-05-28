import { jwtDecode } from 'jwt-decode';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Modal } from 'react-native';
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
      if (!token) return Alert.alert('Error', 'No token received');
      await AsyncStorage.setItem('accessToken', token);
      await setToken(token);
    } catch (e) {
      console.log('Login error:', e.response?.data || e.message);
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

function RegisterScreen({ navigation, setToken }) {
  const [form, setForm] = useState({ email: '', password: '', first_name: '', last_name: '', org_name: '' });
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

function DashboardScreen({ navigation, route, logout }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('viewer');
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [deviceLocation, setDeviceLocation] = useState('');
  const [step, setStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => { loadDevices(); }, []);

  const loadDevices = async () => {
    try {
      console.log('Loading devices...');
      const res = await api.get('/api/devices');
      console.log('Devices response:', res.data);
      setDevices(res.data.data || []);
      setError(null);
    } catch (e) {
      console.log('Devices error:', e.response?.data || e.message);
      setError(e.response?.data?.message || 'Failed to load devices');
      setDevices([]);
    }
    setLoading(false);
  };

  const openAddModal = () => {
    setDeviceName('');
    setDeviceLocation('');
    setStep(1);
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setDeviceName('');
    setDeviceLocation('');
    setStep(1);
  };

  const handleNextStep = () => {
    if (step === 1) {
      if (!deviceName.trim()) {
        Alert.alert('Error', 'Please enter a device name');
        return;
      }
      setStep(2);
    }
  };

  const handleAddDevice = async () => {
  if (!deviceLocation.trim()) {
    Alert.alert('Error', 'Please enter a location');
    return;
  }

  setIsCreating(true);
  try {
    const token = await AsyncStorage.getItem('accessToken');
    if (!token) {
      Alert.alert('Error', 'No token found. Please login again.');
      setIsCreating(false);
      return;
    }

    const decoded = jwtDecode(token);
    
    // Debug: Log the full token to see all fields
    console.log('FULL TOKEN:', JSON.stringify(decoded, null, 2));
    console.log('TOKEN KEYS:', Object.keys(decoded));
    
    const userId = decoded.userId;
    const organizationId = decoded.organizationId || decoded.org_id || decoded.organization_id || decoded.orgId;

    if (!userId) {
      Alert.alert('Error', 'Cannot extract user ID from token.');
      setIsCreating(false);
      return;
    }

    if (!organizationId) {
      Alert.alert('Error', 'Cannot extract organization ID from token.\nToken has: ' + Object.keys(decoded).join(', '));
      setIsCreating(false);
      return;
    }

    console.log('Creating device with userId:', userId);
    console.log('Organization ID:', organizationId);
    console.log('Device data:', { name: deviceName, location: deviceLocation, userId, organizationId });

    const res = await api.post('/api/devices', {
      name: deviceName,
      location: deviceLocation,
      rtsp_url: '',
      userId: userId,
      organizationId: organizationId
    });
    
    console.log('Device created:', res.data);
    Alert.alert('Success', 'Camera added!');
    closeAddModal();
    loadDevices();
  } catch (e) {
    console.error('Add device error:', e.response?.data || e.message);
    Alert.alert('Error', e.response?.data?.message || 'Failed to add device');
  }
  setIsCreating(false);
};

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🔒 Real Security Camera</Text>
        <TouchableOpacity style={s.logoutBtn} onPress={logout}>
          <Text style={s.logout}>Logout</Text>
        </TouchableOpacity>
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
      {error && <View style={{backgroundColor:'#ff444440', padding:12, margin:16, borderRadius:8, borderWidth:1, borderColor:'#ff4444'}}><Text style={{color:'#ff4444', fontSize:14}}>⚠️ {error}</Text></View>}
      {loading ? <ActivityIndicator color="#00ff88" style={{marginTop:40}} /> : <FlatList data={devices} keyExtractor={i=>i.id} numColumns={2} contentContainerStyle={{padding:8}} refreshing={loading} onRefresh={loadDevices} ListEmptyComponent={<View style={{alignItems:'center',marginTop:60}}><Text style={{fontSize:48}}>📷</Text><Text style={{color:'#fff',fontSize:18,marginTop:16}}>No cameras yet</Text><Text style={{color:'#666',marginTop:8}}>Tap + to add one</Text></View>} renderItem={({item}) => (<TouchableOpacity style={s.card} onPress={() => navigation.navigate('Camera', { device: item, mode })}><Text style={{fontSize:32}}>📷</Text><View style={[s.dot,{backgroundColor:item.is_active?'#00ff88':'#666'}]} /><Text style={s.cardName}>{item.name}</Text><Text style={s.cardLoc}>📍 {item.location||'No location'}</Text><View style={s.cardBtn}><Text style={s.cardBtnTxt}>{mode==='camera'?'Use as Camera':'View Stream'}</Text></View></TouchableOpacity>)} />}
      <TouchableOpacity style={s.fab} onPress={openAddModal}>
        <Text style={{color:'#000',fontSize:32,fontWeight:'bold'}}>+</Text>
      </TouchableOpacity>

      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={closeAddModal}>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            {step === 1 ? (
              <>
                <Text style={s.modalTitle}>Add Camera</Text>
                <Text style={s.modalSubtitle}>Enter device name</Text>
                <TextInput
                  style={s.modalInput}
                  placeholder="Device Name"
                  placeholderTextColor="#666"
                  value={deviceName}
                  onChangeText={setDeviceName}
                  editable={!isCreating}
                />
                <View style={s.modalButtonRow}>
                  <TouchableOpacity style={[s.modalBtn, s.modalBtnCancel]} onPress={closeAddModal} disabled={isCreating}>
                    <Text style={s.modalBtnTxt}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.modalBtn, s.modalBtnPrimary]} onPress={handleNextStep} disabled={isCreating}>
                    <Text style={s.modalBtnTxt}>Next</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={s.modalTitle}>Enter Location</Text>
                <Text style={s.modalSubtitle}>Where is this camera located?</Text>
                <TextInput
                  style={s.modalInput}
                  placeholder="Location"
                  placeholderTextColor="#666"
                  value={deviceLocation}
                  onChangeText={setDeviceLocation}
                  editable={!isCreating}
                />
                <View style={s.modalButtonRow}>
                  <TouchableOpacity style={[s.modalBtn, s.modalBtnCancel]} onPress={() => setStep(1)} disabled={isCreating}>
                    <Text style={s.modalBtnTxt}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.modalBtn, s.modalBtnPrimary]} onPress={handleAddDevice} disabled={isCreating}>
                    {isCreating ? <ActivityIndicator color="#000" /> : <Text style={s.modalBtnTxt}>Add Device</Text>}
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
        <Text style={s.camTitle}>{device?.name || 'Camera'}</Text>
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
    AsyncStorage.getItem('accessToken').then(t => { setToken(t); setReady(true); });
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
  c: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#000' },
  header: { backgroundColor: '#111', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#00ff88', fontSize: 22, fontWeight: 'bold', flex: 1 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#1a1a1a', borderRadius: 4, borderWidth: 1, borderColor: '#ff4444' },
  logout: { color: '#ff4444', fontSize: 12, fontWeight: 'bold' },
  sub: { color: '#666', fontSize: 14, marginBottom: 24, textAlign: 'center' },
  input: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 6, color: '#fff', padding: 12, marginBottom: 12, fontSize: 14 },
  btn: { backgroundColor: '#00ff88', borderRadius: 6, padding: 14, alignItems: 'center', marginBottom: 16 },
  btxt: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  link: { color: '#00ff88', fontSize: 14, textAlign: 'center' },
  modeRow: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 12, gap: 8 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 6, borderWidth: 1, borderColor: '#333', alignItems: 'center' },
  modeBtnOn: { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  modeTxt: { color: '#666', fontSize: 12, fontWeight: 'bold' },
  modeTxtOn: { color: '#000' },
  stats: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 12, gap: 8 },
  stat: { flex: 1, backgroundColor: '#111', borderRadius: 6, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  statN: { color: '#00ff88', fontSize: 20, fontWeight: 'bold' },
  statL: { color: '#666', fontSize: 11, marginTop: 4 },
  card: { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 12, margin: 4, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
  cardName: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 8 },
  cardLoc: { color: '#666', fontSize: 11, marginTop: 4 },
  cardBtn: { backgroundColor: '#00ff88', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, marginTop: 8 },
  cardBtnTxt: { color: '#000', fontSize: 10, fontWeight: 'bold' },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#00ff88', justifyContent: 'center', alignItems: 'center', shadowColor: '#00ff88', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5 },
  camHeader: { backgroundColor: '#111', paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333' },
  camTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', flex: 1, textAlign: 'center' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#333' },
  recDotOn: { backgroundColor: '#ff4444' },
  camBody: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  camControls: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#333' },
  ctrlBtn: { flex: 1, backgroundColor: '#111', borderRadius: 6, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  ctrlBtnOn: { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  ctrlTxt: { color: '#666', fontSize: 11, marginTop: 4, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#111', borderRadius: 12, padding: 24, width: '85%', borderWidth: 1, borderColor: '#333' },
  modalTitle: { color: '#00ff88', fontSize: 20, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  modalSubtitle: { color: '#666', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  modalInput: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 6, color: '#fff', padding: 12, marginBottom: 20, fontSize: 14 },
  modalButtonRow: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 6, alignItems: 'center' },
  modalBtnCancel: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#666' },
  modalBtnPrimary: { backgroundColor: '#00ff88' },
  modalBtnTxt: { color: '#000', fontSize: 14, fontWeight: 'bold' },
});
export default App;