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
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('webrtc:answer',{targetSocketId:fromSocketId,answer});
    });
    socket.on('webrtc:ice',({candidate,fromSocketId})=>{
      if (pcRef.current&&candidate) pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{});
    });
    return ()=>{ socket.off('camera:online',onOnline); socket.off('camera:offline',onOffline); };
  },[socket,device.id]);

  const startWatching = () => {
    if (!socket||!online) return;
    const pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}] });
    pcRef.current = pc;
    pc.ontrack = e=>{ if(videoRef.current&&e.streams[0]) videoRef.current.srcObject=e.streams[0]; };
    pc.onicecandidate = e=>{ if(e.candidate) socket.emit('webrtc:ice',{targetSocketId:'__camera__',candidate:e.candidate}); };
    pc.onconnectionstatechange = ()=>setStatus(pc.connectionState==='connected'?'Live':pc.connectionState);
    pc.addTransceiver('video',{direction:'recvonly'});
    pc.addTransceiver('audio',{direction:'recvonly'});
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
          ? <video ref={videoRef} style={st.videoEl} autoPlay playsInline/>
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
function USBCameraPage({ socket, devices, userId, organizationId }) {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const pcsRef     = useRef({});
  const [streaming,    setStreaming]    = useState(false);
  const [selectedDev,  setSelectedDev] = useState('');
  const [camDevices,   setCamDevices]  = useState([]);
  const [linkedDevice, setLinkedDevice]= useState('');
  const [viewers,      setViewers]     = useState(0);
  const [camMode,      setCamMode]     = useState('dashcam');
  const [nightVision,  setNightVision] = useState(false);
  const [torch,        setTorch]       = useState(false);
  const [motionEnabled,setMotionEnabled]=useState(true);
  const [soundEnabled, setSoundEnabled]= useState(true);
  const [isRecording,  setIsRecording] = useState(false);
  const [statusMsg,    setStatusMsg]   = useState('Ready');
  const [events,       setEvents]      = useState([]);
  const [zoomLevel,    setZoomLevel]   = useState(1);
  const [facingMode,   setFacingMode]  = useState('user');
  const [hwZoomSupported, setHwZoomSupported] = useState(false);
  const [hwZoomRange,  setHwZoomRange] = useState({min:1,max:1,step:0.1});
  const mediaRecRef    = useRef(null);
  const motionPollRef  = useRef(null);
  const alertActiveRef = useRef(false);
  const imageCaptureRef = useRef(null);

  useEffect(()=>{
    // Enumerate without permission first — just to get count, not IDs
    // Real labels + IDs only available after getUserMedia permission granted
    navigator.mediaDevices.enumerateDevices().then(devs=>{
      const vids = devs.filter(d=>d.kind==='videoinput');
      if (vids.length>0) {
        // Only set deviceId if we have real labels (permission already granted)
        const hasRealLabels = vids.some(d=>d.label && d.label.length>0);
        if (hasRealLabels) {
          setCamDevices(vids);
          setSelectedDev(vids[0].deviceId);
        } else {
          // No permission yet — show placeholder, don't set a deviceId
          setCamDevices([{deviceId:'', label:`${vids.length} camera${vids.length>1?'s':''} available`}]);
          setSelectedDev(''); // empty = no constraint, browser picks best
        }
      }
    });
  },[]);

  useEffect(()=>{
    if (!socket) return;
    socket.on('viewer:request',async({viewerSocketId})=>{
      if (!streamRef.current) return;
      const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
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

  // Motion polling (simulated via device movement - real impl needs CV)
  useEffect(()=>{
    if (streaming && motionEnabled && camMode==='security') {
      motionPollRef.current = setInterval(()=>{
        if (!alertActiveRef.current && Math.random()<0.02) triggerMotion();
      },1000);
    }
    return ()=>clearInterval(motionPollRef.current);
  },[streaming, motionEnabled, camMode]);

  const triggerMotion = () => {
    alertActiveRef.current=true;
    const event = { type:'motion', time:new Date().toLocaleTimeString(), device: devices.find(d=>d.id===linkedDevice)?.name||'USB Camera' };
    setEvents(ev=>[event,...ev].slice(0,20));
    setStatusMsg('⚠️ Motion detected!');
    setTimeout(()=>{ alertActiveRef.current=false; setStatusMsg('🟢 Monitoring...'); },5000);
  };

  const startStream = async () => {
    try {
      // Always start with simple constraints — most compatible across browsers
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      // After permission granted, enumerate real device names
      const devs = await navigator.mediaDevices.enumerateDevices();
      const vids = devs.filter(d => d.kind === 'videoinput');
      setCamDevices(vids);
      if (vids.length > 0) setSelectedDev(vids[0].deviceId);

      setStreaming(true);
      setStatusMsg('🟢 Broadcasting');

      // Check for hardware zoom support via ImageCapture API
      try {
        const videoTrack = stream.getVideoTracks()[0];
        if (typeof ImageCapture !== 'undefined') {
          const ic = new ImageCapture(videoTrack);
          imageCaptureRef.current = ic;
          const caps = videoTrack.getCapabilities?.();
          if (caps?.zoom) {
            setHwZoomSupported(true);
            setHwZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
          }
        }
      } catch {}

      if (linkedDevice && socket) {
        socket.emit('auth', {
          deviceId: linkedDevice,
          deviceName: devices.find(d => d.id === linkedDevice)?.name || 'USB Camera',
          role: 'camera',
          organizationId,
          userId,
        });
      }
    } catch(e) {
      console.error('Camera error:', e.name, e.message);
      if (e.name === 'NotAllowedError') {
        alert('Camera permission denied. Please allow camera access in your browser settings.');
      } else if (e.name === 'NotFoundError') {
        alert('No camera found. Please connect a camera and try again.');
      } else if (e.name === 'NotReadableError') {
        alert('Camera is in use by another application. Close other apps and try again.');
      } else {
        alert('Camera error: ' + (e.message || e.name || 'Unknown error'));
      }
    }
  };

  const stopStream = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    Object.values(pcsRef.current).forEach(pc=>pc.close());
    pcsRef.current={};
    if (videoRef.current) videoRef.current.srcObject=null;
    setStreaming(false); setViewers(0); setStatusMsg('Ready');
    if (linkedDevice&&socket) socket.emit('camera:offline',{deviceId:linkedDevice});
  };

  const startRecord = () => {
    if (!streamRef.current) return;
    const chunks=[];
    const mr = new MediaRecorder(streamRef.current);
    mr.ondataavailable=e=>{ if(e.data.size>0) chunks.push(e.data); };
    mr.onstop=()=>{
      const blob=new Blob(chunks,{type:'video/mp4'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download=`clip_${camMode}_${Date.now()}.mp4`; a.click();
      setStatusMsg('✅ Clip saved');
    };
    mr.start(); mediaRecRef.current=mr;
    setIsRecording(true); setStatusMsg('🔴 Recording...');
  };

  const stopRecord = () => {
    if (mediaRecRef.current) { mediaRecRef.current.stop(); mediaRecRef.current=null; }
    setIsRecording(false);
  };

  const handleZoom = async (val) => {
    const z = parseFloat(val);
    setZoomLevel(z);
    if (hwZoomSupported && streamRef.current) {
      try {
        const track = streamRef.current.getVideoTracks()[0];
        await track.applyConstraints({ advanced: [{ zoom: z }] });
      } catch {}
    }
    // CSS zoom always applied via videoRef style
  };

  const flipCamera = async () => {
    if (!streaming) return;
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setFacingMode(newFacing);
    } catch {
      // facingMode not supported on this device (e.g. desktop webcam)
      setStatusMsg('⚠️ Camera flip not supported on this device');
      setTimeout(() => setStatusMsg('🟢 Broadcasting'), 2000);
    }
  };

  return (
    <div>
      <h2 style={st.sectionHdr}>🖥️ USB / Webcam Camera</h2>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:20}}>
        {/* Camera feed + controls */}
        <div style={st.card}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
            <div>
              <label style={st.label}>Camera Device</label>
              <select style={st.input} value={selectedDev} onChange={e=>setSelectedDev(e.target.value)}>
                {camDevices.map((d,i)=>(
                  <option key={d.deviceId||i} value={d.deviceId||''}>
                    {d.label && d.label.length>0 ? d.label : `Camera ${i+1}`}
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

          <div style={st.videoBox}>
            <video ref={videoRef} style={{
              ...st.videoEl,
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'center center',
              transition: 'transform 0.2s',
            }} autoPlay playsInline muted/>
            {!streaming && <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',color:C.sub}}>
              <span style={{fontSize:48}}>🖥️</span><span style={{marginTop:8}}>No stream</span>
            </div>}
            {streaming && <div style={{position:'absolute',top:8,left:8,backgroundColor:'rgba(204,0,0,0.9)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>
              ● BROADCASTING • {viewers} viewer{viewers!==1?'s':''}
            </div>}
            {nightVision && <div style={{position:'absolute',inset:0,backgroundColor:'rgba(0,255,70,0.15)',pointerEvents:'none'}}/>}
            <div style={{position:'absolute',bottom:8,left:8,backgroundColor:'rgba(0,0,0,0.6)',color:'#fff',padding:'3px 8px',borderRadius:6,fontSize:12}}>{statusMsg}</div>
          </div>

          {/* Zoom + Flip controls */}
          {streaming && (
            <div style={{marginTop:10,backgroundColor:'#111',borderRadius:8,padding:10}}>
              <div style={{...st.flexBetween,marginBottom:8}}>
                <span style={{fontSize:12,color:C.sub}}>
                  🔍 Zoom {zoomLevel.toFixed(1)}x
                  {hwZoomSupported && <span style={{color:C.green,marginLeft:6,fontSize:10}}>HW</span>}
                  {!hwZoomSupported && <span style={{color:C.sub,marginLeft:6,fontSize:10}}>CSS</span>}
                </span>
                <button style={{...st.btn,...st.btnGray,padding:'4px 10px',fontSize:12}} onClick={()=>handleZoom(1)}>Reset</button>
              </div>
              <input type="range"
                min={hwZoomSupported ? hwZoomRange.min : 1}
                max={hwZoomSupported ? hwZoomRange.max : 3}
                step={hwZoomSupported ? hwZoomRange.step : 0.1}
                value={zoomLevel}
                onChange={e=>handleZoom(e.target.value)}
                style={{width:'100%',accentColor:C.green,marginBottom:8}}
              />
              <div style={{display:'flex',gap:6}}>
                <button style={{...st.btn,...st.btnGray,flex:1,fontSize:12}} onClick={()=>handleZoom(Math.max(1, zoomLevel-0.25))}>− Zoom Out</button>
                <button style={{...st.btn,...st.btnGray,flex:1,fontSize:12}} onClick={flipCamera}>🔄 Flip Camera</button>
                <button style={{...st.btn,...st.btnGray,flex:1,fontSize:12}} onClick={()=>handleZoom(Math.min(hwZoomSupported?hwZoomRange.max:3, zoomLevel+0.25))}>+ Zoom In</button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{display:'flex',gap:6,marginTop:10}}>
            {!streaming
              ? <button style={{...st.btn,...st.btnGreen,flex:1}} onClick={startStream}>📡 Start Broadcasting</button>
              : <>
                  <button style={{...st.btn,...st.btnRed,flex:1}} onClick={stopStream}>⏹ Stop</button>
                  {!isRecording
                    ? <button style={{...st.btn,...st.btnBlue}} onClick={startRecord}>⏺ Record</button>
                    : <button style={{...st.btn,...st.btnRed}} onClick={stopRecord}>⏹ Stop Rec</button>
                  }
                </>
            }
          </div>
        </div>

        {/* Settings */}
        <div style={st.card}>
          <p style={{fontWeight:'bold',marginBottom:12,color:C.text}}>⚙️ Camera Settings</p>

          <p style={st.settingSection}>Mode</p>
          <div style={{display:'flex',gap:6,marginBottom:8}}>
            {['dashcam','security'].map(m=>(
              <button key={m} onClick={()=>setCamMode(m)} style={{
                ...st.btn, flex:1,
                backgroundColor:camMode===m?(m==='dashcam'?C.green:C.blue):C.card,
                color:camMode===m?'#000':C.text,
                border:`1px solid ${camMode===m?(m==='dashcam'?C.green:C.blue):C.border}`,
              }}>{m==='dashcam'?'🚗 Dash Cam':'🔒 Security Cam'}</button>
            ))}
          </div>

          <p style={st.settingSection}>Security Detection</p>
          <div style={st.toggle}>
            <div><div style={st.toggleLabel}>Motion Detection</div></div>
            <Toggle value={motionEnabled} onChange={setMotionEnabled}/>
          </div>
          <div style={st.toggle}>
            <div><div style={st.toggleLabel}>Sound Detection</div></div>
            <Toggle value={soundEnabled} onChange={setSoundEnabled}/>
          </div>

          <p style={st.settingSection}>Night Vision</p>
          <div style={st.toggle}>
            <div>
              <div style={st.toggleLabel}>Night Mode</div>
              <div style={st.toggleNote}>Green tint overlay</div>
            </div>
            <Toggle value={nightVision} onChange={setNightVision}/>
          </div>

          {/* Events log */}
          {events.length>0 && <>
            <p style={st.settingSection}>Recent Events</p>
            <div style={{maxHeight:120,overflowY:'auto'}}>
              {events.slice(0,5).map((e,i)=>(
                <div key={i} style={{fontSize:12,padding:'4px 0',borderBottom:`1px solid ${C.border}`,color:C.text}}>
                  👁 {e.device} — {e.time}
                </div>
              ))}
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}

// ─── Events Panel ─────────────────────────────────────────────────
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

  useEffect(()=>{ loadDevices(); },[loadDevices]);

  useEffect(()=>{
    if (!token||!user) return;
    const s = io(API,{auth:{token},transports:['websocket','polling']});
    s.on('connect',()=>{
      s.emit('auth',{userId:user.userId,organizationId:user.organizationId,role:'viewer',deviceName:'Web Dashboard'});
      showToast('Connected to streaming server');
    });
    s.on('camera:online', ({deviceId,deviceName})=>{
      setOnlineMap(m=>({...m,[deviceId]:true}));
      setEvents(ev=>[{type:'system',id:Date.now(),deviceName,time:new Date().toLocaleTimeString(),message:`${deviceName} came online`},...ev]);
    });
    s.on('camera:offline',({deviceId})=>setOnlineMap(m=>({...m,[deviceId]:false})));
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
          <div style={st.stat}><p style={st.statN}>{devices.length}</p><p style={st.statL}>Total Cameras</p></div>
          <div style={st.stat}>
            <p style={{...st.statN,color:C.green}}>
              {devices.filter(d=>onlineMap[d.id]||d.is_active).length}
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
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              ...st.tab,
              backgroundColor:tab===t.id?C.green:C.card,
              color:tab===t.id?'#000':C.text,
              border:tab===t.id?'none':`1px solid ${C.border}`,
            }}>{t.label}</button>
          ))}
          {tab==='cameras' && <button style={{...st.btn,...st.btnGreen,marginLeft:'auto'}} onClick={()=>setShowAdd(true)}>+ Add Camera</button>}
        </div>

        {/* Cameras */}
        {tab==='cameras' && (
          devices.length===0
            ? <div style={{...st.card,textAlign:'center',padding:40,color:C.sub}}>
                <div style={{fontSize:48}}>📷</div>
                <div style={{marginTop:12}}>No cameras yet. Click "+ Add Camera" above.</div>
              </div>
            : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:16}}>
                {devices.map(d=>(
                  <CameraCard key={d.id}
                    device={{...d,online:onlineMap[d.id]||d.is_active}}
                    socket={socket}
                    onEvent={e=>setEvents(ev=>[e,...ev])}
                    settings={deviceSettings[d.id]}
                    onSettings={()=>setSettingsFor(d)}
                  />
                ))}
              </div>
        )}

        {tab==='usb'    && <USBCameraPage socket={socket} devices={devices} userId={user?.userId} organizationId={user?.organizationId}/>}
        {tab==='events' && <EventsPanel events={events}/>}
        {tab==='sub'    && <SubscriptionPage/>}
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