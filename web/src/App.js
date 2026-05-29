import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';

const API = 'https://whale-app-hxokg.ondigitalocean.app';
const api = axios.create({ baseURL: API, timeout: 10000 });
api.interceptors.request.use(cfg => {
  const t = localStorage.getItem('accessToken');
  if (t) cfg.headers.Authorization = 'Bearer ' + t;
  return cfg;
});

// ─── Helpers ─────────────────────────────────────────────────────
const formatTime = (d) => new Date(d).toLocaleTimeString();
const formatDate = (d) => new Date(d).toLocaleString('en-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});

// ─── styles (inline for single-file) ─────────────────────────────
const C = {
  bg:      '#0a0a0a',
  surface: '#111',
  card:    '#1a1a1a',
  green:   '#00ff88',
  blue:    '#4488ff',
  red:     '#ff4444',
  gold:    '#ffd700',
  text:    '#ffffff',
  sub:     '#666666',
  border:  '#222222',
};

const st = {
  app:        { minHeight:'100vh', backgroundColor:C.bg, color:C.text, fontFamily:'system-ui,sans-serif' },
  nav:        { backgroundColor:C.surface, padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, zIndex:100 },
  navTitle:   { color:C.green, fontSize:20, fontWeight:'bold', margin:0 },
  navRight:   { display:'flex', alignItems:'center', gap:12 },
  btn:        { padding:'8px 16px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:'bold', fontSize:13 },
  btnGreen:   { backgroundColor:C.green, color:'#000' },
  btnRed:     { backgroundColor:C.red, color:'#fff' },
  btnGray:    { backgroundColor:C.card, color:C.text, border:`1px solid ${C.border}` },
  btnGold:    { backgroundColor:'transparent', color:C.gold, border:`1px solid ${C.gold}` },
  main:       { padding:24, maxWidth:1400, margin:'0 auto' },
  grid2:      { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 },
  grid3:      { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))', gap:16 },
  card:       { backgroundColor:C.card, borderRadius:12, padding:16, border:`1px solid ${C.border}` },
  cardTitle:  { fontSize:14, fontWeight:'bold', marginBottom:8, color:C.text },
  statRow:    { display:'flex', gap:12, marginBottom:20 },
  stat:       { backgroundColor:C.card, borderRadius:10, padding:'12px 16px', flex:1, textAlign:'center', border:`1px solid ${C.border}` },
  statN:      { fontSize:24, fontWeight:'bold', color:C.green, margin:0 },
  statL:      { fontSize:11, color:C.sub, marginTop:2 },
  input:      { backgroundColor:'#1a1a1a', color:C.text, padding:'10px 12px', borderRadius:6, border:`1px solid ${C.border}`, width:'100%', fontSize:14, boxSizing:'border-box' },
  label:      { display:'block', marginBottom:4, fontSize:12, color:C.sub },
  badge:      { display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:'bold' },
  tag:        { display:'inline-flex', alignItems:'center', gap:6, padding:'3px 8px', borderRadius:12, fontSize:11, fontWeight:'bold' },
  videoBox:   { backgroundColor:'#000', borderRadius:8, overflow:'hidden', position:'relative', aspectRatio:'16/9' },
  videoEl:    { width:'100%', height:'100%', objectFit:'contain' },
  section:    { marginBottom:24 },
  sectionHdr: { fontSize:16, fontWeight:'bold', marginBottom:12, color:C.text, borderBottom:`1px solid ${C.border}`, paddingBottom:8 },
  dot:        { width:8, height:8, borderRadius:'50%', display:'inline-block' },
  flex:       { display:'flex', alignItems:'center', gap:8 },
  flexBetween:{ display:'flex', alignItems:'center', justifyContent:'space-between' },
  tabs:       { display:'flex', gap:4, marginBottom:20 },
  tab:        { padding:'8px 16px', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:'bold', border:'none' },
  modal:      { position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 },
  modalBox:   { backgroundColor:C.surface, borderRadius:12, padding:24, width:'90%', maxWidth:480, border:`1px solid ${C.border}` },
  toast:      { position:'fixed', bottom:20, right:20, backgroundColor:C.green, color:'#000', padding:'10px 16px', borderRadius:8, fontWeight:'bold', zIndex:300, fontSize:13 },
};

// ─── Login Page ───────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email,setEmail]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState(''); const [loading,setLoading]=useState(false);
  const login = async (e) => {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const res = await api.post('/api/auth/login',{email,password:pw});
      const token = res.data.data.accessToken;
      localStorage.setItem('accessToken',token);
      onLogin(token);
    } catch(ex) { setErr(ex.response?.data?.message||'Login failed'); }
    setLoading(false);
  };
  return (
    <div style={{...st.app,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{...st.card,width:360,maxWidth:'90%'}}>
        <h1 style={{color:C.green,textAlign:'center',marginTop:0}}>🔒 Real Security Camera</h1>
        <p style={{color:C.sub,textAlign:'center',marginBottom:24}}>Web Dashboard</p>
        {err && <div style={{backgroundColor:'#ff444420',border:`1px solid ${C.red}`,borderRadius:6,padding:'8px 12px',marginBottom:12,color:C.red,fontSize:13}}>{err}</div>}
        <form onSubmit={login}>
          <label style={st.label}>Email</label>
          <input style={{...st.input,marginBottom:12}} type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
          <label style={st.label}>Password</label>
          <input style={{...st.input,marginBottom:16}} type="password" value={pw} onChange={e=>setPw(e.target.value)} required/>
          <button style={{...st.btn,...st.btnGreen,width:'100%',padding:'12px'}} disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Camera Card (viewer) ─────────────────────────────────────────
function CameraCard({ device, socket, onEvent }) {
  const videoRef  = useRef(null);
  const pcRef     = useRef(null);
  const [online,  setOnline]  = useState(false);
  const [watching,setWatching]= useState(false);
  const [status,  setStatus]  = useState('Offline');

  useEffect(()=>{
    if (!socket) return;
    const handleOnline = ({deviceId})=>{ if(deviceId===device.id){ setOnline(true); setStatus('Online'); }};
    const handleOffline= ({deviceId})=>{ if(deviceId===device.id){ setOnline(false); setStatus('Offline'); setWatching(false); }};
    socket.on('camera:online',  handleOnline);
    socket.on('camera:offline', handleOffline);

    // WebRTC: receive offer from camera
    socket.on('webrtc:offer', async ({offer, fromSocketId})=>{
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('webrtc:answer',{targetSocketId:fromSocketId, answer});
    });

    // ICE candidates
    socket.on('webrtc:ice', ({candidate})=>{
      if (pcRef.current && candidate) pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{});
    });

    return ()=>{ socket.off('camera:online',handleOnline); socket.off('camera:offline',handleOffline); socket.off('webrtc:offer'); socket.off('webrtc:ice'); };
  },[socket, device.id]);

  const startWatching = useCallback(()=>{
    if (!socket || !online) return;
    const pc = new RTCPeerConnection({
      iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]
    });
    pcRef.current = pc;

    pc.ontrack = (e) => {
      if (videoRef.current && e.streams[0]) {
        videoRef.current.srcObject = e.streams[0];
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('webrtc:ice',{targetSocketId:'__camera__', candidate:e.candidate});
    };
    pc.onconnectionstatechange = ()=>{
      setStatus(pc.connectionState==='connected'?'Live':pc.connectionState);
    };

    // Add transceivers to receive audio/video
    pc.addTransceiver('video',{direction:'recvonly'});
    pc.addTransceiver('audio',{direction:'recvonly'});

    socket.emit('viewer:watch',{deviceId:device.id});
    setWatching(true);
    setStatus('Connecting...');
  },[socket, online, device.id]);

  const stopWatching = ()=>{
    if (pcRef.current) { pcRef.current.close(); pcRef.current=null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setWatching(false); setStatus(online?'Online':'Offline');
  };

  return (
    <div style={st.card}>
      <div style={st.flexBetween}>
        <span style={{fontWeight:'bold',fontSize:14}}>{device.name}</span>
        <span style={{...st.dot,backgroundColor:online?C.green:C.sub}}/>
      </div>
      <div style={{color:C.sub,fontSize:12,marginBottom:8}}>📍 {device.location||'—'}</div>

      <div style={st.videoBox}>
        {watching ? (
          <video ref={videoRef} style={st.videoEl} autoPlay playsInline muted={false}/>
        ) : (
          <div style={{...st.videoEl,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:C.sub}}>
            <span style={{fontSize:40}}>📷</span>
            <span style={{marginTop:8,fontSize:13}}>{status}</span>
          </div>
        )}
        {watching && <div style={{position:'absolute',top:8,left:8,backgroundColor:'rgba(204,0,0,0.9)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>● LIVE</div>}
        <div style={{position:'absolute',bottom:8,right:8,backgroundColor:'rgba(0,0,0,0.6)',color:C.sub,padding:'2px 8px',borderRadius:4,fontSize:11}}>{status}</div>
      </div>

      <div style={{display:'flex',gap:8,marginTop:10}}>
        {!watching ? (
          <button style={{...st.btn,...st.btnGreen,flex:1}} onClick={startWatching} disabled={!online}>
            {online?'▶ Watch Live':'Offline'}
          </button>
        ) : (
          <button style={{...st.btn,...st.btnRed,flex:1}} onClick={stopWatching}>⏹ Stop</button>
        )}
      </div>
    </div>
  );
}

// ─── Camera Source (this browser is the camera) ───────────────────
function CameraSource({ device, socket }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const pcsRef    = useRef({}); // viewerSocketId -> RTCPeerConnection
  const [streaming, setStreaming] = useState(false);
  const [viewers,   setViewers]   = useState(0);
  const [facingBack,setFacingBack]= useState(true);

  useEffect(()=>{
    if (!socket) return;
    socket.on('viewer:request', async ({viewerSocketId})=>{
      if (!streamRef.current) return;
      const pc = new RTCPeerConnection({
        iceServers:[{urls:'stun:stun.l.google.com:19302'}]
      });
      pcsRef.current[viewerSocketId] = pc;
      streamRef.current.getTracks().forEach(t=>pc.addTrack(t,streamRef.current));
      pc.onicecandidate=(e)=>{ if(e.candidate) socket.emit('webrtc:ice',{targetSocketId:viewerSocketId,candidate:e.candidate}); };
      pc.onconnectionstatechange=()=>{
        if (pc.connectionState==='connected') setViewers(v=>v+1);
        if (pc.connectionState==='disconnected'||pc.connectionState==='closed') {
          setViewers(v=>Math.max(0,v-1)); delete pcsRef.current[viewerSocketId];
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc:offer',{targetSocketId:viewerSocketId,offer});
    });
    socket.on('webrtc:answer',async({answer,fromSocketId})=>{
      const pc=pcsRef.current[fromSocketId];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(()=>{});
    });
    socket.on('webrtc:ice',async({candidate,fromSocketId})=>{
      const pc=pcsRef.current[fromSocketId];
      if (pc&&candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{});
    });
    return ()=>{ socket.off('viewer:request'); socket.off('webrtc:answer'); socket.off('webrtc:ice'); };
  },[socket]);

  const startStream = async () => {
    try {
      const constraints = {
        video:{ facingMode: facingBack?'environment':'user', width:{ideal:1280}, height:{ideal:720} },
        audio:true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setStreaming(true);
      // Announce online
      socket.emit('auth',{ deviceId:device.id, deviceName:device.name, role:'camera',
        organizationId: device.organization_id, userId: device.user_id });
      socket.emit('viewer:request',{deviceId:device.id}); // noop — just marks online
    } catch(e) { alert('Camera access denied: '+e.message); }
  };

  const stopStream = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    Object.values(pcsRef.current).forEach(pc=>pc.close());
    pcsRef.current={};
    if (videoRef.current) videoRef.current.srcObject=null;
    setStreaming(false); setViewers(0);
    socket.emit('camera:offline',{deviceId:device.id});
  };

  const switchCamera = async () => {
    if (!streaming) return;
    stopStream();
    setFacingBack(f=>!f);
    setTimeout(startStream,300);
  };

  return (
    <div style={st.card}>
      <div style={st.flexBetween}>
        <span style={{fontWeight:'bold',fontSize:14}}>📡 {device.name} <span style={{color:C.sub,fontSize:11}}>(This device)</span></span>
        {streaming && <span style={{...st.tag,backgroundColor:'#cc000020',color:C.red,border:`1px solid ${C.red}`}}>● LIVE • {viewers} viewer{viewers!==1?'s':''}</span>}
      </div>
      <div style={{color:C.sub,fontSize:12,marginBottom:8}}>📍 {device.location||'—'}</div>
      <div style={st.videoBox}>
        <video ref={videoRef} style={st.videoEl} autoPlay playsInline muted/>
        {streaming && <div style={{position:'absolute',top:8,left:8,backgroundColor:'rgba(204,0,0,0.9)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>● BROADCASTING</div>}
      </div>
      <div style={{display:'flex',gap:8,marginTop:10}}>
        {!streaming ? (
          <button style={{...st.btn,...st.btnGreen,flex:1}} onClick={startStream}>📡 Start Broadcasting</button>
        ) : (
          <>
            <button style={{...st.btn,...st.btnRed,flex:2}} onClick={stopStream}>⏹ Stop</button>
            <button style={{...st.btn,...st.btnGray,flex:1}} onClick={switchCamera}>🔄 Flip</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Events Log ───────────────────────────────────────────────────
function EventsPanel({ events }) {
  return (
    <div style={st.card}>
      <div style={{...st.flexBetween,marginBottom:12}}>
        <span style={{fontWeight:'bold',fontSize:14}}>🚨 Recent Events</span>
        <span style={{...st.badge,backgroundColor:'#ff444420',color:C.red,border:`1px solid ${C.red}`}}>{events.length}</span>
      </div>
      {events.length===0 && <div style={{color:C.sub,fontSize:13,textAlign:'center',padding:'20px 0'}}>No events yet</div>}
      <div style={{maxHeight:300,overflowY:'auto'}}>
        {events.slice(0,20).map(e=>(
          <div key={e.id} style={{display:'flex',gap:10,padding:'8px 0',borderBottom:`1px solid ${C.border}`,alignItems:'center'}}>
            <span style={{fontSize:20}}>{e.type==='motion'?'👁':'🔊'}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:'bold',fontSize:13}}>{e.type==='motion'?'Motion':'Sound'} Detected</div>
              <div style={{color:C.green,fontSize:11}}>{e.deviceName}</div>
              <div style={{color:C.sub,fontSize:11}}>{e.time} • {e.camMode==='security'?'Security Cam':'Dash Cam'}</div>
            </div>
            <span style={{...st.badge,
              backgroundColor:e.camMode==='security'?'#4488ff20':'#00ff8820',
              color:e.camMode==='security'?C.blue:C.green,
              border:`1px solid ${e.camMode==='security'?C.blue+'60':C.green+'60'}`
            }}>{e.camMode==='security'?'SEC':'DASH'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Add Device Modal ─────────────────────────────────────────────
function AddDeviceModal({ onClose, onAdded }) {
  const [name,setName]=useState(''); const [loc,setLoc]=useState(''); const [loading,setLoading]=useState(false);
  const submit = async (e) => {
    e.preventDefault(); setLoading(true);
    try { await api.post('/api/devices',{name,location:loc,rtspUrl:''}); onAdded(); onClose(); }
    catch(ex) { alert(ex.response?.data?.message||'Failed to add device'); }
    setLoading(false);
  };
  return (
    <div style={st.modal} onClick={onClose}>
      <div style={st.modalBox} onClick={e=>e.stopPropagation()}>
        <h2 style={{marginTop:0,color:C.green}}>Add Camera</h2>
        <form onSubmit={submit}>
          <label style={st.label}>Device Name</label>
          <input style={{...st.input,marginBottom:12}} value={name} onChange={e=>setName(e.target.value)} required placeholder="e.g. Front Door"/>
          <label style={st.label}>Location</label>
          <input style={{...st.input,marginBottom:16}} value={loc} onChange={e=>setLoc(e.target.value)} placeholder="e.g. Living Room"/>
          <div style={{display:'flex',gap:8}}>
            <button type="button" style={{...st.btn,...st.btnGray,flex:1}} onClick={onClose}>Cancel</button>
            <button type="submit" style={{...st.btn,...st.btnGreen,flex:1}} disabled={loading||!name.trim()}>
              {loading?'Adding...':'Add Device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── USB/Webcam Device Page ────────────────────────────────────────
function USBCameraPage({ socket, devices, userId, organizationId }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const pcsRef    = useRef({});
  const [streaming,  setStreaming]   = useState(false);
  const [selectedDev,setSelectedDev]= useState('');
  const [camDevices, setCamDevices]  = useState([]);
  const [linkedDevice,setLinkedDevice]=useState('');
  const [viewers,    setViewers]     = useState(0);

  useEffect(()=>{
    navigator.mediaDevices.enumerateDevices().then(devs=>{
      setCamDevices(devs.filter(d=>d.kind==='videoinput'));
      if (devs.length>0) setSelectedDev(devs[0].deviceId);
    });
  },[]);

  useEffect(()=>{
    if (!socket) return;
    socket.on('viewer:request',async({viewerSocketId})=>{
      if (!streamRef.current) return;
      const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
      pcsRef.current[viewerSocketId]=pc;
      streamRef.current.getTracks().forEach(t=>pc.addTrack(t,streamRef.current));
      pc.onicecandidate=e=>{ if(e.candidate) socket.emit('webrtc:ice',{targetSocketId:viewerSocketId,candidate:e.candidate}); };
      pc.onconnectionstatechange=()=>{
        if(pc.connectionState==='connected') setViewers(v=>v+1);
        if(pc.connectionState==='disconnected'||pc.connectionState==='closed'){ setViewers(v=>Math.max(0,v-1)); delete pcsRef.current[viewerSocketId]; }
      };
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc:offer',{targetSocketId:viewerSocketId,offer});
    });
    socket.on('webrtc:answer',async({answer,fromSocketId})=>{ const pc=pcsRef.current[fromSocketId]; if(pc) await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(()=>{}); });
    socket.on('webrtc:ice',async({candidate,fromSocketId})=>{ const pc=pcsRef.current[fromSocketId]; if(pc&&candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{}); });
    return ()=>{ socket.off('viewer:request'); socket.off('webrtc:answer'); socket.off('webrtc:ice'); };
  },[socket]);

  const startStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video:{ deviceId:selectedDev?{exact:selectedDev}:undefined, width:{ideal:1280}, height:{ideal:720} },
        audio:true
      });
      streamRef.current=stream;
      if (videoRef.current) videoRef.current.srcObject=stream;
      setStreaming(true);
      if (linkedDevice) {
        socket.emit('auth',{ deviceId:linkedDevice, deviceName:devices.find(d=>d.id===linkedDevice)?.name||'USB Camera',
          role:'camera', organizationId, userId });
      }
    } catch(e) { alert('Camera access failed: '+e.message); }
  };

  const stopStream = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    Object.values(pcsRef.current).forEach(pc=>pc.close());
    pcsRef.current={};
    if (videoRef.current) videoRef.current.srcObject=null;
    setStreaming(false); setViewers(0);
    if (linkedDevice) socket.emit('camera:offline',{deviceId:linkedDevice});
  };

  return (
    <div style={st.section}>
      <h2 style={st.sectionHdr}>🖥️ USB / Webcam Camera</h2>
      <p style={{color:C.sub,fontSize:13,marginBottom:16}}>Use any connected USB camera, laptop webcam, or built-in camera to broadcast a live stream.</p>
      <div style={{...st.card,marginBottom:16}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
          <div>
            <label style={st.label}>Camera Device</label>
            <select style={{...st.input}} value={selectedDev} onChange={e=>setSelectedDev(e.target.value)}>
              {camDevices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label||`Camera ${d.deviceId.slice(0,8)}`}</option>)}
            </select>
          </div>
          <div>
            <label style={st.label}>Link to Device</label>
            <select style={{...st.input}} value={linkedDevice} onChange={e=>setLinkedDevice(e.target.value)}>
              <option value="">— Select device —</option>
              {devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div style={st.videoBox}>
          <video ref={videoRef} style={st.videoEl} autoPlay playsInline muted/>
          {!streaming && <div style={{...st.videoEl,position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',color:C.sub}}>
            <span style={{fontSize:48}}>🖥️</span><span style={{marginTop:8}}>No stream</span>
          </div>}
          {streaming && <div style={{position:'absolute',top:8,left:8,backgroundColor:'rgba(204,0,0,0.9)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>● BROADCASTING • {viewers} viewer{viewers!==1?'s':''}</div>}
        </div>
        <div style={{display:'flex',gap:8,marginTop:10}}>
          {!streaming
            ? <button style={{...st.btn,...st.btnGreen,flex:1}} onClick={startStream}>📡 Start Broadcasting</button>
            : <button style={{...st.btn,...st.btnRed,flex:1}} onClick={stopStream}>⏹ Stop Broadcasting</button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [token,      setToken]      = useState(localStorage.getItem('accessToken'));
  const [socket,     setSocket]     = useState(null);
  const [devices,    setDevices]    = useState([]);
  const [events,     setEvents]     = useState([]);
  const [tab,        setTab]        = useState('cameras'); // cameras | usb | events | clips
  const [showAdd,    setShowAdd]    = useState(false);
  const [toast,      setToast]      = useState('');
  const [user,       setUser]       = useState(null);
  const [onlineMap,  setOnlineMap]  = useState({});

  const showToast = (msg) => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  // Decode user from token
  useEffect(()=>{
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUser(payload);
    } catch {}
  },[token]);

  // Load devices
  const loadDevices = useCallback(async()=>{
    if (!token) return;
    try { const res=await api.get('/api/devices'); setDevices(res.data.data||[]); } catch {}
  },[token]);

  useEffect(()=>{ loadDevices(); },[loadDevices]);

  // Load events from localStorage (synced from mobile app)
  useEffect(()=>{
    // In production, these would come from the backend via socket
    // For now, display events received via socket
  },[]);

  // Connect socket
  useEffect(()=>{
    if (!token||!user) return;
    const s = io(API, { auth:{ token }, transports:['websocket','polling'] });
    s.on('connect',()=>{
      s.emit('auth',{ userId:user.userId, organizationId:user.organizationId, role:'viewer', deviceName:'Web Dashboard' });
      showToast('Connected to streaming server');
    });
    s.on('camera:online', ({deviceId,deviceName})=>{
      setOnlineMap(m=>({...m,[deviceId]:true}));
      setEvents(ev=>[{type:'system',id:Date.now(),deviceName,time:new Date().toLocaleTimeString(),message:`${deviceName} came online`},...ev]);
    });
    s.on('camera:offline',({deviceId})=>{ setOnlineMap(m=>({...m,[deviceId]:false})); });
    s.on('disconnect',()=>showToast('Disconnected'));
    setSocket(s);
    return ()=>s.disconnect();
  },[token,user]);

  const logout = () => { localStorage.removeItem('accessToken'); setToken(null); setSocket(null); };

  if (!token) return <LoginPage onLogin={setToken}/>;

  const TABS = [
    { id:'cameras', label:'📷 Cameras' },
    { id:'usb',     label:'🖥️ USB/Webcam' },
    { id:'events',  label:'🚨 Events' },
  ];

  return (
    <div style={st.app}>
      {/* Navbar */}
      <nav style={st.nav}>
        <h1 style={st.navTitle}>🔒 Real Security Camera</h1>
        <div style={st.navRight}>
          <span style={{color:C.sub,fontSize:13}}>{user?.email}</span>
          <button style={{...st.btn,...st.btnGold}} onClick={()=>alert('Subscription management coming soon!')}>⭐ Pro</button>
          <button style={{...st.btn,...st.btnRed}} onClick={logout}>Logout</button>
        </div>
      </nav>

      <main style={st.main}>
        {/* Stats */}
        <div style={st.statRow}>
          <div style={st.stat}><p style={st.statN}>{devices.length}</p><p style={st.statL}>Total Cameras</p></div>
          <div style={st.stat}><p style={{...st.statN,color:C.green}}>{Object.values(onlineMap).filter(Boolean).length}</p><p style={st.statL}>Online Now</p></div>
          <div style={st.stat}><p style={{...st.statN,color:C.red}}>{events.filter(e=>e.type!=='system').length}</p><p style={st.statL}>Events Today</p></div>
          <div style={st.stat}>
            <p style={{...st.statN,color:socket?.connected?C.green:C.red}}>{socket?.connected?'●':'○'}</p>
            <p style={st.statL}>{socket?.connected?'Connected':'Offline'}</p>
          </div>
        </div>

        {/* Tabs */}
        <div style={st.tabs}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              ...st.tab,
              backgroundColor: tab===t.id ? C.green : C.card,
              color: tab===t.id ? '#000' : C.text,
              border: tab===t.id ? 'none' : `1px solid ${C.border}`,
            }}>{t.label}</button>
          ))}
          <button style={{...st.btn,...st.btnGreen,marginLeft:'auto'}} onClick={()=>setShowAdd(true)}>+ Add Camera</button>
        </div>

        {/* Camera grid */}
        {tab==='cameras' && (
          <div>
            {devices.length===0
              ? <div style={{...st.card,textAlign:'center',padding:40,color:C.sub}}>
                  <div style={{fontSize:48}}>📷</div>
                  <div style={{marginTop:12}}>No cameras yet. Add one above.</div>
                </div>
              : <div style={st.grid3}>
                  {devices.map(d=>(
                    <CameraCard key={d.id} device={{...d,online:onlineMap[d.id]||d.is_active}} socket={socket} onEvent={e=>setEvents(ev=>[e,...ev])}/>
                  ))}
                </div>
            }
          </div>
        )}

        {/* USB/Webcam */}
        {tab==='usb' && (
          <USBCameraPage socket={socket} devices={devices} userId={user?.userId} organizationId={user?.organizationId}/>
        )}

        {/* Events */}
        {tab==='events' && (
          <div>
            <EventsPanel events={events}/>
          </div>
        )}
      </main>

      {/* Add device modal */}
      {showAdd && <AddDeviceModal onClose={()=>setShowAdd(false)} onAdded={()=>{ loadDevices(); showToast('Camera added!'); }}/>}

      {/* Toast */}
      {toast && <div style={st.toast}>{toast}</div>}
    </div>
  );
}
