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

const C = {
  bg:'#0a0a0a', surface:'#111', card:'#1a1a1a',
  green:'#00ff88', blue:'#4488ff', red:'#ff4444',
  gold:'#ffd700', text:'#ffffff', sub:'#666666', border:'#222222',
};

const st = {
  app:         { minHeight:'100vh', backgroundColor:C.bg, color:C.text, fontFamily:'system-ui,sans-serif' },
  nav:         { backgroundColor:C.surface, padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, zIndex:100 },
  navTitle:    { color:C.green, fontSize:20, fontWeight:'bold', margin:0 },
  navRight:    { display:'flex', alignItems:'center', gap:12 },
  btn:         { padding:'8px 16px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:'bold', fontSize:13 },
  btnGreen:    { backgroundColor:C.green, color:'#000' },
  btnRed:      { backgroundColor:C.red, color:'#fff' },
  btnGray:     { backgroundColor:C.card, color:C.text, border:`1px solid ${C.border}` },
  btnGold:     { backgroundColor:'transparent', color:C.gold, border:`1px solid ${C.gold}` },
  btnBlue:     { backgroundColor:C.blue, color:'#fff' },
  main:        { padding:24, maxWidth:1400, margin:'0 auto' },
  card:        { backgroundColor:C.card, borderRadius:12, padding:16, border:`1px solid ${C.border}` },
  statRow:     { display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' },
  stat:        { backgroundColor:C.card, borderRadius:10, padding:'12px 16px', flex:1, textAlign:'center', border:`1px solid ${C.border}`, minWidth:100 },
  statN:       { fontSize:24, fontWeight:'bold', color:C.green, margin:0 },
  statL:       { fontSize:11, color:C.sub, marginTop:2 },
  input:       { backgroundColor:'#1a1a1a', color:C.text, padding:'10px 12px', borderRadius:6, border:`1px solid ${C.border}`, width:'100%', fontSize:14, boxSizing:'border-box' },
  label:       { display:'block', marginBottom:4, fontSize:12, color:C.sub },
  badge:       { display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:'bold' },
  videoBox:    { backgroundColor:'#000', borderRadius:8, overflow:'hidden', position:'relative', aspectRatio:'16/9' },
  videoEl:     { width:'100%', height:'100%', objectFit:'contain' },
  section:     { marginBottom:24 },
  sectionHdr:  { fontSize:16, fontWeight:'bold', marginBottom:12, color:C.text, borderBottom:`1px solid ${C.border}`, paddingBottom:8 },
  flex:        { display:'flex', alignItems:'center', gap:8 },
  flexBetween: { display:'flex', alignItems:'center', justifyContent:'space-between' },
  tabs:        { display:'flex', gap:4, marginBottom:20, flexWrap:'wrap' },
  tab:         { padding:'8px 16px', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:'bold', border:'none' },
  modal:       { position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:16 },
  modalBox:    { backgroundColor:C.surface, borderRadius:12, padding:24, width:'100%', maxWidth:520, border:`1px solid ${C.border}`, maxHeight:'90vh', overflowY:'auto' },
  toast:       { position:'fixed', bottom:20, right:20, backgroundColor:C.green, color:'#000', padding:'10px 16px', borderRadius:8, fontWeight:'bold', zIndex:300, fontSize:13 },
  toggle:      { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', borderBottom:`1px solid ${C.border}` },
  toggleLabel: { fontSize:14, color:C.text },
  toggleNote:  { fontSize:11, color:C.sub, marginTop:2 },
  switch:      { position:'relative', width:44, height:24, cursor:'pointer' },
  settingSection: { fontSize:11, fontWeight:'bold', textTransform:'uppercase', letterSpacing:1, color:C.sub, marginTop:16, marginBottom:8 },
};

// ─── Toggle Switch ────────────────────────────────────────────────
function Toggle({ value, onChange, color='#00ff88' }) {
  return (
    <div onClick={()=>onChange(!value)} style={{
      width:44, height:24, borderRadius:12, cursor:'pointer', position:'relative', transition:'background 0.2s',
      backgroundColor: value ? color : '#333',
    }}>
      <div style={{
        position:'absolute', top:3, left: value?20:3, width:18, height:18,
        borderRadius:'50%', backgroundColor:'#fff', transition:'left 0.2s',
      }}/>
    </div>
  );
}

// ─── Camera Settings Panel ────────────────────────────────────────
function CameraSettingsPanel({ device, settings, onChange, onClose }) {
  const [s, setS] = useState(settings || {
    camMode: 'dashcam',
    loopForever: false,
    loopDuration: 300,
    clipSize: 300,
    motionEnabled: true,
    soundEnabled: true,
    nightVision: false,
    nightVisionPro: false,
    cloudUpload: false,
  });

  const update = (key, val) => setS(p => ({ ...p, [key]: val }));

  const save = async () => {
    try {
      await api.put(`/api/devices/${device.id}`, { settings: s });
    } catch {}
    onChange(s);
    onClose();
  };

  const LOOP_OPTIONS = [
    { label:'1 min', value:60 },
    { label:'5 min', value:300 },
    { label:'15 min', value:900 },
    { label:'30 min', value:1800 },
  ];

  const CLIP_SIZES = [
    { label:'1 min clips', value:60 },
    { label:'3 min clips', value:180 },
    { label:'5 min clips', value:300 },
  ];

  return (
    <div style={st.modal}>
      <div style={st.modalBox}>
        <div style={{...st.flexBetween, marginBottom:16}}>
          <h2 style={{margin:0, color:C.green}}>⚙️ {device.name} Settings</h2>
          <button style={{...st.btn,...st.btnGray}} onClick={onClose}>✕</button>
        </div>

        {/* Mode */}
        <p style={st.settingSection}>📷 Camera Mode</p>
        <div style={{display:'flex', gap:8, marginBottom:8}}>
          {['dashcam','security'].map(m=>(
            <button key={m} onClick={()=>update('camMode',m)} style={{
              ...st.btn, flex:1,
              backgroundColor: s.camMode===m ? (m==='dashcam'?C.green:C.blue) : C.card,
              color: s.camMode===m ? '#000' : C.text,
              border:`1px solid ${s.camMode===m?(m==='dashcam'?C.green:C.blue):C.border}`,
            }}>
              {m==='dashcam'?'🚗 Dash Cam':'🔒 Security Cam'}
            </button>
          ))}
        </div>

        {/* Loop options */}
        <p style={st.settingSection}>🔁 Recording Mode</p>
        <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:8}}>
          <button onClick={()=>update('loopForever',true)} style={{
            ...st.btn, backgroundColor:s.loopForever?C.gold:C.card,
            color:s.loopForever?'#000':C.text, border:`1px solid ${s.loopForever?C.gold:C.border}`,
          }}>♾️ Loop Forever ⭐</button>
          {LOOP_OPTIONS.map(o=>(
            <button key={o.value} onClick={()=>{ update('loopForever',false); update('loopDuration',o.value); }} style={{
              ...st.btn,
              backgroundColor:!s.loopForever&&s.loopDuration===o.value?C.green:C.card,
              color:!s.loopForever&&s.loopDuration===o.value?'#000':C.text,
              border:`1px solid ${!s.loopForever&&s.loopDuration===o.value?C.green:C.border}`,
            }}>⏱ {o.label}</button>
          ))}
        </div>

        {s.loopForever && <>
          <p style={st.settingSection}>🎬 Clip Length (Loop Forever)</p>
          <div style={{display:'flex', gap:6, marginBottom:8}}>
            {CLIP_SIZES.map(o=>(
              <button key={o.value} onClick={()=>update('clipSize',o.value)} style={{
                ...st.btn, flex:1,
                backgroundColor:s.clipSize===o.value?C.green:C.card,
                color:s.clipSize===o.value?'#000':C.text,
                border:`1px solid ${s.clipSize===o.value?C.green:C.border}`,
              }}>{o.label}</button>
            ))}
          </div>
        </>}

        {/* Security detection */}
        <p style={st.settingSection}>🔒 Security Detection</p>
        <div style={st.toggle}>
          <div>
            <div style={st.toggleLabel}>Motion Detection</div>
            <div style={st.toggleNote}>Accelerometer-based movement detection</div>
          </div>
          <Toggle value={s.motionEnabled} onChange={v=>update('motionEnabled',v)}/>
        </div>
        <div style={st.toggle}>
          <div>
            <div style={st.toggleLabel}>Sound Detection</div>
            <div style={st.toggleNote}>Microphone audio level monitoring</div>
          </div>
          <Toggle value={s.soundEnabled} onChange={v=>update('soundEnabled',v)}/>
        </div>

        {/* Night Vision */}
        <p style={st.settingSection}>🌙 Night Vision</p>
        <div style={st.toggle}>
          <div>
            <div style={st.toggleLabel}>Night Mode</div>
            <div style={st.toggleNote}>Brightness boost overlay (free)</div>
          </div>
          <Toggle value={s.nightVision} onChange={v=>update('nightVision',v)}/>
        </div>
        <div style={st.toggle}>
          <div>
            <div style={st.toggleLabel}>Night Vision Pro ⭐</div>
            <div style={st.toggleNote}>Phosphor green contrast enhancement</div>
          </div>
          <Toggle value={s.nightVisionPro} onChange={v=>{ update('nightVisionPro',v); if(v) update('nightVision',true); }} color={C.gold}/>
        </div>

        {/* Storage */}
        <p style={st.settingSection}>☁️ Storage</p>
        <div style={st.toggle}>
          <div>
            <div style={st.toggleLabel}>Cloud Upload ⭐</div>
            <div style={st.toggleNote}>Auto-upload clips to DigitalOcean Spaces</div>
          </div>
          <Toggle value={s.cloudUpload} onChange={v=>update('cloudUpload',v)}/>
        </div>

        <div style={{display:'flex', gap:8, marginTop:20}}>
          <button style={{...st.btn,...st.btnGray, flex:1}} onClick={onClose}>Cancel</button>
          <button style={{...st.btn,...st.btnGreen, flex:2}} onClick={save}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}

// ─── Camera Viewer Card ───────────────────────────────────────────
function CameraCard({ device, socket, onEvent, onSettings, settings }) {
  const videoRef   = useRef(null);
  const pcRef      = useRef(null);
  const [online,   setOnline]   = useState(device.is_active || false);
  const [watching, setWatching] = useState(false);
  const [status,   setStatus]   = useState(device.is_active ? 'Online' : 'Offline');

  useEffect(()=>{
    if (!socket) return;
    const onOnline  = ({deviceId})=>{ if(deviceId===device.id){ setOnline(true); setStatus('Online'); }};
    const onOffline = ({deviceId})=>{ if(deviceId===device.id){ setOnline(false); setStatus('Offline'); stopWatching(); }};
    socket.on('camera:online',  onOnline);
    socket.on('camera:offline', onOffline);
    socket.on('webrtc:offer', async({offer,fromSocketId})=>{
      if (!pcRef.current) return;
      console.log('📺 Received WebRTC offer from:', fromSocketId);
      cameraSocketIdRef.current = fromSocketId; // store for ICE
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('webrtc:answer',{targetSocketId:fromSocketId,answer});
    });
    socket.on('webrtc:ice',({candidate,fromSocketId})=>{
      // Only process ICE from the camera we're watching
      if (pcRef.current && candidate && fromSocketId === cameraSocketIdRef.current) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(e=>console.log('ICE error:',e));
      }
    });
    return ()=>{ socket.off('camera:online',onOnline); socket.off('camera:offline',onOffline); };
  },[socket,device.id]);

  const cameraSocketIdRef = useRef(null); // store camera's socketId for ICE

  const startWatching = () => {
    if (!socket||!online) return;
    // Clean up any existing connection first
    if (pcRef.current) { pcRef.current.close(); pcRef.current=null; }
    const pc = new RTCPeerConnection({
      iceServers:[
        {urls:'stun:stun.l.google.com:19302'},
        {urls:'stun:stun1.l.google.com:19302'},
        {urls:'stun:stun2.l.google.com:19302'},
      ]
    });
    pcRef.current = pc;
    pc.ontrack = e=>{
      console.log('📺 Got track:', e.track.kind, e.streams.length);
      if(videoRef.current && e.streams[0]) {
        videoRef.current.srcObject = e.streams[0];
        videoRef.current.play().catch(()=>{});
      }
    };
    // Send ICE candidates to the camera using its socketId from the offer
    pc.onicecandidate = e=>{
      if(e.candidate && cameraSocketIdRef.current) {
        socket.emit('webrtc:ice',{targetSocketId:cameraSocketIdRef.current, candidate:e.candidate});
      }
    };
    pc.onconnectionstatechange = ()=>{
      console.log('📺 WebRTC state:', pc.connectionState);
      setStatus(pc.connectionState==='connected'?'● Live':pc.connectionState);
    };
    pc.addTransceiver('video',{direction:'recvonly'});
    pc.addTransceiver('audio',{direction:'recvonly'});
    console.log('📺 Sending viewer:watch for device:', device.id, 'socket:', socket.id);
    socket.emit('viewer:watch',{deviceId:device.id});
    setWatching(true); setStatus('Connecting...');
  };

  const stopWatching = () => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current=null; }
    if (videoRef.current) videoRef.current.srcObject=null;
    setWatching(false); setStatus(online?'Online':'Offline');
  };

  const camMode = settings?.camMode || 'dashcam';
  const modeColor = camMode==='dashcam' ? C.green : C.blue;
  const modeLabel = camMode==='dashcam' ? '🚗 Dash Cam' : '🔒 Security Cam';

  return (
    <div style={st.card}>
      <div style={{...st.flexBetween, marginBottom:4}}>
        <span style={{fontWeight:'bold',fontSize:15}}>{device.name}</span>
        <div style={{...st.flex, gap:6}}>
          <span style={{fontSize:11,color:modeColor,border:`1px solid ${modeColor}`,padding:'2px 6px',borderRadius:4}}>{modeLabel}</span>
          <div style={{width:8,height:8,borderRadius:'50%',backgroundColor:online?C.green:C.sub}}/>
        </div>
      </div>
      <div style={{color:C.sub,fontSize:12,marginBottom:10}}>📍 {device.location||'—'}</div>

      {/* Video */}
      <div style={st.videoBox}>
        {watching
          ? <video ref={videoRef} style={st.videoEl} autoPlay playsInline controls
              onLoadedMetadata={e=>{ if(e.target.paused) e.target.play(); }}/>
          : <div style={{...st.videoEl,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:C.sub,position:'absolute',inset:0}}>
              <span style={{fontSize:40}}>📷</span>
              <span style={{marginTop:8,fontSize:13}}>{status}</span>
            </div>
        }
        {watching && <div style={{position:'absolute',top:8,left:8,backgroundColor:'rgba(204,0,0,0.9)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>● LIVE</div>}
        {settings?.nightVisionPro && watching && <div style={{position:'absolute',inset:0,backgroundColor:'rgba(0,255,70,0.15)',pointerEvents:'none'}}/>}
        {settings?.nightVision && !settings?.nightVisionPro && watching && <div style={{position:'absolute',inset:0,backgroundColor:'rgba(255,255,200,0.06)',pointerEvents:'none'}}/>}
      </div>

      {/* Controls */}
      <div style={{display:'flex',gap:6,marginTop:10}}>
        {!watching
          ? <button style={{...st.btn,...(online?st.btnGreen:st.btnGray),flex:2}} onClick={startWatching} disabled={!online}>
              {online?'▶ Watch Live':'Offline'}
            </button>
          : <button style={{...st.btn,...st.btnRed,flex:2}} onClick={stopWatching}>⏹ Stop</button>
        }
        <button style={{...st.btn,...st.btnGray}} onClick={onSettings} title="Settings">⚙️</button>
      </div>

      {/* Status bar */}
      {settings && (
        <div style={{marginTop:8,display:'flex',gap:6,flexWrap:'wrap'}}>
          {settings.motionEnabled && <span style={{fontSize:10,color:C.green,border:`1px solid ${C.green}40`,padding:'1px 6px',borderRadius:4}}>👁 Motion</span>}
          {settings.soundEnabled  && <span style={{fontSize:10,color:C.blue, border:`1px solid ${C.blue}40`, padding:'1px 6px',borderRadius:4}}>🔊 Sound</span>}
          {settings.nightVision   && <span style={{fontSize:10,color:'#aaa', border:`1px solid #aaa40`,    padding:'1px 6px',borderRadius:4}}>🌙 NV</span>}
          {settings.cloudUpload   && <span style={{fontSize:10,color:C.gold, border:`1px solid ${C.gold}40`,padding:'1px 6px',borderRadius:4}}>☁️ Cloud</span>}
        </div>
      )}
    </div>
  );
}

// ─── USB/Webcam Source ────────────────────────────────────────────
// ─── Live Clock overlay for video ────────────────────────────────
function VideoTimestamp() {
  const [now, setNow] = useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);
  const pad = n => String(n).padStart(2,'0');
  return (
    <div style={{position:'absolute',bottom:8,right:8,backgroundColor:'rgba(0,0,0,0.65)',
      color:'rgba(255,255,255,0.9)',padding:'4px 8px',borderRadius:5,fontSize:12,
      fontFamily:'monospace',fontWeight:'bold',pointerEvents:'none',zIndex:10}}>
      {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}&nbsp;&nbsp;
      {now.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}
    </div>
  );
}

// ─── Canvas timestamp burn-in for recordings ──────────────────────
// Draws the camera stream + timestamp onto a canvas so recordings include the stamp
function createTimestampedStream(sourceStream) {
  const video = document.createElement('video');
  video.srcObject = sourceStream;
  video.muted = true;
  video.play();

  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');

  const draw = () => {
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const now = new Date();
      const pad = n => String(n).padStart(2,'0');
      const ts = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}  ${now.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}`;
      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(canvas.width-280, canvas.height-36, 276, 30);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'right';
      ctx.fillText(ts, canvas.width-8, canvas.height-12);
    }
    requestAnimationFrame(draw);
  };
  draw();

  // Combine canvas video with original audio
  const canvasStream = canvas.captureStream(30);
  sourceStream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
  return { canvasStream, cleanup: () => { video.pause(); video.srcObject = null; } };
}

const LOOP_OPTS = [
  { label:'1 min',  value:60   },
  { label:'5 min',  value:300  },
  { label:'15 min', value:900  },
  { label:'30 min', value:1800 },
];
const CLIP_SIZES = [
  { label:'1 min', value:60  },
  { label:'3 min', value:180 },
  { label:'5 min', value:300 },
];

function USBCameraPage({ socket, devices, userId, organizationId, onEvent }) {
  // Dedicated camera socket — separate from viewer socket
  // This lets same browser be both broadcaster AND viewer
  const camSocketRef = useRef(null);
  const [camSocket, setCamSocket] = useState(null);

  useEffect(()=>{
    const token = localStorage.getItem('accessToken');
    if (!token || camSocketRef.current) return; // only create once
    // io is imported at top of file from socket.io-client
    const API_URL = 'https://whale-app-hxokg.ondigitalocean.app';
    const s = io(API_URL, {
      auth:{ token }, transports:['websocket','polling']
    });
    s.on('connect', ()=>{
      console.log('📡 Camera socket connected:', s.id);
      setCamSocket(s); // trigger re-render so viewer:request useEffect re-runs with valid socket
    });
    s.on('disconnect', ()=>{ console.log('📡 Camera socket disconnected'); });
    camSocketRef.current = s;
    setCamSocket(s);
    // Don't clean up on unmount — keep alive while page is open
    return ()=>{};
  },[]);
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const pcsRef     = useRef({});
  const [streaming,      setStreaming]      = useState(false);
  const [selectedDev,    setSelectedDev]    = useState('');
  const [camDevices,     setCamDevices]     = useState([]);
  const [linkedDevice,   setLinkedDevice]   = useState('');
  // Auto-select first device when devices list loads
  useEffect(()=>{ if(devices.length>0 && !linkedDevice) setLinkedDevice(devices[0].id); },[devices]);
  const [viewers,        setViewers]        = useState(0);
  const [nightVision,    setNightVision]    = useState(false);
  const [motionEnabled,  setMotionEnabled]  = useState(true);
  const [soundEnabled,   setSoundEnabled]   = useState(true);
  const [isRecording,    setIsRecording]    = useState(false);
  const [isArmed,        setIsArmed]        = useState(false);
  const [statusMsg,      setStatusMsg]      = useState('Ready');
  const [events,         setEvents]         = useState([]);
  const [zoomLevel,      setZoomLevel]      = useState(1);
  const [hwZoomSupported,setHwZoomSupported]= useState(false);
  const [hwZoomRange,    setHwZoomRange]    = useState({min:1,max:3,step:0.1});
  // Recording mode
  const [recordMode,     setRecordMode]     = useState('manual');  // manual | timed | loop
  const [loopDuration,   setLoopDuration]   = useState(300);
  const [clipSize,       setClipSize]       = useState(300);
  const [showRecPrompt,  setShowRecPrompt]  = useState(false);
  const [clipManagement, setClipManagement] = useState('cloud'); // download | cloud | both | ask
  const [showClipPrompt, setShowClipPrompt] = useState(false);
  const [recordingTime,  setRecordingTime]  = useState(0);
  // Motion detection via pixel diff
  const [sensitivity,    setSensitivity]    = useState(30); // 1-100
  const motionCanvasRef  = useRef(null);
  const prevFrameRef     = useRef(null);
  const motionPollRef    = useRef(null);
  const mediaRecRef      = useRef(null);
  const loopTimerRef     = useRef(null);
  const recTimerRef      = useRef(null);
  const alertActiveRef   = useRef(false);
  const isArmedRef       = useRef(false);
  const isRecordingRef   = useRef(false);
  const canvasCleanupRef = useRef(null);
  const tsStreamRef      = useRef(null); // timestamped stream for recording

  useEffect(()=>{
    navigator.mediaDevices.enumerateDevices().then(devs=>{
      const vids = devs.filter(d=>d.kind==='videoinput');
      if (vids.length>0) {
        const hasLabels = vids.some(d=>d.label&&d.label.length>0);
        if (hasLabels) { setCamDevices(vids); setSelectedDev(vids[0].deviceId); }
        else { setCamDevices([{deviceId:'',label:`${vids.length} camera${vids.length>1?'s':''} available`}]); setSelectedDev(''); }
      }
    });
  },[]);

  useEffect(()=>{
    isArmedRef.current = isArmed;
  },[isArmed]);

  useEffect(()=>{
    const cs = camSocket; // use state not ref so effect re-runs when socket connects
    if (!cs) { console.log('📺 No camera socket yet'); return; }
    console.log('📺 Registering viewer:request handler on camera socket:', cs.id);
    cs.on('viewer:request',async({viewerSocketId})=>{
      console.log('📺 Camera received viewer:request from:', viewerSocketId, 'stream ready:', !!streamRef.current);
      if (!streamRef.current) { console.log('📺 No stream available yet!'); return; }
      const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});
      pcsRef.current[viewerSocketId]=pc;
      streamRef.current.getTracks().forEach(t=>pc.addTrack(t,streamRef.current));
      pc.onicecandidate=e=>{ if(e.candidate) cs.emit('webrtc:ice',{targetSocketId:viewerSocketId,candidate:e.candidate}); };
      pc.onconnectionstatechange=()=>{
        if(pc.connectionState==='connected') setViewers(v=>v+1);
        if(pc.connectionState==='disconnected'||pc.connectionState==='closed'){ setViewers(v=>Math.max(0,v-1)); delete pcsRef.current[viewerSocketId]; }
      };
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('📺 Camera sending offer to viewer:', viewerSocketId);
      cs.emit('webrtc:offer',{targetSocketId:viewerSocketId,offer});
    });
    cs.on('webrtc:answer',async({answer,fromSocketId})=>{ const pc=pcsRef.current[fromSocketId]; if(pc) await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(()=>{}); });
    cs.on('webrtc:ice',async({candidate,fromSocketId})=>{ const pc=pcsRef.current[fromSocketId]; if(pc&&candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{}); });
    return ()=>{ cs.off('viewer:request'); cs.off('webrtc:answer'); cs.off('webrtc:ice'); };
  },[camSocket]);

  // ── Real pixel-diff motion detection ─────────────────────────
  const startMotionDetection = () => {
    if (!streamRef.current || !motionEnabled) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90; // small for performance
    const ctx = canvas.getContext('2d');
    motionCanvasRef.current = canvas;

    motionPollRef.current = setInterval(()=>{
      if (!isArmedRef.current || alertActiveRef.current || !motionEnabled) return;
      if (!video || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, 160, 90);
      const current = ctx.getImageData(0, 0, 160, 90);
      if (prevFrameRef.current) {
        const prev = prevFrameRef.current.data;
        const curr = current.data;
        let diff = 0;
        // Sample every 4th pixel for speed
        for (let i = 0; i < curr.length; i += 16) {
          diff += Math.abs(curr[i] - prev[i]);
          diff += Math.abs(curr[i+1] - prev[i+1]);
          diff += Math.abs(curr[i+2] - prev[i+2]);
        }
        const avgDiff = diff / (curr.length / 16);
        const threshold = 100 - sensitivity; // higher sensitivity = lower threshold
        if (avgDiff > threshold) {
          console.log('Motion detected! avgDiff:', avgDiff.toFixed(1), 'threshold:', threshold);
          triggerAlert('motion');
        }
      }
      prevFrameRef.current = current;
    }, 500); // check every 500ms
  };

  const stopMotionDetection = () => {
    clearInterval(motionPollRef.current);
    prevFrameRef.current = null;
  };

  // ── Sound detection via AudioContext analyser ─────────────────
  const startSoundDetection = () => {
    if (!streamRef.current || !soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(streamRef.current);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const checkSound = setInterval(()=>{
        if (!isArmedRef.current || alertActiveRef.current) return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a,b)=>a+b,0)/data.length;
        if (avg > 20) triggerAlert('sound');
      }, 600);
      return ()=>{ clearInterval(checkSound); audioCtx.close(); };
    } catch(e) { console.log('Sound detection error:', e.message); }
  };

  const triggerAlert = (type) => {
    if (alertActiveRef.current) return;
    alertActiveRef.current = true;
    const now = new Date();
    const event = {
      id: Date.now(), type,
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}),
      device: devices.find(d=>d.id===linkedDevice)?.name || 'USB Camera',
      deviceName: devices.find(d=>d.id===linkedDevice)?.name || 'USB Camera',
      camMode: 'security',
    };
    setEvents(ev=>[event,...ev].slice(0,50));
    // Bubble up to main App stats
    if (onEvent) onEvent(event);
    setStatusMsg(`⚠️ ${type==='motion'?'Motion':'Sound'} detected!`);
    if (!isRecordingRef.current) startRecording(true);
    // alertActiveRef is released in the recording onstop handler, not on a timer
    // This prevents re-triggering during an active clip
  };

  const startStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const devs = await navigator.mediaDevices.enumerateDevices();
      const vids = devs.filter(d=>d.kind==='videoinput');
      setCamDevices(vids);
      if (vids.length>0) setSelectedDev(vids[0].deviceId);
      setStreaming(true);
      setStatusMsg('🟢 Broadcasting — select mode below');
      // HW zoom
      try {
        const vt = stream.getVideoTracks()[0];
        const caps = vt.getCapabilities?.();
        if (caps?.zoom) { setHwZoomSupported(true); setHwZoomRange({min:caps.zoom.min,max:caps.zoom.max,step:caps.zoom.step||0.1}); }
      } catch {}
      // Build timestamped stream for recordings
      const { canvasStream, cleanup } = createTimestampedStream(stream);
      tsStreamRef.current = canvasStream;
      canvasCleanupRef.current = cleanup;
      if (linkedDevice && camSocketRef.current) {
        const token = localStorage.getItem('accessToken');
        const payload = token ? JSON.parse(atob(token.split('.')[1])) : {};
        const orgId = payload.organizationId || payload.org_id || organizationId;
        camSocketRef.current.emit('auth',{ deviceId:linkedDevice, deviceName:devices.find(d=>d.id===linkedDevice)?.name||'USB Camera', role:'camera', organizationId:orgId, userId:payload.userId||userId });
        console.log('📡 Camera socket authed as:', devices.find(d=>d.id===linkedDevice)?.name, 'org:', orgId);
      }
    } catch(e) {
      if (e.name==='NotAllowedError') alert('Camera permission denied. Allow access in browser settings.');
      else if (e.name==='NotFoundError') alert('No camera found.');
      else if (e.name==='NotReadableError') alert('Camera in use by another app.');
      else alert('Camera error: '+(e.message||e.name));
    }
  };

  const stopStream = () => {
    stopMotionDetection();
    clearInterval(loopTimerRef.current);
    clearInterval(recTimerRef.current);
    if (mediaRecRef.current) { try { mediaRecRef.current.stop(); } catch {} mediaRecRef.current=null; }
    if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    if (canvasCleanupRef.current) { canvasCleanupRef.current(); canvasCleanupRef.current=null; }
    streamRef.current=null; tsStreamRef.current=null;
    Object.values(pcsRef.current).forEach(pc=>pc.close()); pcsRef.current={};
    if (videoRef.current) videoRef.current.srcObject=null;
    setStreaming(false); setIsArmed(false); setIsRecording(false);
    setViewers(0); setStatusMsg('Ready'); setRecordingTime(0);
    isArmedRef.current=false; isRecordingRef.current=false;
    if (linkedDevice&&camSocketRef.current) camSocketRef.current.emit('camera:offline',{deviceId:linkedDevice});
  };

  const armCamera = () => {
    setIsArmed(true); isArmedRef.current=true;
    setStatusMsg('🟢 Armed — monitoring...');
    startMotionDetection();
    if (soundEnabled) startSoundDetection();
  };

  const armWithClipChoice = (choice) => {
    setClipManagement(choice);
    setShowClipPrompt(false);
    setIsArmed(true); isArmedRef.current=true;
    setStatusMsg('🟢 Armed — monitoring...');
    startMotionDetection();
    if (soundEnabled) startSoundDetection();
  };

  const disarmCamera = () => {
    setIsArmed(false); isArmedRef.current=false;
    stopMotionDetection();
    if (isRecordingRef.current) stopRecording();
    setStatusMsg('🟢 Broadcasting — select mode below');
  };

  const startRecording = (triggered=false) => {
    const recStream = tsStreamRef.current || streamRef.current;
    if (!recStream || isRecordingRef.current) return;
    isRecordingRef.current=true; setIsRecording(true);
    setStatusMsg(triggered?'🔴 Recording (triggered)':'🔴 Recording...');
    setRecordingTime(0);
    recTimerRef.current = setInterval(()=>setRecordingTime(t=>t+1),1000);
    const chunks=[];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const mr = new MediaRecorder(recStream, {mimeType});
    mr.ondataavailable=e=>{ if(e.data.size>0) chunks.push(e.data); };
    mr.onstop=()=>{
      clearInterval(recTimerRef.current); setRecordingTime(0);
      const blob=new Blob(chunks,{type:'video/webm'});
      const devName = devices.find(d=>d.id===linkedDevice)?.name?.replace(/\s+/g,'-')||'usb';
      const filename = `clip_security_${devName}_${Date.now()}.webm`;

      if (clipManagement==='download' || clipManagement==='both') {
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url; a.download=filename; a.click();
        URL.revokeObjectURL(url);
      }
      if (clipManagement==='cloud' || clipManagement==='both') {
        const formData = new FormData();
        formData.append('video', blob, filename);
        formData.append('device_id', linkedDevice||'');
        formData.append('filename', filename);
        const token = localStorage.getItem('accessToken');
        setStatusMsg('☁️ Uploading...');
        fetch(`${API}/api/recordings/upload`, {
          method:'POST',
          headers:{ Authorization:'Bearer '+token },
          body: formData,
        }).then(async r=>{
          if (r.ok) { setStatusMsg('☁️ Clip uploaded'); }
          else { console.warn('Upload failed:', r.status); setStatusMsg('⬇️ Saved locally (cloud unavailable)'); }
        }).catch(()=>setStatusMsg('⬇️ Saved locally (cloud unavailable)'));
      }

      isRecordingRef.current=false; setIsRecording(false);
      // Release cooldown NOW — clip is saved, detection can re-trigger
      alertActiveRef.current=false;
      setStatusMsg(isArmedRef.current?'🟢 Armed — monitoring...':'🟢 Broadcasting');
      if (recordMode==='loop' && isArmedRef.current) startRecording();
    };
    mr.start();
    mediaRecRef.current=mr;
    // Timed modes: stop after duration
    if (recordMode==='timed'||triggered) {
      const dur = triggered ? loopDuration : loopDuration;
      loopTimerRef.current = setTimeout(()=>stopRecording(), dur*1000);
    }
  };

  const stopRecording = () => {
    clearTimeout(loopTimerRef.current);
    if (mediaRecRef.current && mediaRecRef.current.state!=='inactive') {
      mediaRecRef.current.stop();
    }
  };

  const handleZoom = async (val) => {
    const z = parseFloat(val); setZoomLevel(z);
    if (hwZoomSupported && streamRef.current) {
      try { await streamRef.current.getVideoTracks()[0].applyConstraints({advanced:[{zoom:z}]}); } catch {}
    }
  };

  const pad = n => String(Math.floor(n)).padStart(2,'0');
  const fmtTime = s => `${pad(s/60)}:${pad(s%60)}`;

  return (
    <div>
      <h2 style={st.sectionHdr}>🔒 USB / Webcam — Security Camera</h2>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:20}}>

        {/* LEFT: Feed */}
        <div style={st.card}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
            <div>
              <label style={st.label}>Camera Device</label>
              <select style={st.input} value={selectedDev} onChange={e=>setSelectedDev(e.target.value)}>
                {camDevices.map((d,i)=>(
                  <option key={d.deviceId||i} value={d.deviceId||''}>
                    {d.label&&d.label.length>0?d.label:`Camera ${i+1}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={st.label}>Link to Device</label>
              <select style={st.input} value={linkedDevice} onChange={e=>setLinkedDevice(e.target.value)}>
                <option value="">— Select device —</option>
                {devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          {/* Video with timestamp overlay */}
          <div style={st.videoBox}>
            <video ref={videoRef} style={{
              ...st.videoEl,
              transform:`scale(${zoomLevel})`,
              transformOrigin:'center center',
              transition:'transform 0.15s',
            }} autoPlay playsInline muted/>
            {!streaming && <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',color:C.sub}}>
              <span style={{fontSize:48}}>🔒</span><span style={{marginTop:8}}>No stream</span>
            </div>}
            {streaming && <>
              {/* Top left: broadcast status */}
              <div style={{position:'absolute',top:8,left:8,backgroundColor:isRecording?'rgba(204,0,0,0.9)':'rgba(0,100,0,0.85)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>
                {isRecording?`● REC ${fmtTime(recordingTime)}`:`● LIVE • ${viewers}v`}
              </div>
              {/* Armed badge */}
              {isArmed && !isRecording && <div style={{position:'absolute',top:8,right:8,backgroundColor:'rgba(0,80,0,0.85)',color:C.green,padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>🟢 ARMED</div>}
              {/* Night vision overlay */}
              {nightVision && <div style={{position:'absolute',inset:0,backgroundColor:'rgba(0,255,70,0.15)',pointerEvents:'none'}}/>}
              {/* Date/time stamp — bottom right */}
              <VideoTimestamp/>
              {/* Status bar */}
              <div style={{position:'absolute',bottom:8,left:8,backgroundColor:'rgba(0,0,0,0.65)',color:'#fff',padding:'3px 8px',borderRadius:6,fontSize:12}}>{statusMsg}</div>
            </>}
          </div>

          {/* Zoom controls */}
          {streaming && (
            <div style={{marginTop:8,backgroundColor:'#0d0d0d',borderRadius:8,padding:8}}>
              <div style={{...st.flexBetween,marginBottom:6}}>
                <span style={{fontSize:12,color:C.sub}}>🔍 {zoomLevel.toFixed(1)}x {hwZoomSupported&&<span style={{color:C.green,fontSize:10}}>HW</span>}</span>
                <button style={{...st.btn,...st.btnGray,padding:'3px 8px',fontSize:11}} onClick={()=>handleZoom(1)}>Reset</button>
              </div>
              <input type="range" min={1} max={hwZoomSupported?hwZoomRange.max:3} step={hwZoomSupported?hwZoomRange.step:0.1}
                value={zoomLevel} onChange={e=>handleZoom(e.target.value)}
                style={{width:'100%',accentColor:C.green}}/>
            </div>
          )}

          {/* Main buttons */}
          <div style={{display:'flex',gap:6,marginTop:8}}>
            {!streaming
              ? <button style={{...st.btn,...st.btnGreen,flex:1}} onClick={startStream}>📡 Start Broadcasting</button>
              : <>
                  {/* Monitoring toggle */}
                  {!isArmed
                    ? <button style={{...st.btn,flex:2,backgroundColor:'rgba(0,255,136,0.15)',color:C.green,border:`2px solid ${C.green}`,fontWeight:'bold'}}
                        onClick={()=>armCamera()}>
                        🟢 Start Monitoring
                      </button>
                    : <button style={{...st.btn,flex:2,backgroundColor:'rgba(255,68,68,0.15)',color:C.red,border:`2px solid ${C.red}`,fontWeight:'bold'}}
                        onClick={disarmCamera}>
                        🔴 Stop Monitoring
                      </button>
                  }
                  {isArmed && <>
                    {!isRecording
                      ? <button style={{...st.btn,...st.btnBlue}} onClick={()=>startRecording()}>⏺ Record</button>
                      : <button style={{...st.btn,...st.btnRed}} onClick={stopRecording}>⏹ Stop</button>
                    }
                  </>}
                  <button style={{...st.btn,...st.btnRed,padding:'8px 10px'}} onClick={stopStream} title="Stop Broadcasting">■</button>
                </>
            }
          </div>

          {/* Clip management setting shown when armed */}
          {isArmed && (
            <div style={{marginTop:8,backgroundColor:'#0d0d0d',borderRadius:8,padding:'8px 10px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:12,color:C.sub}}>
                📼 Clips: <span style={{color:C.green}}>
                  {clipManagement==='download'?'⬇️ Download'
                   :clipManagement==='cloud'?'☁️ Cloud'
                   :clipManagement==='both'?'⬇️+☁️ Both'
                   :'Not set'}
                </span>
              </span>
              <button style={{...st.btn,...st.btnGray,padding:'3px 8px',fontSize:11}}
                onClick={()=>setShowClipPrompt(true)}>Change</button>
            </div>
          )}
        </div>

        {/* RIGHT: Settings */}
        <div style={st.card}>
          <p style={{fontWeight:'bold',marginBottom:12,color:C.text,fontSize:15}}>⚙️ Security Settings</p>

          {/* Recording mode */}
          <p style={st.settingSection}>🎬 Recording Mode</p>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
            {[
              {id:'manual',  label:'⏺ Manual'},
              {id:'timed',   label:'⏱ Timed'},
              {id:'loop',    label:'♾️ Loop'},
            ].map(m=>(
              <button key={m.id} onClick={()=>setRecordMode(m.id)} style={{
                ...st.btn,
                backgroundColor:recordMode===m.id?C.blue:C.card,
                color:recordMode===m.id?'#fff':C.text,
                border:`1px solid ${recordMode===m.id?C.blue:C.border}`,
                fontSize:12,
              }}>{m.label}</button>
            ))}
          </div>

          {/* Duration picker for timed/loop */}
          {(recordMode==='timed'||recordMode==='loop') && <>
            <p style={st.settingSection}>⏱ Clip Duration</p>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
              {LOOP_OPTS.map(o=>(
                <button key={o.value} onClick={()=>setLoopDuration(o.value)} style={{
                  ...st.btn, fontSize:12,
                  backgroundColor:loopDuration===o.value?C.green:C.card,
                  color:loopDuration===o.value?'#000':C.text,
                  border:`1px solid ${loopDuration===o.value?C.green:C.border}`,
                }}>{o.label}</button>
              ))}
            </div>
          </>}

          {/* Motion detection */}
          <p style={st.settingSection}>🔒 Detection</p>
          <div style={st.toggle}>
            <div>
              <div style={st.toggleLabel}>Motion Detection</div>
              <div style={st.toggleNote}>Real pixel-diff analysis of video feed</div>
            </div>
            <Toggle value={motionEnabled} onChange={setMotionEnabled}/>
          </div>
          {motionEnabled && (
            <div style={{padding:'8px 0'}}>
              <div style={{...st.flexBetween,marginBottom:4}}>
                <span style={{fontSize:12,color:C.sub}}>Sensitivity</span>
                <span style={{fontSize:12,color:C.green}}>{sensitivity}%</span>
              </div>
              <input type="range" min={5} max={95} step={5} value={sensitivity}
                onChange={e=>setSensitivity(parseInt(e.target.value))}
                style={{width:'100%',accentColor:C.green}}/>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.sub}}>
                <span>Less sensitive</span><span>More sensitive</span>
              </div>
            </div>
          )}
          <div style={st.toggle}>
            <div>
              <div style={st.toggleLabel}>Sound Detection</div>
              <div style={st.toggleNote}>Audio level monitoring</div>
            </div>
            <Toggle value={soundEnabled} onChange={setSoundEnabled}/>
          </div>

          {/* Night vision */}
          <p style={st.settingSection}>🌙 Night Vision</p>
          <div style={st.toggle}>
            <div><div style={st.toggleLabel}>Night Mode</div><div style={st.toggleNote}>Green tint overlay</div></div>
            <Toggle value={nightVision} onChange={setNightVision}/>
          </div>

          {/* Recent events */}
          {events.length>0 && <>
            <p style={st.settingSection}>🚨 Recent Events ({events.length})</p>
            <div style={{maxHeight:150,overflowY:'auto'}}>
              {events.slice(0,8).map((e)=>(
                <div key={e.id} style={{display:'flex',gap:8,fontSize:12,padding:'4px 0',borderBottom:`1px solid ${C.border}`,alignItems:'center'}}>
                  <span>{e.type==='motion'?'👁':'🔊'}</span>
                  <div style={{flex:1}}>
                    <span style={{color:C.text}}>{e.device}</span>
                    <span style={{color:C.sub,marginLeft:6}}>{e.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </>}
        </div>{/* end right settings card */}
      </div>{/* end grid */}

      {/* Clip Management Prompt Modal */}
      {showClipPrompt && (
        <div style={st.modal} onClick={()=>setShowClipPrompt(false)}>
          <div style={{...st.modalBox,maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <h2 style={{margin:'0 0 8px',color:C.green}}>📼 How should clips be saved?</h2>
            <p style={{color:C.sub,fontSize:13,marginBottom:20}}>Choose where recorded clips are stored when motion or sound is detected.</p>
            {[
              { id:'download', icon:'⬇️', title:'Download to this computer', desc:'Clips automatically download to your browser downloads folder.' },
              { id:'cloud',    icon:'☁️', title:'Upload to cloud storage',    desc:'Clips upload to DigitalOcean Spaces. Requires Pro subscription.' },
              { id:'both',     icon:'⬇️☁️', title:'Both — download + cloud', desc:'Save locally AND upload to cloud for redundancy.' },
            ].map(opt=>(
              <button key={opt.id} onClick={()=>armWithClipChoice(opt.id)} style={{
                display:'flex', alignItems:'center', gap:14, width:'100%',
                backgroundColor: clipManagement===opt.id ? '#1a2a1a' : C.card,
                border:`1.5px solid ${clipManagement===opt.id?C.green:C.border}`,
                borderRadius:10, padding:14, marginBottom:10, cursor:'pointer', textAlign:'left',
              }}>
                <span style={{fontSize:28}}>{opt.icon}</span>
                <div>
                  <div style={{color:C.text,fontWeight:'bold',fontSize:14}}>{opt.title}</div>
                  <div style={{color:C.sub,fontSize:12,marginTop:3}}>{opt.desc}</div>
                </div>
              </button>
            ))}
            <button style={{...st.btn,...st.btnGray,width:'100%',marginTop:4}} onClick={()=>setShowClipPrompt(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
function EventsPanel({ events }) {
  return (
    <div style={st.card}>
      <div style={{...st.flexBetween,marginBottom:12}}>
        <span style={{fontWeight:'bold',fontSize:14}}>🚨 All Events</span>
        <span style={{...st.badge,backgroundColor:'#ff444420',color:C.red,border:`1px solid ${C.red}`}}>{events.length}</span>
      </div>
      {events.length===0 && <div style={{color:C.sub,fontSize:13,textAlign:'center',padding:'40px 0'}}>No events yet — arm a camera to start monitoring</div>}
      <div style={{maxHeight:500,overflowY:'auto'}}>
        {events.map(e=>(
          <div key={e.id} style={{display:'flex',gap:10,padding:'10px 0',borderBottom:`1px solid ${C.border}`,alignItems:'center'}}>
            <span style={{fontSize:22}}>{e.type==='motion'?'👁':'🔊'}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:'bold',fontSize:13}}>{e.type==='motion'?'Motion Detected':'Sound Detected'}</div>
              <div style={{color:C.green,fontSize:12}}>{e.deviceName}</div>
              <div style={{color:C.sub,fontSize:11}}>{e.time} • {e.date} • {e.camMode==='security'?'Security Cam':'Dash Cam'}</div>
            </div>
            <span style={{
              ...st.badge,
              backgroundColor:e.camMode==='security'?'#4488ff20':'#00ff8820',
              color:e.camMode==='security'?C.blue:C.green,
              border:`1px solid ${e.camMode==='security'?C.blue+'60':C.green+'60'}`,
            }}>{e.camMode==='security'?'SEC CAM':'DASH'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Add Device Modal ─────────────────────────────────────────────
function AddDeviceModal({ onClose, onAdded }) {
  const [name,setName]=useState(''); const [loc,setLoc]=useState(''); const [loading,setLoading]=useState(false);
  const submit = async e => {
    e.preventDefault(); setLoading(true);
    try { await api.post('/api/devices',{name,location:loc,rtspUrl:''}); onAdded(); onClose(); }
    catch(ex) { alert(ex.response?.data?.message||'Failed'); }
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

// ─── Subscription Page ────────────────────────────────────────────
function SubscriptionPage() {
  const TIERS = {
    free:       { label:'Free',       price:'$0/mo',    color:C.sub,   features:['Local recording','Night Vision','1 camera','Basic motion alerts'] },
    pro:        { label:'Pro',        price:'$9.99/mo', color:C.green, features:['Everything in Free','Loop Forever recording','Cloud storage 50GB','5 cameras','Priority support','Web dashboard'] },
    enterprise: { label:'Enterprise', price:'$24.99/mo',color:C.gold,  features:['Everything in Pro','Unlimited cameras','Cloud storage 500GB','Multi-admin (3 users)','Advanced analytics','API access','White-label option'] },
  };
  const [current,setCurrent]=useState(localStorage.getItem('subscription')||'free');

  const subscribe = (tier) => {
    localStorage.setItem('subscription', tier);
    setCurrent(tier);
    if (tier === 'free') {
      alert('Downgraded to Free plan.');
    } else {
      alert(`✅ ${TIERS[tier].label} activated!\n\nAll ${TIERS[tier].label} features are now unlocked.\n\nNote: In production this would process payment first.`);
    }
  };

  return (
    <div style={{maxWidth:900,margin:'0 auto'}}>
      <h2 style={{color:C.green,marginBottom:4}}>⭐ Subscription</h2>
      <p style={{color:C.sub,marginBottom:8}}>Unlock the full power of Real Security Camera</p>
      <div style={{backgroundColor:'#ffd70015',border:`1px solid ${C.gold}`,borderRadius:8,padding:'10px 14px',marginBottom:20,fontSize:13,color:C.gold}}>
        🧪 <strong>Test Mode:</strong> All tiers are freely activatable. Click any plan to switch instantly.
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:16}}>
        {Object.entries(TIERS).map(([key,tier])=>(
          <div key={key} style={{...st.card, border:`2px solid ${current===key?tier.color:C.border}`, position:'relative'}}>
            {current===key && (
              <div style={{position:'absolute',top:-10,right:12,backgroundColor:tier.color,color:'#000',padding:'2px 10px',borderRadius:10,fontSize:11,fontWeight:'bold'}}>
                ACTIVE
              </div>
            )}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:20,fontWeight:'bold',color:tier.color}}>{tier.label}</div>
              <div style={{fontSize:18,color:C.text,marginTop:2,fontWeight:'bold'}}>{tier.price}</div>
            </div>
            <ul style={{paddingLeft:16,margin:'0 0 16px',color:'rgba(255,255,255,0.8)',fontSize:13}}>
              {tier.features.map((f,i)=>(
                <li key={i} style={{marginBottom:5}}>✓ {f}</li>
              ))}
            </ul>
            {current!==key ? (
              <button style={{
                ...st.btn, width:'100%', padding:12,
                backgroundColor: tier.color,
                color: key==='free' ? C.text : '#000',
              }} onClick={()=>subscribe(key)}>
                {key==='free' ? 'Switch to Free' : `Activate ${tier.label}`}
              </button>
            ) : (
              <div style={{textAlign:'center',padding:'10px',color:tier.color,fontWeight:'bold',fontSize:13}}>
                ✓ Current Plan
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{marginTop:24,backgroundColor:C.card,borderRadius:10,padding:16,border:`1px solid ${C.border}`}}>
        <p style={{color:C.text,fontWeight:'bold',marginBottom:8}}>💰 Pricing Breakdown</p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,fontSize:13}}>
          <div style={{color:C.sub}}>
            <div style={{color:C.text,marginBottom:4}}>Pro $9.99/mo covers:</div>
            <div>• 50GB storage (~$1/mo)</div>
            <div>• Server costs ~$2/mo</div>
            <div>• Bandwidth ~$1/mo</div>
            <div style={{color:C.green,marginTop:4}}>Margin: ~$6/mo</div>
          </div>
          <div style={{color:C.sub}}>
            <div style={{color:C.text,marginBottom:4}}>Enterprise $24.99/mo covers:</div>
            <div>• 500GB storage (~$10/mo)</div>
            <div>• Server costs ~$4/mo</div>
            <div>• Bandwidth ~$3/mo</div>
            <div style={{color:C.gold,marginTop:4}}>Margin: ~$8/mo</div>
          </div>
          <div style={{color:C.sub}}>
            <div style={{color:C.text,marginBottom:4}}>Storage rates:</div>
            <div>• DO Spaces: $0.02/GB/mo</div>
            <div>• Bandwidth: $0.01/GB</div>
            <div>• 1hr 1080p ≈ 2GB</div>
            <div style={{color:'#aaa',marginTop:4}}>Break-even: ~8 Pro users</div>
          </div>
        </div>
      </div>
      <p style={{color:'#444',fontSize:12,textAlign:'center',marginTop:16}}>
        Payments via Stripe · Cancel anytime · Data retained 30 days after cancellation
      </p>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email,setEmail]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState(''); const [loading,setLoading]=useState(false);
  const login = async e => {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const res = await api.post('/api/auth/login',{email,password:pw});
      localStorage.setItem('accessToken',res.data.data.accessToken);
      onLogin(res.data.data.accessToken);
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
          <button style={{...st.btn,...st.btnGreen,width:'100%',padding:12}} disabled={loading}>
            {loading?'Logging in...':'Login'}
          </button>
        </form>
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
  const [tab,        setTab]        = useState('cameras');
  const [showAdd,    setShowAdd]    = useState(false);
  const [toast,      setToast]      = useState('');
  const [user,       setUser]       = useState(null);
  const [onlineMap,  setOnlineMap]  = useState({});
  const [settingsFor,setSettingsFor]= useState(null);
  const [deviceSettings,setDeviceSettings]=useState({});

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(()=>{
    if (!token) return;
    try { const p=JSON.parse(atob(token.split('.')[1])); setUser(p); } catch {}
  },[token]);

  const loadDevices = useCallback(async()=>{
    if (!token) return;
    try { const res=await api.get('/api/devices'); setDevices(res.data.data||[]); } catch {}
  },[token]);

  // Also fetch active streams to show socket-connected cameras
  const loadStreams = useCallback(async()=>{
    if (!token) return;
    try {
      const res = await api.get('/api/streaming/streams');
      const streams = res.data.data || [];
      // Mark any stream-connected cameras as online
      streams.forEach(s=>{
        if (s.online) setOnlineMap(m=>({...m,[s.deviceId]:{online:true,name:s.deviceName}}));
      });
    } catch {}
  },[token]);

  useEffect(()=>{ loadDevices(); },[loadDevices]);
  useEffect(()=>{ loadStreams(); const t=setInterval(loadStreams,10000); return()=>clearInterval(t); },[loadStreams]);

  useEffect(()=>{
    if (!token||!user) return;
    const s = io(API,{auth:{token},transports:['websocket','polling']});
    s.on('connect',()=>{
      const orgId = user.organizationId || user.org_id || user.organization_id;
      s.emit('auth',{userId:user.userId||user.id,organizationId:orgId,role:'viewer',deviceName:'Web Dashboard'});
      showToast('Connected to streaming server');
      // After connecting, fetch current active streams to catch already-online cameras
      setTimeout(async()=>{
        try {
          const res = await api.get('/api/streaming/streams');
          const streams = res.data?.data || [];
          streams.forEach(s=>{
            if (s.online) setOnlineMap(m=>({...m,[s.deviceId]:{online:true,name:s.deviceName}}));
          });
        } catch {}
      }, 2000);
    });
    s.on('camera:online', ({deviceId,deviceName})=>{
      console.log('📷 Web received camera:online:', deviceName, deviceId);
      setOnlineMap(m=>({...m,[deviceId]:{online:true,name:deviceName}}));
      setEvents(ev=>[{type:'system',id:Date.now(),deviceName,time:new Date().toLocaleTimeString(),message:`${deviceName} came online`},...ev]);
    });
    s.on('camera:offline',({deviceId})=>{
      setOnlineMap(m=>({...m,[deviceId]:{...(m[deviceId]||{}),online:false}}));
    });
    s.on('disconnect',()=>showToast('Disconnected from server'));
    setSocket(s);
    return ()=>s.disconnect();
  },[token,user]);

  const logout = ()=>{ localStorage.removeItem('accessToken'); setToken(null); setSocket(null); };

  if (!token) return <LoginPage onLogin={setToken}/>;

  const TABS = [
    {id:'cameras', label:'📷 Cameras'},
    {id:'usb',     label:'🖥️ USB/Webcam'},
    {id:'events',  label:'🚨 Events'},
    {id:'sub',     label:'⭐ Subscription'},
  ];

  const switchTab = (newTab) => {
    // If switching away from cameras while watching, warn
    if (tab==='cameras' && newTab!=='cameras') {
      // Just switch — streams will reconnect when coming back
    }
    setTab(newTab);
  };

  return (
    <div style={st.app}>
      <nav style={st.nav}>
        <h1 style={st.navTitle}>🔒 Real Security Camera</h1>
        <div style={st.navRight}>
          <span style={{color:C.sub,fontSize:13}}>{user?.email}</span>
          <button style={{...st.btn,...st.btnRed}} onClick={logout}>Logout</button>
        </div>
      </nav>

      <main style={st.main}>
        {/* Stats */}
        <div style={st.statRow}>
          <div style={st.stat}>
            <p style={st.statN}>
              {/* Total = DB devices + any socket cameras not in DB */}
              {new Set([...devices.map(d=>d.id), ...Object.keys(onlineMap)]).size}
            </p>
            <p style={st.statL}>Total Cameras</p>
          </div>
          <div style={st.stat}>
            <p style={{...st.statN,color:C.green}}>
              {/* Online = anything in onlineMap that is online, plus active DB devices */}
              {new Set([
                ...devices.filter(d=>d.is_active||onlineMap[d.id]?.online||onlineMap[d.id]===true).map(d=>d.id),
                ...Object.entries(onlineMap).filter(([,v])=>v?.online||v===true).map(([k])=>k)
              ]).size}
            </p>
            <p style={st.statL}>Online Now</p>
          </div>
          <div style={st.stat}>
            <p style={{...st.statN,color:C.red}}>{events.length}</p>
            <p style={st.statL}>Events Today</p>
          </div>
          <div style={st.stat}>
            <p style={{...st.statN,color:socket?.connected?C.green:C.red}}>{socket?.connected?'●':'○'}</p>
            <p style={st.statL}>{socket?.connected?'Connected':'Offline'}</p>
          </div>
        </div>

        {/* Tabs */}
        <div style={st.tabs}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>switchTab(t.id)} style={{
              ...st.tab,
              backgroundColor:tab===t.id?C.green:C.card,
              color:tab===t.id?'#000':C.text,
              border:tab===t.id?'none':`1px solid ${C.border}`,
            }}>{t.label}</button>
          ))}
          {tab==='cameras' && <button style={{...st.btn,...st.btnGreen,marginLeft:'auto'}} onClick={()=>setShowAdd(true)}>+ Add Camera</button>}
        </div>

        {/* Cameras */}
        {/* Keep all tabs mounted, just hide inactive ones */}
        <div style={{display: tab==='cameras' ? 'block' : 'none'}}>
          {devices.length===0
            ? <div style={{...st.card,textAlign:'center',padding:40,color:C.sub}}>
                <div style={{fontSize:48}}>📷</div>
                <div style={{marginTop:12}}>No cameras yet. Click "+ Add Camera" above.</div>
              </div>
            : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:16}}>
                {devices.map(d=>(
                  <CameraCard key={d.id}
                    device={{...d,online:onlineMap[d.id]?.online||onlineMap[d.id]===true||d.is_active}}
                    socket={socket}
                    onEvent={e=>setEvents(ev=>[e,...ev])}
                    settings={deviceSettings[d.id]}
                    onSettings={()=>setSettingsFor(d)}
                  />
                ))}
              </div>
          }
        </div>

        <div style={{display: tab==='usb' ? 'block' : 'none'}}>
          <USBCameraPage socket={socket} devices={devices} userId={user?.userId} organizationId={user?.organizationId} onEvent={e=>setEvents(ev=>[e,...ev])}/>
        </div>
        <div style={{display: tab==='events' ? 'block' : 'none'}}>
          <EventsPanel events={events}/>
        </div>
        <div style={{display: tab==='sub' ? 'block' : 'none'}}>
          <SubscriptionPage/>
        </div>
      </main>

      {showAdd && <AddDeviceModal onClose={()=>setShowAdd(false)} onAdded={()=>{ loadDevices(); showToast('Camera added!'); }}/>}

      {settingsFor && (
        <CameraSettingsPanel
          device={settingsFor}
          settings={deviceSettings[settingsFor.id]}
          onChange={s=>setDeviceSettings(p=>({...p,[settingsFor.id]:s}))}
          onClose={()=>setSettingsFor(null)}
        />
      )}

      {toast && <div style={st.toast}>{toast}</div>}
    </div>
  );
}
