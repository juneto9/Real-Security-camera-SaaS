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

// ─── Theme Definitions ───────────────────────────────────────────
const THEMES = {
  operator: {
    name:'🟢 Operator',
    bg:'#050505', surface:'#0f0f0f', card:'#141414',
    green:'#00ff88', blue:'#00aaff', red:'#ff3333',
    gold:'#ffd700', text:'#ffffff', sub:'#555555', border:'#1a1a1a',
    radius:6, font:'monospace',
  },
  life360: {
    name:'🔵 Guardian',
    bg:'#f0f2f5', surface:'#ffffff', card:'#ffffff',
    green:'#1a73e8', blue:'#1a73e8', red:'#ea4335',
    gold:'#fbbc04', text:'#1a1a1a', sub:'#888888', border:'#e0e0e0',
    radius:16, font:'system-ui,sans-serif',
  },
  bubble: {
    name:'🍎 Frost',
    bg:'#f2f2f7', surface:'rgba(255,255,255,0.85)', card:'rgba(255,255,255,0.85)',
    green:'#34c759', blue:'#007aff', red:'#ff3b30',
    gold:'#ff9500', text:'#000000', sub:'#8e8e93', border:'rgba(0,0,0,0.08)',
    radius:22, font:'-apple-system,BlinkMacSystemFont,sans-serif',
  },
  custom: {
    name:'🎨 Custom',
    bg:'#0a0a0a', surface:'#111', card:'#1a1a1a',
    green:'#00ff88', blue:'#4488ff', red:'#ff4444',
    gold:'#ffd700', text:'#ffffff', sub:'#666666', border:'#222222',
    radius:10, font:'system-ui,sans-serif',
  },
  urban: {
    name:'🏙 Urban',
    bg:'#1a1a18', surface:'#242420', card:'#2e2e28',
    green:'#ff6b00', blue:'#c8c8b4', red:'#ff2244',
    gold:'#f0e040', text:'#e8e8d8', sub:'#7a7a68', border:'#3a3a32',
    radius:2, font:"'Arial Black',impact,sans-serif",
  },
  psychedelic: {
    name:'🌀 Psychedelic',
    bg:'#0d0015', surface:'#150025', card:'#1e0035',
    green:'#00ffaa', blue:'#ff00ff', red:'#ff2200',
    gold:'#ffee00', text:'#f0e0ff', sub:'#9966cc', border:'#4400aa',
    radius:20, font:"'Georgia',serif",
  },
  modern: {
    name:'⚪ Modern',
    bg:'#f5f5f3', surface:'#ffffff', card:'#ffffff',
    green:'#0066ff', blue:'#0066ff', red:'#ff3300',
    gold:'#ff6600', text:'#111111', sub:'#999999', border:'#e8e8e8',
    radius:4, font:"'Helvetica Neue',helvetica,sans-serif",
  },
  jazz: {
    name:'🎷 Jazz',
    bg:'#0a0810', surface:'#12101a', card:'#1a1628',
    green:'#c9a84c', blue:'#7b5ea7', red:'#c0392b',
    gold:'#c9a84c', text:'#e8dcc8', sub:'#7a6a58', border:'#2a2038',
    radius:8, font:"'Georgia','Times New Roman',serif",
  },
  graffiti: {
    name:'🖌 Graffiti',
    bg:'#0f0f0f', surface:'#1a1a1a', card:'#222',
    green:'#39ff14', blue:'#00cfff', red:'#ff073a',
    gold:'#ffe600', text:'#ffffff', sub:'#888', border:'#333',
    radius:0, font:"'Arial Black',impact,sans-serif",
  },
  farmlife: {
    name:'🐄 Farm Life',
    bg:'#f5f0e8', surface:'#fdfaf4', card:'#fff8ec',
    green:'#5a8a3c', blue:'#4a7ab5', red:'#c0392b',
    gold:'#d4a017', text:'#3d2b1f', sub:'#8b7355', border:'#d4c4a0',
    radius:12, font:"'Georgia',serif",
  },
  sunflower: {
    name:'🌻 Sunflower',
    bg:'#1a1200', surface:'#251a00', card:'#302200',
    green:'#ffcc00', blue:'#ff9900', red:'#ff4400',
    gold:'#ffdd00', text:'#fff8e0', sub:'#aa8800', border:'#443300',
    radius:16, font:"'Georgia',serif",
  },
  butterfly: {
    name:'🦋 Butterfly',
    bg:'#0f001a', surface:'#1a0030', card:'#220040',
    green:'#cc44ff', blue:'#ff88ee', red:'#ff2288',
    gold:'#ffcc88', text:'#ffe0ff', sub:'#bb66cc', border:'#440066',
    radius:24, font:"-apple-system,'SF Pro Display',sans-serif",
  },
  rose: {
    name:'🌹 Rose',
    bg:'#1a0008', surface:'#250010', card:'#300018',
    green:'#ff4488', blue:'#ff88aa', red:'#ff0044',
    gold:'#ffcc88', text:'#ffe8ee', sub:'#cc6688', border:'#550022',
    radius:18, font:"'Georgia',serif",
  },
};

function getTheme() {
  try {
    const saved = localStorage.getItem('rsc_theme')||'operator';
    const custom = localStorage.getItem('rsc_custom_theme');
    if (saved==='custom' && custom) return {...THEMES.custom,...JSON.parse(custom)};
    return THEMES[saved]||THEMES.operator;
  } catch { return THEMES.operator; }
}

// Active theme — components import this
let C = getTheme();

// Refresh C when theme changes
function refreshTheme() {
  C = getTheme();
}

const st = {
  app:         { minHeight:'100vh', backgroundColor:C.bg, color:C.text, fontFamily:C.font||'system-ui,sans-serif' },
  nav:         { backgroundColor:C.surface||C.card, padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, zIndex:100 },
  navTitle:    { color:C.green, fontSize:20, fontWeight:'bold', margin:0 },
  navRight:    { display:'flex', alignItems:'center', gap:12 },
  btn:         { padding:'8px 16px', borderRadius:C.radius||6, border:'none', cursor:'pointer', fontWeight:'bold', fontSize:13 },
  btnGreen:    { backgroundColor:C.green, color:'#000' },
  btnRed:      { backgroundColor:C.red, color:'#fff' },
  btnGray:     { backgroundColor:C.card, color:C.text, border:`1px solid ${C.border}` },
  btnGold:     { backgroundColor:'transparent', color:C.gold, border:`1px solid ${C.gold}` },
  btnBlue:     { backgroundColor:C.blue, color:'#fff' },
  main:        { padding:24, maxWidth:1400, margin:'0 auto' },
  card:        { backgroundColor:C.card, borderRadius:C.radius||12, padding:16, border:`1px solid ${C.border}` },
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
  modal:       { position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:400, padding:16 },
  modalBox:    { backgroundColor:C.surface, borderRadius:12, padding:24, width:'100%', maxWidth:520, border:`1px solid ${C.border}`, maxHeight:'90vh', overflowY:'auto' },
  toast:       { position:'fixed', bottom:20, right:20, backgroundColor:C.green, color:'#000', padding:'12px 20px', borderRadius:10, fontWeight:'bold', zIndex:300, fontSize:14, boxShadow:'0 4px 20px rgba(0,255,136,0.4)', maxWidth:340 },
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
function CameraSettingsPanel({ device, settings, onChange, onClose, onDeviceUpdated }) {
  const [s, setS] = useState(settings || {
    camMode: 'security',
    loopForever: false,
    loopDuration: 60,
    clipSize: 60,
    motionEnabled: true,
    soundEnabled: true,
    nightVision: false,
    nightVisionPro: false,
    cloudUpload: true,   // default ON — uploads already happening
  });
  const [devName,     setDevName]     = useState(device.name?.trim() || device.device_name?.trim() || '');
  const [devLocation, setDevLocation] = useState(device.location?.trim() || '');
  // Sync with device prop when modal opens with different device
  React.useEffect(() => {
    setDevName(device.name?.trim() || device.device_name?.trim() || '');
    setDevLocation(device.location?.trim() || '');
    setDevRtsp(device.rtsp_url || '');
  }, [device.id, device.name, device.device_name]);
  const [devRtsp,     setDevRtsp]     = useState(device.rtsp_url || '');
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState('');
  const [deleting,    setDeleting]    = useState(false);

  const update = (key, val) => setS(p => ({ ...p, [key]: val }));

  const save = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await api.put(`/api/devices/${device.id}`, {
        name: devName,
        location: devLocation,
        rtsp_url: devRtsp,
        is_motion_detection_enabled: s.motionEnabled,
      });
      setSaveMsg('✅ Saved!');
      if (onDeviceUpdated) onDeviceUpdated({ ...device, name: devName, location: devLocation, rtsp_url: devRtsp });
      onChange(s);
      setTimeout(() => { setSaveMsg(''); onClose(); }, 800);
    } catch(e) {
      setSaveMsg('❌ ' + (e.response?.data?.message || e.message));
    }
    setSaving(false);
  };

  const deleteDevice = async () => {
    if (!window.confirm(`Delete "${devName}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/api/devices/${device.id}`);
      if (onDeviceUpdated) onDeviceUpdated(null); // null = deleted
      onClose();
    } catch(e) {
      alert('Delete failed: ' + (e.response?.data?.message || e.message));
    }
    setDeleting(false);
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
          <h2 style={{margin:0, color:C.green}}>⚙️ Camera Settings</h2>
          <button style={{...st.btn,...st.btnGray}} onClick={onClose}>✕</button>
        </div>

        {/* Device Info */}
        <p style={st.settingSection}>📷 Device Info</p>
        <div style={{marginBottom:8}}>
          <label style={{color:C.sub,fontSize:12,display:'block',marginBottom:4}}>Camera Name</label>
          <input value={devName} onChange={e=>setDevName(e.target.value)}
            placeholder="Camera name"
            style={{width:'100%',padding:'8px 10px',background:C.input,border:`1px solid ${C.border}`,
              borderRadius:6,color:C.text,fontSize:13,boxSizing:'border-box'}}/>
        </div>
        <div style={{marginBottom:8}}>
          <label style={{color:C.sub,fontSize:12,display:'block',marginBottom:4}}>Location</label>
          <input value={devLocation} onChange={e=>setDevLocation(e.target.value)}
            placeholder="e.g. Front door, Living room"
            style={{width:'100%',padding:'8px 10px',background:C.input,border:`1px solid ${C.border}`,
              borderRadius:6,color:C.text,fontSize:13,boxSizing:'border-box'}}/>
        </div>
        <div style={{marginBottom:16}}>
          <label style={{color:C.sub,fontSize:12,display:'block',marginBottom:4}}>
            RTSP URL <span style={{color:C.sub,fontWeight:'normal'}}>(IP cameras)</span>
          </label>
          <input value={devRtsp} onChange={e=>setDevRtsp(e.target.value)}
            placeholder="rtsp://user:pass@192.168.x.x:554/stream"
            style={{width:'100%',padding:'8px 10px',background:C.input,border:`1px solid ${C.border}`,
              borderRadius:6,color:C.text,fontSize:13,boxSizing:'border-box'}}/>
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
        <p style={st.settingSection}>📁 Recording Mode</p>
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
          <button style={{...st.btn,backgroundColor:'#3d1a1a',color:C.red,border:`1px solid ${C.red}40`}}
            onClick={deleteDevice} disabled={deleting}>
            {deleting?'Deleting...':'🗑 Delete'}
          </button>
          <button style={{...st.btn,...st.btnGray, flex:1}} onClick={onClose}>Cancel</button>
          <button style={{...st.btn,...st.btnGreen, flex:2, opacity:saving?0.6:1}}
            onClick={save} disabled={saving}>
            {saving?'Saving...':'Save Settings'}
          </button>
          {saveMsg && <div style={{width:'100%',textAlign:'center',fontSize:12,marginTop:4,
            color:saveMsg.startsWith('✅')?C.green:C.red}}>{saveMsg}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Camera Viewer Card ───────────────────────────────────────────
// ─── RTSP Relay Viewer ────────────────────────────────────────────
// Connects to /relay namespace, requests stream from agent,
// plays fMP4 chunks via MSE. Works from ANYWHERE remotely.
function RTSPViewer({ device, onClose, orgId: propOrgId }) {
  const videoRef    = useRef(null);
  const msRef       = useRef(null);   // MediaSource
  const sbRef       = useRef(null);   // SourceBuffer
  const queueRef    = useRef([]);     // pending chunks
  const relayRef    = useRef(null);   // relay socket
  const [status,    setStatus]    = useState('Connecting...');
  const [agentOk,   setAgentOk]   = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    const RELAY_URL = 'https://whale-app-hxokg.ondigitalocean.app';
    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('rsc_token') || '';
    const orgId = propOrgId || device.organization_id || sessionStorage.getItem('rsc_org_id') || localStorage.getItem('rsc_org_id') || '';

    // Connect to relay namespace
    const relaySocket = window.io(RELAY_URL + '/relay', {
      auth: { token },
      transports: ['websocket'],
    });
    relayRef.current = relaySocket;

    relaySocket.on('connect', () => {
      setStatus('Requesting stream from local agent...');
      relaySocket.emit('viewer:request-stream', {
        deviceId: device.id,
        orgId,
      });
    });

    relaySocket.on('connect_error', (err) => {
      setError('Cannot connect to relay server: ' + err.message);
    });

    relaySocket.on('relay:waiting-for-agent', ({ message }) => {
      setStatus('⏳ ' + message);
    });

    relaySocket.on('relay:stream-ready', ({ mimeType, deviceName }) => {
      setStatus(`🎥 Stream starting for ${deviceName || device.name}...`);
      setAgentOk(true);
      setupMSE(mimeType || 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
    });

    relaySocket.on('relay:stream-chunk', ({ chunk, isInit }) => {
      const binary = Uint8Array.from(atob(chunk), c => c.charCodeAt(0));
      appendChunk(binary);
    });

    relaySocket.on('relay:stream-ended', () => {
      setStatus('Stream ended');
      setAgentOk(false);
    });

    relaySocket.on('relay:stream-error', ({ message }) => {
      setError(message);
      setStatus('');
    });

    return () => {
      relaySocket.emit('viewer:stop-stream', { deviceId: device.id });
      relaySocket.disconnect();
      if (msRef.current && msRef.current.readyState === 'open') {
        try { msRef.current.endOfStream(); } catch(e) {}
      }
    };
  }, [device.id]);

  function setupMSE(mimeType) {
    const video = videoRef.current;
    if (!video) return;

    const ms = new MediaSource();
    msRef.current = ms;
    video.src = URL.createObjectURL(ms);

    ms.addEventListener('sourceopen', () => {
      try {
        const sb = ms.addSourceBuffer(mimeType);
        sbRef.current = sb;
        sb.addEventListener('updateend', () => {
          if (queueRef.current.length > 0 && !sb.updating) {
            sb.appendBuffer(queueRef.current.shift());
          }
        });
        setStatus('');
        video.play().catch(() => {});
      } catch(e) {
        setError('MSE error: ' + e.message + '. Try Chrome or Edge.');
      }
    });
  }

  function appendChunk(data) {
    const sb = sbRef.current;
    if (!sb) return;
    if (sb.updating || queueRef.current.length > 0) {
      queueRef.current.push(data);
      // Prevent queue from growing too large
      if (queueRef.current.length > 30) queueRef.current.shift();
    } else {
      try { sb.appendBuffer(data); } catch(e) {}
    }
  }

  return (
    <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,
      backgroundColor:'rgba(0,0,0,0.95)',zIndex:1000,
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:'100%',maxWidth:900,padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div>
            <h2 style={{color:'#fff',margin:0,fontSize:18}}>📡 {device.name}</h2>
            <div style={{color:'#888',fontSize:12,marginTop:4}}>
              Remote RTSP Stream · {device.location}
              {agentOk && <span style={{color:'#4ade80',marginLeft:8}}>● Live</span>}
            </div>
          </div>
          <button onClick={onClose}
            style={{background:'#333',border:'none',color:'#fff',
              padding:'8px 16px',borderRadius:8,cursor:'pointer',fontSize:14}}>
            ✕ Close
          </button>
        </div>

        {error && (
          <div style={{backgroundColor:'#3d1a1a',border:'1px solid #ff4444',
            borderRadius:8,padding:16,marginBottom:12,color:'#ff8888'}}>
            <div style={{fontWeight:'bold',marginBottom:4}}>⚠️ Stream Error</div>
            <div style={{fontSize:13}}>{error}</div>
            <div style={{fontSize:12,marginTop:8,color:'#aaa'}}>
              Make sure stream-agent.js is running on your local network:
              <code style={{display:'block',marginTop:4,padding:'6px 8px',
                background:'#222',borderRadius:4}}>
                node stream-agent.js
              </code>
            </div>
          </div>
        )}

        {status && !error && (
          <div style={{textAlign:'center',padding:20,color:'#aaa',fontSize:14}}>
            {status}
          </div>
        )}

        <div style={{position:'relative',backgroundColor:'#000',borderRadius:8,overflow:'hidden'}}>
          <video
            ref={videoRef}
            style={{width:'100%',maxHeight:'60vh',display:'block',backgroundColor:'#000'}}
            autoPlay
            muted={false}
            playsInline
            controls
          />
        </div>

        <div style={{color:'#555',fontSize:11,textAlign:'center',marginTop:8}}>
          Stream relayed via local agent · {device.rtsp_url?.replace(/:([^:@]+)@/, ':***@') || 'RTSP'}
        </div>
      </div>
    </div>
  );
}

function CameraCard({ device, socket, onEvent, onSettings, settings, onWatchRemote, onSwitchToUsb, onArmRemote, usbArmed, onDisarmUsb, usbExpanded, onCollapseUsb }) {
  const videoRef        = useRef(null);
  const pcRef           = useRef(null);
  const canvasRef       = useRef(null);
  const hlsRef          = useRef(null);
  const [hlsPlaying,    setHlsPlaying]    = useState(false);
  const [hlsError,      setHlsError]      = useState('');
  const [hlsLoading,    setHlsLoading]    = useState(false);

  // Check if this is an IP camera with RTSP (use HLS instead of WebRTC)
  const isRtspCamera = !!(device.rtsp_url && device.rtsp_url.startsWith('rtsp://'));

  const startHLSStream = async () => {
    setHlsLoading(true);
    setHlsError('');
    try {
      const res = await api.post('/api/stream/hls/start', { deviceId: device.id });
      if (res.data.success) {
        const streamUrl = res.data.streamUrl;
        const video = videoRef.current;
        if (!video) return;
        // Use HLS.js if available, else native HLS (Safari)
        if (window.Hls && window.Hls.isSupported()) {
          const hls = new window.Hls({ lowLatencyMode: true });
          hls.loadSource(streamUrl);
          hls.attachMedia(video);
          hls.on(window.Hls.Events.MANIFEST_PARSED, () => { video.play(); setHlsPlaying(true); });
          hls.on(window.Hls.Events.ERROR, (e, d) => {
            if (d.fatal) { setHlsError('Stream error — check camera connection'); hls.destroy(); setHlsPlaying(false); }
          });
          hlsRef.current = hls;
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = streamUrl;
          video.play();
          setHlsPlaying(true);
        } else {
          setHlsError('HLS not supported in this browser');
        }
      } else {
        setHlsError(res.data.message || 'Failed to start stream');
      }
    } catch(e) {
      setHlsError(e.response?.data?.message || 'Could not connect to camera');
    }
    setHlsLoading(false);
  };

  const stopHLSStream = async () => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (videoRef.current) { videoRef.current.src = ''; }
    setHlsPlaying(false);
    try { await api.post('/api/stream/hls/stop', { deviceId: device.id }); } catch(e) {}
  };
  const audioCtxRef     = useRef(null);
  const localMicRef     = useRef(null);
  const [online,        setOnline]       = useState(device.is_active || false);
  const [watching,      setWatching]     = useState(false);
  const [status,        setStatus]       = useState(device.is_active ? 'Online' : 'Offline');
  const [zoom,          setZoom]         = useState(1);
  const [muted,         setMuted]        = useState(true);
  const [nvMode,        setNvMode]       = useState('off');
  const [showControls,  setShowControls] = useState(false);
  const [talkback,      setTalkback]     = useState(false);
  const [brightness,    setBrightness]   = useState(100);
  const [contrast,      setContrast]     = useState(100);
  const [snapshot,      setSnapshot]     = useState(null);

  useEffect(()=>{
    if (!socket) return;
    const onOnline  = ({deviceId})=>{ if(deviceId===device.id){
      setOnline(true); setStatus('Online');
      // Auto-connect if Watch Live was clicked while camera was offline
      if (pendingWatchRef.current) {
        pendingWatchRef.current = false;
        console.log('📺 Camera came online after command — auto-connecting');
        setTimeout(()=>doWebRTCConnect(), 800);
      }
    }};
    const onOffline = ({deviceId})=>{ if(deviceId===device.id){ setOnline(false); setStatus('Offline'); stopWatching(); }};
    socket.on('camera:online',  onOnline);
    socket.on('camera:offline', onOffline);
    socket.on('webrtc:offer', async({offer,fromSocketId})=>{
      if (!pcRef.current) return;
      console.log('📺 Received WebRTC offer from:', fromSocketId);
      cameraSocketIdRef.current = fromSocketId;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('webrtc:answer',{targetSocketId:fromSocketId,answer});
    });
    socket.on('webrtc:ice',({candidate,fromSocketId})=>{
      if (pcRef.current && candidate && fromSocketId === cameraSocketIdRef.current) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(e=>console.log('ICE error:',e));
      }
    });
    return ()=>{ socket.off('camera:online',onOnline); socket.off('camera:offline',onOffline); };
  },[socket,device.id]);

  const cameraSocketIdRef = useRef(null);
  const pendingWatchRef   = useRef(false);

  const doWebRTCConnect = () => {
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
    pc.onicecandidate = e=>{
      if(e.candidate && cameraSocketIdRef.current) {
        socket.emit('webrtc:ice',{targetSocketId:cameraSocketIdRef.current, candidate:e.candidate});
      }
    };
    pc.onconnectionstatechange = ()=>{
      console.log('📺 WebRTC state:', pc.connectionState);
      setStatus(pc.connectionState==='connected'?'● Live':pc.connectionState);
      if (pc.connectionState==='failed'||pc.connectionState==='disconnected') {
        setStatus('Connection lost — click Reconnect');
      }
    };
    pc.addTransceiver('video',{direction:'recvonly'});
    pc.addTransceiver('audio',{direction:'recvonly'});
    console.log('📺 viewer:watch for device:', device.id);
    socket.emit('viewer:watch',{deviceId:device.id});
    setWatching(true); setStatus('Connecting...');
  };

  // Unified Watch Live — works whether camera is online or offline
  const startWatching = () => {
    if (!socket) return;
    if (online) {
      doWebRTCConnect();
    } else {
      pendingWatchRef.current = true;
      setStatus('Starting camera...');
      setWatching(true);
      socket.emit('camera:command', {deviceId: device.id, command: 'start'});
      sessionStorage.setItem('autoStartBroadcast', '1');
      sessionStorage.setItem('autoLinkDevice', device.id);
      console.log('📺 Sent camera:command start to:', device.id);
      setTimeout(()=>{
        if (pendingWatchRef.current) {
          pendingWatchRef.current = false;
          setWatching(false);
          setStatus('Offline — camera did not respond');
        }
      }, 15000);
    }
  };

  const stopWatching = () => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current=null; }
    if (videoRef.current) videoRef.current.srcObject=null;
    if (localMicRef.current) { localMicRef.current.getTracks().forEach(t=>t.stop()); localMicRef.current=null; }
    setWatching(false); setStatus(online?'Online':'Offline');
    setZoom(1); setTalkback(false);
  };

  const reconnect = () => {
    stopWatching();
    setTimeout(()=>startWatching(), 500);
  };

  useEffect(()=>{
    if (!watching || !videoRef.current) return;
    let lastTime = 0;
    let frozenTimer = null;
    const checkFrozen = () => {
      if (!videoRef.current) return;
      const ct = videoRef.current.currentTime;
      if (ct === lastTime && videoRef.current.srcObject) {
        setStatus('⚠️ Feed frozen — click Reconnect');
      } else {
        lastTime = ct;
        if (status === '⚠️ Feed frozen — click Reconnect') setStatus('● Live');
      }
    };
    frozenTimer = setInterval(checkFrozen, 10000);
    return ()=>clearInterval(frozenTimer);
  },[watching]);

  const camMode   = settings?.camMode || 'security';
  const modeColor = camMode==='dashcam' ? C.green : C.blue;
  const modeLabel = camMode==='dashcam' ? '🚗 Dash Cam' : '🔒 Security Cam';

  const nvFilter = {
    off:     'none',
    bright:  'brightness(1.8) contrast(1.3)',
    green:   'brightness(1.5) contrast(1.4) sepia(1) hue-rotate(80deg) saturate(4)',
    thermal: 'brightness(1.2) contrast(1.5) sepia(1) hue-rotate(330deg) saturate(5)',
  }[nvMode] || 'none';

  const videoFilter = [
    nvFilter !== 'none' ? nvFilter : `brightness(${brightness}%) contrast(${contrast}%)`,
  ].join(' ');

  const takeSnapshot = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width  = videoRef.current.videoWidth  || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    const url = canvas.toDataURL('image/jpeg', 0.95);
    setSnapshot(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snapshot_${device.name}_${Date.now()}.jpg`;
    a.click();
  };

  const toggleTalkback = async () => {
    if (talkback) {
      if (localMicRef.current) { localMicRef.current.getTracks().forEach(t=>t.stop()); localMicRef.current=null; }
      setTalkback(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({audio:true,video:false});
        localMicRef.current = stream;
        if (pcRef.current) stream.getAudioTracks().forEach(t=>pcRef.current.addTrack(t,stream));
        setTalkback(true);
      } catch(e) { alert('Microphone access denied: '+e.message); }
    }
  };

  return (
    <div style={st.card}>
      <div style={{...st.flexBetween, marginBottom:4}}>
        <span style={{fontWeight:'bold',fontSize:15}}>{device.name}</span>
        <div style={{...st.flex, gap:6}}>
          <span style={{fontSize:11,color:modeColor,border:`1px solid ${modeColor}`,padding:'2px 6px',borderRadius:4}}>{modeLabel}</span>
          <div style={{width:8,height:8,borderRadius:'50%',backgroundColor:online?C.green:C.sub}}/>
        </div>
      </div>
      <div style={{color:C.sub,fontSize:12,marginBottom:8}}>📍 {device.location||'—'}</div>

      <div style={st.videoBox}>
        {watching
          ? <video ref={videoRef} style={{
              ...st.videoEl,
              filter: videoFilter,
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              transition: 'transform 0.15s',
            }} autoPlay playsInline
              muted={muted}
              onLoadedMetadata={e=>{ if(e.target.paused) e.target.play(); }}/>
          : <div style={{...st.videoEl,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:C.sub,position:'absolute',inset:0}}>
              <span style={{fontSize:40}}>📷</span>
              <span style={{marginTop:8,fontSize:13}}>{status}</span>
            </div>
        }
        {watching && <div style={{position:'absolute',top:8,left:8,backgroundColor:'rgba(204,0,0,0.9)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>● LIVE</div>}
        {talkback  && <div style={{position:'absolute',top:8,right:8,backgroundColor:'rgba(0,150,255,0.9)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>🎤 TALK</div>}
        {nvMode!=='off' && watching && (
          <div style={{position:'absolute',bottom:8,left:8,fontSize:10,color:nvMode==='green'?C.green:nvMode==='thermal'?'#ff6600':'#fff',backgroundColor:'rgba(0,0,0,0.6)',padding:'2px 6px',borderRadius:3}}>
            {nvMode==='green'?'🟢 NV':'nvMode'==='thermal'?'🔴 THERMAL':'☀️ BRIGHT'}
          </div>
        )}
      </div>

      <div style={{display:'flex',gap:5,marginTop:8,flexWrap:'wrap'}}>
        {!watching && !hlsPlaying
          ? <>
              {isRtspCamera ? (
                <button
                  style={{...st.btn, flex:2, backgroundColor:'#6366f1', color:'#fff',
                    fontWeight:'bold'}}
                  onClick={() => onWatchRemote && onWatchRemote(device)}
                >
                  📡 Watch Remote
                </button>
              ) : (
                !onSwitchToUsb && <button
                  style={{...st.btn, flex:2,
                    backgroundColor: online ? C.green : '#4488ff',
                    color:'#000',
                    opacity: socket ? 1 : 0.5,
                  }}
                  onClick={startWatching}
                  disabled={!socket}
                >
                  {online ? '▶ Watch Live' : '▶ Watch Live (wake camera)'}
                </button>
              )}
              {onSwitchToUsb && (
                usbArmed
                  ? <button style={{...st.btn,width:'100%',marginTop:6,backgroundColor:'rgba(255,68,68,0.15)',color:C.red,border:`2px solid ${C.red}`,fontWeight:'bold'}}
                      onClick={onDisarmUsb}>🔴 Stop Monitoring</button>
                  : <button style={{...st.btn,...st.btnGreen,width:'100%',marginTop:6}} onClick={()=>{
                      sessionStorage.setItem('returnToCameras','1');
                      sessionStorage.setItem('autoArmAfterStream','1');
                      onSwitchToUsb();
                    }}>📷 Start & Arm</button>
              )}
              {onArmRemote && (
                <button style={{...st.btn,...st.btnGreen,width:'100%',marginTop:6}}
                  onClick={onArmRemote}>🟢 Arm Camera</button>
              )}
            </>
          : <>
              <button style={{...st.btn,...st.btnRed,flex:1}}
                onClick={isRtspCamera ? stopHLSStream : stopWatching}>⏹ Stop</button>
              <button style={{...st.btn,...st.btnGray,flex:1,fontSize:11}} onClick={reconnect} title="Reconnect this feed without affecting others">🔄 Reconnect</button>
            </>
        }
        {watching && <>
          <button title={muted?'Unmute':'Mute'} style={{...st.btn,...st.btnGray,padding:'6px 10px'}} onClick={()=>{ if(videoRef.current) videoRef.current.muted=!muted; setMuted(m=>!m); }}>
            {muted?'🔇':'🔊'}
          </button>
          <button title="Talkback" style={{...st.btn,padding:'6px 10px',backgroundColor:talkback?'#4488ff':C.card,border:`1px solid ${talkback?C.blue:C.border}`}} onClick={toggleTalkback}>
            🎤
          </button>
          <button title="Snapshot" style={{...st.btn,...st.btnGray,padding:'6px 10px'}} onClick={takeSnapshot}>📸</button>
          <button title="Camera Controls" style={{...st.btn,...st.btnGray,padding:'6px 10px',backgroundColor:showControls?C.blue:C.card,border:`1px solid ${showControls?C.blue:C.border}`}}
            onClick={()=>setShowControls(s=>!s)}>🎛</button>
        </>}
        <button style={{...st.btn,...st.btnGray,padding:'6px 10px'}} onClick={onSettings} title="Settings">⚙️</button>
      </div>

      {watching && showControls && (
        <div style={{marginTop:8,backgroundColor:'#0d0d0d',borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
          <div style={{marginBottom:10}}>
            <div style={{...st.flexBetween,marginBottom:4}}>
              <span style={{fontSize:12,color:C.sub}}>📍 Zoom {zoom.toFixed(1)}x</span>
              <button style={{...st.btn,...st.btnGray,padding:'2px 8px',fontSize:11}} onClick={()=>setZoom(1)}>Reset</button>
            </div>
            <input type="range" min={1} max={4} step={0.1} value={zoom}
              onChange={e=>setZoom(parseFloat(e.target.value))}
              style={{width:'100%',accentColor:C.green}}/>
            <div style={{display:'flex',gap:4,marginTop:4}}>
              {[1,1.5,2,3,4].map(z=>(
                <button key={z} onClick={()=>setZoom(z)} style={{...st.btn,...st.btnGray,flex:1,fontSize:10,padding:'3px',backgroundColor:zoom===z?C.green:C.card,color:zoom===z?'#000':C.text}}>
                  {z}x
                </button>
              ))}
            </div>
          </div>

          <div style={{marginBottom:10}}>
            <div style={{fontSize:12,color:C.sub,marginBottom:6}}>🌙 Night Vision / Image Enhancement</div>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {[
                {id:'off',     label:'Off',      color:C.sub},
                {id:'bright',  label:'☀️ Bright', color:'#ffcc44'},
                {id:'green',   label:'🟢 NV',     color:C.green},
                {id:'thermal', label:'🔴 Thermal',color:'#ff6600'},
              ].map(m=>(
                <button key={m.id} onClick={()=>setNvMode(m.id)} style={{
                  ...st.btn, flex:1, fontSize:11, padding:'5px 4px',
                  backgroundColor: nvMode===m.id ? m.color+'30' : C.card,
                  color: nvMode===m.id ? m.color : C.sub,
                  border: `1px solid ${nvMode===m.id ? m.color : C.border}`,
                }}>{m.label}</button>
              ))}
            </div>
          </div>

          {nvMode==='off' && (
            <div style={{marginBottom:8}}>
              <div style={{...st.flexBetween,marginBottom:4}}>
                <span style={{fontSize:12,color:C.sub}}>☀️ Brightness {brightness}%</span>
                <span style={{fontSize:12,color:C.sub}}>◑ Contrast {contrast}%</span>
              </div>
              <div style={{display:'flex',gap:8}}>
                <input type="range" min={50} max={200} value={brightness} onChange={e=>setBrightness(parseInt(e.target.value))} style={{flex:1,accentColor:'#ffcc44'}}/>
                <input type="range" min={50} max={200} value={contrast}   onChange={e=>setContrast(parseInt(e.target.value))}   style={{flex:1,accentColor:'#88aaff'}}/>
              </div>
              <button style={{...st.btn,...st.btnGray,width:'100%',marginTop:4,fontSize:11}} onClick={()=>{setBrightness(100);setContrast(100);}}>Reset Image</button>
            </div>
          )}
        </div>
      )}

      {settings && (
        <div style={{marginTop:6,display:'flex',gap:5,flexWrap:'wrap'}}>
          {settings.motionEnabled && <span style={{fontSize:10,color:C.green,border:`1px solid ${C.green}40`,padding:'1px 6px',borderRadius:4}}>👁 Motion</span>}
          {settings.soundEnabled  && <span style={{fontSize:10,color:C.blue, border:`1px solid ${C.blue}40`, padding:'1px 6px',borderRadius:4}}>🔊 Sound</span>}
          {settings.nightVision   && <span style={{fontSize:10,color:'#aaa', border:`1px solid #aaa40`,    padding:'1px 6px',borderRadius:4}}>🌙 NV</span>}
          {settings.cloudUpload   && <span style={{fontSize:10,color:C.gold, border:`1px solid ${C.gold}40`,padding:'1px 6px',borderRadius:4}}>☁️ Cloud</span>}
        </div>
      )}
    </div>
  );
}

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

function USBCameraPage({ socket, devices, userId, organizationId, onEvent, onUsbStatus, onLinkedDevice, onSettings, autoStart, onAutoStartDone }) {
  const camSocketRef = useRef(null);
  const [camSocket, setCamSocket] = useState(null);

  useEffect(()=>{
    const token = localStorage.getItem('accessToken');
    if (!token || camSocketRef.current) return;
    const API_URL = 'https://whale-app-hxokg.ondigitalocean.app';
    const s = io(API_URL, {
      auth:{ token }, transports:['websocket','polling']
    });
    s.on('connect', ()=>{
      console.log('📡 Camera socket connected:', s.id);
      camSocketRef.current = s;
      setCamSocket(null);
      setTimeout(()=>setCamSocket(s), 10);
    });
    s.on('disconnect', ()=>{
      console.log('📡 Camera socket disconnected — will auto-reconnect');
      setCamSocket(null);
    });

    // Register camera:command directly on 's'
    s.on('camera:command', ({command, params}) => {
      console.log('📡 [DIRECT] camera:command on s:', command, params);
      if (command === 'arm' || command === 'disarm') {
        if (executeCommandRef.current) {
          executeCommandRef.current(command, params || {});
        } else if (window.__executeCommand) {
          window.__executeCommand(command, params || {});
        } else {
          window.__pendingSocketCommand = {command, params: params || {}};
          console.log('📡 Stored pending command:', command);
        }
      }
    });

    camSocketRef.current = s;
    return ()=>{ s.off('camera:command'); };
  },[]);

  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const pcsRef     = useRef({});
  const [streaming,      setStreaming]      = useState(false);
  const [selectedDev,    setSelectedDev]    = useState('');
  const [camDevices,     setCamDevices]     = useState([]);
  const camDevicesRef = useRef([]);
  const [linkedDevice,   setLinkedDevice]   = useState('');
  const linkedDeviceRef   = useRef('');  // always current linkedDevice for socket closures
  const executeCommandRef = useRef(null); // ref to command executor

  // Expose command executor to parent window for direct disarm/arm from Cameras tab
  useEffect(()=>{
    window.__executeCommand = (command, params={}) => {
      if (command==='arm')    { armCamera(); }
      if (command==='disarm') { disarmCamera(); }
    };
    return () => { window.__executeCommand = null; };
  });

  useEffect(()=>{ 
    if(devices.length>0) {
      // If current linkedDevice is an IP camera, clear it and find a proper one
      const currentDev = devices.find(d=>d.id===linkedDevice);
      const isIpCamera = currentDev?.rtsp_url && currentDev.rtsp_url !== '';
      if (!linkedDevice || isIpCamera) {
        const nonIp = devices.find(d=>!d.rtsp_url||d.rtsp_url==='');
        if (nonIp) {
          setLinkedDevice(nonIp.id);
          linkedDeviceRef.current = nonIp.id;
        }
      }
    }
  },[devices]);
  useEffect(()=>{ 
    linkedDeviceRef.current = linkedDevice;
    if (onLinkedDevice) onLinkedDevice(linkedDevice);
    if (linkedDevice) sessionStorage.setItem('usbLinkedDevice', linkedDevice);
  },[linkedDevice]);
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
  const [recordMode,     setRecordMode]     = useState('timed');
  const [loopDuration,   setLoopDuration]   = useState(60);
  const [clipSize,       setClipSize]       = useState(60);
  const [showRecPrompt,  setShowRecPrompt]  = useState(false);
  const [clipManagement, setClipManagement] = useState('cloud');
  const [showClipPrompt, setShowClipPrompt] = useState(false);
  const [recordingTime,  setRecordingTime]  = useState(0);
  const [sensitivity,    setSensitivity]    = useState(30);
  const motionCanvasRef  = useRef(null);
  const prevFrameRef     = useRef(null);
  const motionPollRef    = useRef(null);
  const mediaRecRef      = useRef(null);
  const loopTimerRef     = useRef(null);
  const recTimerRef      = useRef(null);
  const alertActiveRef   = useRef(false);
  const isArmedRef       = useRef(false);
  const isRecordingRef   = useRef(false);
  const canvasCleanupRef  = useRef(null);
  const tsStreamRef       = useRef(null);
  const triggerEventIdRef = useRef(null);
  // Function refs — allow socket closure to call functions defined later in component
  const startMotionDetRef = useRef(null);
  const startSoundDetRef  = useRef(null);
  const stopMotionDetRef  = useRef(null);
  const stopRecordingRef  = useRef(null);

  const autoStartRef = useRef(false);
  const [remoteStartPending, setRemoteStartPending] = useState(false);
  const [pendingCommand, setPendingCommand] = useState(null);

  // ── PATCH 1: Removed premature enumerateDevices() on mount ──────
  // Camera devices are enumerated inside startStream() AFTER getUserMedia
  // succeeds so that browser returns full labels (requires permission first).
  useEffect(()=>{
    // Clear any stale auto-start flags from previous sessions
    // Never auto-call startStream() — requires explicit user click for camera permission
    sessionStorage.removeItem('autoStartBroadcast');
    sessionStorage.removeItem('usbBroadcasting');
    // Restore linked device selection if set
    const autoLink = sessionStorage.getItem('autoLinkDevice');
    if (autoLink) { setLinkedDevice(autoLink); sessionStorage.removeItem('autoLinkDevice'); }
    const savedDevice = sessionStorage.getItem('usbLinkedDevice');
    if (savedDevice) {
      // Verify saved device is non-IP before restoring
      // Will be validated against devices list when devices load
      setLinkedDevice(savedDevice);
    }
  },[]);

  useEffect(()=>{
    isArmedRef.current = isArmed;
  },[isArmed]);

  // Auto-start stream when triggered from Cameras tab Start & Arm button
  useEffect(()=>{
    if (!autoStart) return;
    if (streaming) {
      setIsArmed(true); isArmedRef.current=true;
      startMotionDetection();
      if (soundEnabled) startSoundDetection();
      setStatusMsg('🟢 Armed — monitoring...');
      if (onUsbStatus) onUsbStatus('armed');
      if (onAutoStartDone) onAutoStartDone();
      setTimeout(()=>{
        const tabs = document.querySelectorAll('[data-tab]');
        tabs.forEach(t=>{ if(t.dataset.tab==='cameras') t.click(); });
      }, 800);
      return;
    }
    sessionStorage.setItem('autoArmAfterStream','1');
    sessionStorage.setItem('returnToCameras','1');
    setTimeout(()=>{ startStream(); if(onAutoStartDone) onAutoStartDone(); },200);
  },[autoStart]);

  // Re-auth camera socket when linkedDevice or devices changes
  useEffect(()=>{
    if (!linkedDevice || !camSocketRef.current?.connected) return;
    const token = localStorage.getItem('accessToken');
    const payload = token ? JSON.parse(atob(token.split('.')[1])) : {};
    const orgId = payload.organizationId || payload.org_id || organizationId;
    const devName = devices.find(d=>d.id===linkedDevice)?.name || linkedDevice;
    camSocketRef.current.emit('auth',{deviceId:linkedDevice,deviceName:devName,role:'camera',organizationId:orgId,userId:payload.userId||userId});
    console.log('📡 Re-auth — deviceId:', linkedDevice, 'name:', devName);
  },[linkedDevice, devices, camSocket]);

  useEffect(()=>{
    const cs = camSocket;
    if (!cs || !cs.id) { return; }
    console.log('📺 Registering handlers on camera socket:', cs.id);

    // Auth as camera in standby immediately — even before broadcasting
    // This allows the signaling server to route camera:command to us
    const token = localStorage.getItem('accessToken');
    const payload = token ? JSON.parse(atob(token.split('.')[1])) : {};
    const orgId = payload.organizationId || payload.org_id || organizationId;
    // Try to auth immediately if we have a device ID
    const currentLinkedDevice = linkedDeviceRef.current || sessionStorage.getItem('usbLinkedDevice') || (devices[0]?.id);
    if (currentLinkedDevice) {
      const devName = devices.find(d=>d.id===currentLinkedDevice)?.name || currentLinkedDevice;
      cs.emit('auth', {
        deviceId: currentLinkedDevice,
        deviceName: devName,
        role: 'camera',
        organizationId: orgId,
        userId: payload.userId || userId,
      });
      console.log('📡 Camera socket auth on connect — deviceId:', currentLinkedDevice, devName);
    } else {
      console.log('📡 Camera socket connected but no deviceId yet — will auth when device selected');
    }

    // Remote start — viewer clicked Watch Live on Cameras tab
    cs.on('camera:command', ({command, params}) => {
      console.log('📡 Received camera:command:', command, params);
      if (command === 'start' && !streamRef.current) {
        if (navigator.permissions) {
          navigator.permissions.query({name:'camera'}).then(perm => {
            if (perm.state === 'granted') {
              console.log('📡 Permission granted — auto-starting stream');
              startStream();
            } else {
              console.log('📡 Permission needed — switching to USB tab');
              document.querySelectorAll('[data-tab]').forEach(t=>{
                if(t.dataset.tab==='usb') t.click();
              });
            }
          }).catch(()=>startStream());
        } else {
          startStream();
        }
      }
      // Don't call functions directly — set state so useEffect can execute
      // with all current function references available
      if (command === 'arm' || command === 'disarm') {
        console.log('📡 [DIRECT] camera:command received:', command, params);
        // Use ref callback — bypasses closure staleness entirely
        // Try ref first, then window bridge as fallback
      if (executeCommandRef.current) {
          executeCommandRef.current(command, params || {});
      } else if (window.__executeCommand) {
          console.log('📡 Using window bridge for command:', command);
          window.__executeCommand(command, params || {});
      } else {
          console.log('📡 No command executor available yet — storing for later');
          window.__pendingSocketCommand = {command, params: params || {}};
      }
      }
    });

    const sendOfferToViewer = async (viewerSocketId) => {
      // Always read stream from videoRef as fallback — works even if streamRef closure is stale
      const stream = streamRef.current || videoRef.current?.srcObject || window.__activeCameraStream;
      if (!stream) return false;
      if (!streamRef.current) streamRef.current = stream; // heal the ref
      const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});
      pcsRef.current[viewerSocketId]=pc;
      stream.getTracks().forEach(t=>pc.addTrack(t,stream));
      pc.onicecandidate=e=>{ if(e.candidate) cs.emit('webrtc:ice',{targetSocketId:viewerSocketId,candidate:e.candidate}); };
      pc.onconnectionstatechange=()=>{
        if(pc.connectionState==='connected') setViewers(v=>v+1);
        if(pc.connectionState==='disconnected'||pc.connectionState==='closed'){ setViewers(v=>Math.max(0,v-1)); delete pcsRef.current[viewerSocketId]; }
      };
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('📺 Camera sending offer to viewer:', viewerSocketId);
      cs.emit('webrtc:offer',{targetSocketId:viewerSocketId,offer});
      return true;
    };

    cs.on('viewer:request',async({viewerSocketId})=>{
      // Try all stream sources — streamRef may be stale if socket registered before startStream ran
      const stream = streamRef.current || videoRef.current?.srcObject || window.__activeCameraStream;
      if (stream && !streamRef.current) streamRef.current = stream;
      console.log('📺 viewer:request from:', viewerSocketId, '| stream ready:', !!stream);
      if (stream) {
        sendOfferToViewer(viewerSocketId);
      } else {
        // Stream not started yet — poll every 500ms up to 15s
        console.log('📺 Waiting for stream...');
        let tries = 0;
        const poll = setInterval(()=>{
          tries++;
          const s = streamRef.current || videoRef.current?.srcObject || window.__activeCameraStream;
          if (s) {
            clearInterval(poll);
            if (!streamRef.current) streamRef.current = s;
            console.log('📺 Stream appeared — connecting viewer:', viewerSocketId);
            sendOfferToViewer(viewerSocketId);
          } else if (tries >= 30) {
            clearInterval(poll);
            console.log('📺 Stream never started for viewer:', viewerSocketId);
          }
        }, 500);
      }
    });
    cs.on('webrtc:answer',async({answer,fromSocketId})=>{ const pc=pcsRef.current[fromSocketId]; if(pc) await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(()=>{}); });
    cs.on('webrtc:ice',async({candidate,fromSocketId})=>{ const pc=pcsRef.current[fromSocketId]; if(pc&&candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{}); });
    return ()=>{ cs.off('viewer:request'); cs.off('webrtc:answer'); cs.off('webrtc:ice'); };
  },[camSocket]);

  const startMotionDetection = () => {
    startMotionDetRef.current = startMotionDetection;
    if (!streamRef.current || !motionEnabled) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90;
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
        for (let i = 0; i < curr.length; i += 16) {
          diff += Math.abs(curr[i] - prev[i]);
          diff += Math.abs(curr[i+1] - prev[i+1]);
          diff += Math.abs(curr[i+2] - prev[i+2]);
        }
        const avgDiff = diff / (curr.length / 16);
        const threshold = 100 - sensitivity;
        if (avgDiff > threshold) {
          console.log('Motion detected! avgDiff:', avgDiff.toFixed(1), 'threshold:', threshold);
          triggerAlert('motion');
        }
      }
      prevFrameRef.current = current;
    }, 500);
  };

  const stopMotionDetection = () => {
    clearInterval(motionPollRef.current);
    prevFrameRef.current = null;
  };
  stopMotionDetRef.current = stopMotionDetection;

  const startSoundDetection = () => {
    startSoundDetRef.current = startSoundDetection;
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
      id: Date.now(), type, deviceId: linkedDevice||'',
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}),
      device: (() => {
        const cds = camDevicesRef.current.length ? camDevicesRef.current : camDevices;
        const hwName = cds.find(d=>d.deviceId===selectedDev)?.label || cds[0]?.label || '';
        const regName = (linkedDevice ? devices.find(d=>d.id===linkedDevice)?.name : null)
          || devices.find(d=>d.device_type==='usb')?.name || hwName || 'Webcam';
        return regName;
      })(),
      deviceName: (() => {
        const cds = camDevicesRef.current.length ? camDevicesRef.current : camDevices;
        const hwName = cds.find(d=>d.deviceId===selectedDev)?.label || cds[0]?.label || '';
        const regName = (linkedDevice ? devices.find(d=>d.id===linkedDevice)?.name : null)
          || devices.find(d=>d.device_type==='usb')?.name || hwName || 'Webcam';
        return regName;
      })(),
      camMode: 'security',
    };
    const eventWithClip = {...event, clip_url: null, clip_pending: true};
    setEvents(ev=>[eventWithClip,...ev].slice(0,50));
    if (onEvent) onEvent(eventWithClip);
    setStatusMsg(`⚠️ ${type==='motion'?'Motion':'Sound'} detected! — Recording...`);
    if (!isRecordingRef.current) startRecording(true, event.id);
  };

  // ── PATCH 2 & 3: Support check + enumerate AFTER getUserMedia ───
  const startStream = async () => {
    // PATCH 3: Check browser support before attempting
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(
        'Camera access is not supported in this browser.\n\n' +
        'Please use Chrome, Edge, or Firefox and make sure the page\n' +
        'is served over HTTPS (not plain HTTP).'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
      sessionStorage.setItem('usbBroadcasting', '1');
      sessionStorage.setItem('usbLinkedDevice', linkedDevice||'');
      if (sessionStorage.getItem('returnToCameras')==='1') {
        sessionStorage.removeItem('returnToCameras');
        setTimeout(()=>{
          const tabs = document.querySelectorAll('[data-tab]');
          tabs.forEach(t=>{ if(t.dataset.tab==='cameras') t.click(); });
        }, 1500);
      }
      streamRef.current = stream;
      window.__activeCameraStream = stream; // global fallback for stale closures
      if (videoRef.current) videoRef.current.srcObject = stream;

      // PATCH 1: Enumerate devices HERE — after permission granted, labels are available
      const devs = await navigator.mediaDevices.enumerateDevices();
      const vids = devs.filter(d=>d.kind==='videoinput');
      setCamDevices(vids); camDevicesRef.current = vids;
      if (vids.length>0) setSelectedDev(vids[0].deviceId);

      setStreaming(true);
      setStatusMsg('🟢 Broadcasting — select mode below');
      if (sessionStorage.getItem('autoArmAfterStream') === '1') {
        sessionStorage.removeItem('autoArmAfterStream');
        setTimeout(() => {
          setIsArmed(true); isArmedRef.current = true;
          startMotionDetection();
          if (soundEnabled) startSoundDetection();
          setStatusMsg('🟢 Armed — monitoring...');
          if (onUsbStatus) onUsbStatus('armed');
        }, 800);
      }
      try {
        const vt = stream.getVideoTracks()[0];
        const caps = vt.getCapabilities?.();
        if (caps?.zoom) { setHwZoomSupported(true); setHwZoomRange({min:caps.zoom.min,max:caps.zoom.max,step:caps.zoom.step||0.1}); }
      } catch {}
      const { canvasStream, cleanup } = createTimestampedStream(stream);
      tsStreamRef.current = canvasStream;
      canvasCleanupRef.current = cleanup;
      if (linkedDevice && camSocketRef.current) {
        const token = localStorage.getItem('accessToken');
        const payload = token ? JSON.parse(atob(token.split('.')[1])) : {};
        const orgId = payload.organizationId || payload.org_id || organizationId;
        camSocketRef.current.emit('auth',{ deviceId:linkedDevice, deviceName:devices.find(d=>d.id===linkedDevice)?.name||linkedDevice, role:'camera', organizationId:orgId, userId:payload.userId||userId });
        console.log('📡 Camera socket authed as:', devices.find(d=>d.id===linkedDevice)?.name, 'org:', orgId);
      }
    } catch(e) {
      if (e.name==='NotAllowedError') {
        alert(
          'Camera permission denied.\n\n' +
          'Click the camera icon in your browser address bar\n' +
          'and allow access, then try again.'
        );
      }
      // PATCH 2: Improved NotFoundError message
      else if (e.name==='NotFoundError') {
        alert(
          'No camera found on this device.\n\n' +
          '• Make sure your webcam is plugged in and not in use by another app.\n' +
          '• Try refreshing the page and clicking Start Broadcasting again.\n\n' +
          'ℹ️  The USB/Webcam tab streams from THIS computer\'s webcam.\n' +
          'To use a phone as a camera, use the mobile app or\n' +
          'scan a QR code from the "Enroll Camera" button.'
        );
      }
      else if (e.name==='NotReadableError') alert('Camera is in use by another app. Close it and try again.');
      else alert('Camera error: '+(e.message||e.name));
    }
  };

  const stopStream = () => {
    sessionStorage.removeItem('usbBroadcasting');
    sessionStorage.removeItem('usbLinkedDevice');
    stopMotionDetection();
    clearInterval(loopTimerRef.current);
    clearInterval(recTimerRef.current);
    if (mediaRecRef.current) { try { mediaRecRef.current.stop(); } catch {} mediaRecRef.current=null; }
    if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    if (canvasCleanupRef.current) { canvasCleanupRef.current(); canvasCleanupRef.current=null; }
    streamRef.current=null; tsStreamRef.current=null; window.__activeCameraStream=null;
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
    if (onUsbStatus) onUsbStatus('armed');
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
    if (onUsbStatus) onUsbStatus('');
  };

  const startRecording = (triggered=false, triggerEventId=null) => {
    if (triggerEventId) triggerEventIdRef.current = triggerEventId;
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
        const uploadDeviceId = linkedDevice || devices.find(d=>d.device_type==='usb')?.id || '';
        formData.append('device_id', uploadDeviceId);
        formData.append('filename', filename);
        const token = localStorage.getItem('accessToken');
        setStatusMsg('☁️ Uploading...');
        fetch(`${API}/api/recordings/upload`, {
          method:'POST',
          headers:{ Authorization:'Bearer '+token },
          body: formData,
        }).then(async r=>{
          if (r.ok) {
            setStatusMsg('☁️ Clip uploaded');
            const data = await r.json().catch(()=>({}));
            const clipUrl = data?.data?.url;
            const evId = triggerEventIdRef.current;
            if (evId && clipUrl) {
              setEvents(ev=>ev.map(e=>e.id===evId?{...e,clip_url:clipUrl,clip_pending:false}:e));
              if (onEvent) onEvent({type:'clip_ready',eventId:evId,clip_url:clipUrl});
              triggerEventIdRef.current = null;
            }
          } else {
            console.warn('Upload failed:', r.status);
            setStatusMsg('⬇️ Saved locally (upload failed — downloading)');
            const url2=URL.createObjectURL(blob);
            const a2=document.createElement('a');
            a2.href=url2; a2.download=filename; a2.click();
            setTimeout(()=>URL.revokeObjectURL(url2),5000);
          }
        }).catch(()=>{
            setStatusMsg('⬇️ Cloud unavailable — downloading locally');
            const url2=URL.createObjectURL(blob);
            const a2=document.createElement('a');
            a2.href=url2; a2.download=filename; a2.click();
            setTimeout(()=>URL.revokeObjectURL(url2),5000);
          });
      }

      isRecordingRef.current=false; setIsRecording(false);
      alertActiveRef.current=false;
      setStatusMsg(isArmedRef.current?'🟢 Armed — monitoring...':'🟢 Broadcasting');
      if (recordMode==='loop' && isArmedRef.current) startRecording();
    };
    mr.start();
    mediaRecRef.current=mr;
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

  // ── Execute remote arm/disarm commands ──────────────────────────
  // Use a ref callback so the socket closure can call it directly
  // without going through React state (avoids batching/closure issues)
  useEffect(()=>{
    const executor = (command, params) => {
      console.log('📡 executeCommand:', command, '| stream:', !!streamRef.current, '| videoRef:', !!videoRef.current?.srcObject);

      if (command === 'arm') {
        if (!streamRef.current && videoRef.current?.srcObject) {
          streamRef.current = videoRef.current.srcObject;
        }
        if (!streamRef.current) {
          console.log('📡 Arm ignored: no stream');
          return;
        }
        if (params.loopDuration) setLoopDuration(params.loopDuration);
        if (params.clipSize) setClipSize(params.clipSize);
        if (params.motionEnabled !== undefined) setMotionEnabled(params.motionEnabled);
        if (params.soundEnabled !== undefined) setSoundEnabled(params.soundEnabled);
        setIsArmed(true); isArmedRef.current=true;
        setStreaming(true); // ensure streaming state is true so buttons show
        setStatusMsg('🟢 Armed — monitoring...');
        if (onUsbStatus) onUsbStatus('armed');
        startMotionDetection();
        if (soundEnabled) startSoundDetection();
        if (params.recordMode !== 'manual') {
          setTimeout(()=>{ if (isArmedRef.current) startRecording(); }, 300);
        }
      }

      if (command === 'disarm') {
        setIsArmed(false); isArmedRef.current=false;
        stopMotionDetection();
        if (isRecordingRef.current) stopRecording();
        setStatusMsg('🟢 Broadcasting');
        if (onUsbStatus) onUsbStatus('');
      }
    };
  }); // intentionally no deps array — re-registers after every render with fresh closures

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

        <div style={st.card}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
            <div>
              <label style={st.label}>Camera Device</label>
              <select style={st.input} value={selectedDev} onChange={e=>setSelectedDev(e.target.value)}>
                {camDevices.length === 0
                  ? <option value="">Click Start Broadcasting to detect cameras</option>
                  : camDevices.map((d,i)=>(
                    <option key={d.deviceId||i} value={d.deviceId||''}>
                      {d.label&&d.label.length>0?d.label:`Camera ${i+1}`}
                    </option>
                  ))
                }
              </select>
            </div>
            <div>
              {/* Link to Device dropdown removed */}
            </div>
          </div>

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
              <div style={{position:'absolute',top:8,left:8,backgroundColor:isRecording?'rgba(204,0,0,0.9)':'rgba(0,100,0,0.85)',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>
                {isRecording?`● REC ${fmtTime(recordingTime)}`:`● LIVE • ${viewers}v`}
              </div>
              {isArmed && !isRecording && <div style={{position:'absolute',top:8,right:8,backgroundColor:'rgba(0,80,0,0.85)',color:C.green,padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:'bold'}}>🟢 ARMED</div>}
              {nightVision && <div style={{position:'absolute',inset:0,backgroundColor:'rgba(0,255,70,0.15)',pointerEvents:'none'}}/>}
              <VideoTimestamp/>
              <div style={{position:'absolute',bottom:8,left:8,backgroundColor:'rgba(0,0,0,0.65)',color:'#fff',padding:'3px 8px',borderRadius:6,fontSize:12}}>{statusMsg}</div>
            </>}
          </div>

          {streaming && (
            <div style={{marginTop:8,backgroundColor:'#0d0d0d',borderRadius:8,padding:8}}>
              <div style={{...st.flexBetween,marginBottom:6}}>
                <span style={{fontSize:12,color:C.sub}}>📍 {zoomLevel.toFixed(1)}x {hwZoomSupported&&<span style={{color:C.green,fontSize:10}}>HW</span>}</span>
                <button style={{...st.btn,...st.btnGray,padding:'3px 8px',fontSize:11}} onClick={()=>handleZoom(1)}>Reset</button>
              </div>
              <input type="range" min={1} max={hwZoomSupported?hwZoomRange.max:3} step={hwZoomSupported?hwZoomRange.step:0.1}
                value={zoomLevel} onChange={e=>handleZoom(e.target.value)}
                style={{width:'100%',accentColor:C.green}}/>
            </div>
          )}

          <div style={{display:'flex',gap:6,marginTop:8}}>
            {(!streaming && !streamRef.current && !videoRef.current?.srcObject)
              ? <button style={{...st.btn,...st.btnGreen,flex:1}} onClick={startStream}>📡 Start Broadcasting</button>
              : <>
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

        <div style={st.card}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <p style={{fontWeight:'bold',margin:0,color:C.text,fontSize:15}}>⚙️ Security Settings</p>
            {linkedDevice && onSettings && (
              <button style={{...st.btn,...st.btnGray,fontSize:12,padding:'4px 10px'}}
                onClick={()=>{ const dev=devices.find(d=>d.id===linkedDevice); if(dev) onSettings({...dev}); else if(linkedDevice) onSettings({id:linkedDevice, name:'', location:'', device_type:'usb'}); }}
                title='Rename / Edit Camera'>✏️ Edit Camera</button>
            )}
          </div>

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

          <p style={st.settingSection}>🌙 Night Vision</p>
          <div style={st.toggle}>
            <div><div style={st.toggleLabel}>Night Mode</div><div style={st.toggleNote}>Green tint overlay</div></div>
            <Toggle value={nightVision} onChange={setNightVision}/>
          </div>

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
        </div>
      </div>

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

// ─── Clips / Recordings Page ──────────────────────────────────────
function ClipsPage({ devices, onlineMap = {} }) {
  const [clips,      setClips]      = React.useState([]);
  const [loading,    setLoading]    = React.useState(true);
  const [filter,     setFilter]     = React.useState('all');
  const [sortBy,     setSortBy]     = React.useState('newest');
  const [playingUrl, setPlayingUrl] = React.useState(null);
  const [playingName,setPlayingName]= React.useState('');
  const [totalSize,  setTotalSize]  = React.useState(0);
  const [selected,   setSelected]   = React.useState(new Set());
  const [selectMode, setSelectMode] = React.useState(false);
  const retDays = parseInt(localStorage.getItem('retentionDays')||'60'); // Pro default

  const loadClips = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/recordings?limit=2000');
      const data = res.data.data || [];
      setClips(data);
      setTotalSize(data.reduce((a,c)=>a+(parseFloat(c.size)||0),0));
    } catch(e) { console.error('Clips load error:', e.message); }
    setLoading(false);
  };

  React.useEffect(()=>{ loadClips(); },[]);

  const deleteClip = async (id) => {
    if (!window.confirm('Delete this clip?')) return;
    try { await api.delete('/api/recordings/'+id); setClips(c=>c.filter(x=>x.id!==id)); } catch {}
  };

  const deleteSelected = async () => {
    if (!window.confirm(`Delete ${selected.size} clips?`)) return;
    for (const id of selected) {
      try { await api.delete('/api/recordings/'+id); } catch {}
    }
    setClips(c=>c.filter(x=>!selected.has(x.id)));
    setSelected(new Set());
    setSelectMode(false);
  };

  const toggleSelect = (id) => {
    setSelected(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  };

  const selectAll = () => {
    setSelected(new Set(filtered.map(c=>c.id)));
  };

  const fmtSize = b => { const n=parseFloat(b)||0; if(!n||!isFinite(n)) return '-'; if(n<1048576) return (n/1024).toFixed(1)+' KB'; if(n<1073741824) return (n/1048576).toFixed(1)+' MB'; if(n<1099511627776) return (n/1073741824).toFixed(2)+' GB'; return (n/1099511627776).toFixed(2)+' TB'; };

  const fmtDate = s => {
    if (!s) return '-';
    const d = new Date(s);
    return d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString();
  };

  const getDeviceName = id => { const d = devices.find(x=>x.id===id); return d?.name || d?.device_name || onlineMap[id]?.name || (id||'').slice(0,8) || 'Unknown'; };

  const filtered = clips
    .filter(c=> filter==='all' || c.device_id===filter)
    .sort((a,b)=> sortBy==='newest' ? new Date(b.created_at)-new Date(a.created_at) : new Date(a.created_at)-new Date(b.created_at));

  const grouped = filtered.reduce((acc,c)=>{ const k=c.device_id||'unknown'; if(!acc[k]) acc[k]=[]; acc[k].push(c); return acc; },{}); const deviceNameMap = devices.reduce((acc,d)=>{ acc[d.id]=d.name||d.device_name||d.id.slice(0,8); return acc; },{});

  const RETENTION_OPTIONS = [{label:'14 days (Free)',value:14},{label:'60 days (Pro)',value:60},{label:'180 days (Pro)',value:180},{label:'1 year (Enterprise)',value:365}];

  return (
    <div>
      <div style={{...st.flexBetween,marginBottom:16,flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{margin:0,color:C.green}}>🎬 Recorded Clips</h2>
          <p style={{color:C.sub,fontSize:12,margin:'4px 0 0'}}>{clips.length} clips · {fmtSize(totalSize)} · {retDays}-day retention (Pro)</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <select style={{...st.input,width:'auto',fontSize:12,padding:'6px 10px'}} value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">All Cameras</option>
            {devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select style={{...st.input,width:'auto',fontSize:12,padding:'6px 10px'}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
          <button style={{...st.btn,...st.btnGray,fontSize:12}} onClick={loadClips}>↻ Refresh</button>
          <button style={{...st.btn,fontSize:12,
            backgroundColor:selectMode?C.blue:C.card,
            color:selectMode?'#fff':C.text,
            border:`1px solid ${selectMode?C.blue:C.border}`
          }} onClick={()=>{ setSelectMode(s=>!s); setSelected(new Set()); }}>
            {selectMode?'✕ Cancel':'☑ Select'}
          </button>
          {selectMode && selected.size>0 && (
            <button style={{...st.btn,...st.btnRed,fontSize:12}} onClick={deleteSelected}>
              🗑 Delete {selected.size}
            </button>
          )}
          {selectMode && (
            <button style={{...st.btn,...st.btnGray,fontSize:12}} onClick={selectAll}>
              Select All
            </button>
          )}
        </div>
      </div>

      <div style={{backgroundColor:'#1a1a0a',border:'1px solid #ffd70040',borderRadius:8,padding:'10px 14px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <span style={{fontSize:13,color:C.gold}}>🗓️ Retention: clips older than {retDays} days auto-deleted</span>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          {RETENTION_OPTIONS.map(o=>(
            <button key={o.value} onClick={()=>{ localStorage.setItem('retentionDays',String(o.value)); window.location.reload(); }}
              style={{...st.btn,fontSize:11,padding:'4px 8px',backgroundColor:retDays===o.value?C.gold:C.card,color:retDays===o.value?'#000':C.sub,border:'1px solid '+(retDays===o.value?C.gold:C.border)}}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{textAlign:'center',padding:40,color:C.sub}}>⏳ Loading clips...</div>}

      {!loading && clips.length===0 && (
        <div style={{...st.card,textAlign:'center',padding:40}}>
          <div style={{fontSize:48}}>🎬</div>
          <div style={{color:C.sub,marginTop:12}}>No clips yet — start monitoring and clips will appear here</div>
        </div>
      )}

      {!loading && Object.entries(grouped).filter(([deviceId])=>{
        const dev = devices.find(d=>d.id===deviceId);
        if (!dev) return false;
        if (dev.is_active===false) return false;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dev.name||'')) return false;
        return true;
      }).map(([deviceId, dclips])=>(
        <div key={deviceId} style={{marginBottom:24}}>
          <div style={{...st.flexBetween,marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:16}}>📷</span>
              <span style={{fontWeight:'bold',color:C.text}}>{getDeviceName(deviceId)}</span>
              <span style={{...st.badge,backgroundColor:'#00ff8820',color:C.green,border:'1px solid #00ff8840'}}>{dclips.length} clips</span>
            </div>
            <span style={{color:C.sub,fontSize:12}}>{fmtSize(dclips.reduce((a,c)=>a+(c.size||0),0))}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
            {dclips.map(clip=>(
              <div key={clip.id||clip.filename} style={{...st.card,padding:12,
                border: selectMode&&selected.has(clip.id) ? `2px solid ${C.green}` : `1px solid ${C.border}`
              }}>
                {selectMode && (
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <input type="checkbox" checked={selected.has(clip.id)} onChange={()=>toggleSelect(clip.id)}
                      style={{width:16,height:16,cursor:'pointer',accentColor:C.green}}/>
                    <span style={{fontSize:12,color:C.sub}}>Select</span>
                  </div>
                )}
                <div style={{backgroundColor:'#000',borderRadius:6,aspectRatio:'16/9',marginBottom:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',color:C.sub,position:'relative'}}
                  onClick={()=>{ if(selectMode){toggleSelect(clip.id);}else{setPlayingUrl(clip.url); setPlayingName(clip.filename);} }}>
                  <span style={{fontSize:32}}>▶</span>
                  <span style={{fontSize:11,marginTop:4}}>Click to play</span>
                  <span style={{position:'absolute',bottom:4,right:6,fontSize:11,color:'rgba(255,255,255,0.7)',backgroundColor:'rgba(0,0,0,0.5)',padding:'1px 5px',borderRadius:3}}>{fmtSize(clip.size)}</span>
                </div>
                <div style={{fontSize:12,color:C.sub,marginBottom:8}}>
                  <div style={{color:C.text,fontWeight:'bold',marginBottom:2,fontSize:11,wordBreak:'break-all',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {(clip.filename||'clip.webm').replace(/^clip_(security|dashcam)_[^_]+_/,'').replace(/_\d+\.webm$/,'.webm')}
                  </div>
                  <div>🕐 {fmtDate(clip.created_at)}</div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button style={{...st.btn,...st.btnGreen,flex:1,fontSize:11,padding:'6px 8px'}} onClick={()=>{ setPlayingUrl(clip.url); setPlayingName(clip.filename); }}>▶ Play</button>
                  <button style={{...st.btn,...st.btnGray,flex:1,fontSize:11,padding:'6px 8px'}} onClick={async()=>{
                    try {
                      const res = await fetch(clip.url);
                      const blob = await res.blob();
                      // Try modern file picker first
                      if (window.showSaveFilePicker) {
                        const fh = await window.showSaveFilePicker({suggestedName: clip.filename||'clip.webm', types:[{description:'Video',accept:{'video/webm':['.webm']}}]});
                        const w = await fh.createWritable();
                        await w.write(blob);
                        await w.close();
                      } else {
                        // Fallback: auto-download
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href=url; a.download=clip.filename||'clip.webm'; a.click();
                        setTimeout(()=>URL.revokeObjectURL(url),5000);
                      }
                    } catch(e) { if(e.name!=='AbortError') alert('Save failed: '+e.message); }
                  }}>⬇ Save</button>
                  <button style={{...st.btn,...st.btnRed,padding:'6px 10px',fontSize:12}} onClick={()=>deleteClip(clip.id)}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {playingUrl && (
        <div style={st.modal} onClick={()=>setPlayingUrl(null)}>
          <div style={{...st.modalBox,maxWidth:860,backgroundColor:'#000',border:'1px solid #333'}} onClick={e=>e.stopPropagation()}>
            <div style={{...st.flexBetween,marginBottom:8,padding:'0 4px'}}>
              <span style={{color:C.text,fontSize:12}}>{playingName}</span>
              <button style={{...st.btn,...st.btnGray,padding:'3px 10px'}} onClick={()=>setPlayingUrl(null)}>✕</button>
            </div>
            <video src={playingUrl} controls autoPlay style={{width:'100%',borderRadius:6,backgroundColor:'#000',maxHeight:'70vh'}}/>
          </div>
        </div>
      )}
    </div>
  );
}

function EventsPanel({ events, devices=[] }) {
  const [playingUrl, setPlayingUrl] = useState(null);
  const activeIds = new Set(devices.filter(d=>d.is_active!==false&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.name||'')).map(d=>d.id));
  const nonSystem = events.filter(e=>{
    if (e.type==='system'||e.type==='clip_ready') return false;
    if (e.deviceId && activeIds.size>0 && !activeIds.has(e.deviceId)) return false;
    return true;
  });
  return (
    <div style={st.card}>
      <div style={{...st.flexBetween,marginBottom:12}}>
        <span style={{fontWeight:'bold',fontSize:14}}>🚨 All Events</span>
        <span style={{...st.badge,backgroundColor:'#ff444420',color:C.red,border:`1px solid ${C.red}`}}>{nonSystem.length}</span>
      </div>
      {nonSystem.length===0 && <div style={{color:C.sub,fontSize:13,textAlign:'center',padding:'40px 0'}}>No events yet — arm a camera to start monitoring</div>}
      <div style={{maxHeight:500,overflowY:'auto'}}>
        {nonSystem.map(e=>(
          <div key={e.id}
            style={{display:'flex',gap:10,padding:'10px 0',borderBottom:`1px solid ${C.border}`,alignItems:'center',
              cursor: e.clip_url ? 'pointer' : 'default',
              backgroundColor: 'transparent',
            }}
            onClick={()=>{ if(e.clip_url) setPlayingUrl(e.clip_url); }}
          >
            <span style={{fontSize:22}}>{e.type==='motion'?'👁':'🔊'}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:'bold',fontSize:13}}>{e.type==='motion'?'Motion Detected':'Sound Detected'}</div>
              <div style={{color:C.green,fontSize:12}}>{e.deviceName}</div>
              <div style={{color:C.sub,fontSize:11}}>{e.time} • {e.date||''}</div>
            </div>
            {e.clip_url
              ? <button style={{...st.btn,...st.btnGreen,padding:'5px 10px',fontSize:11}}
                  onClick={ev=>{ev.stopPropagation(); setPlayingUrl(e.clip_url);}}>▶ Play</button>
              : e.clip_pending
                ? <span style={{fontSize:11,color:C.sub}}>⏳ Recording...</span>
                : <span style={{fontSize:11,color:'#444'}}>No clip</span>
            }
            <span style={{
              ...st.badge,
              backgroundColor:e.camMode==='security'?'#4488ff20':'#00ff8820',
              color:e.camMode==='security'?C.blue:C.green,
              border:`1px solid ${e.camMode==='security'?C.blue+'60':C.green+'60'}`,
              fontSize:10,
            }}>{e.camMode==='security'?'SEC':'DASH'}</span>
          </div>
        ))}
      </div>
      {playingUrl && (
        <div style={st.modal} onClick={()=>setPlayingUrl(null)}>
          <div style={{...st.modalBox,maxWidth:800,backgroundColor:'#000'}} onClick={e=>e.stopPropagation()}>
            <div style={{...st.flexBetween,marginBottom:8}}>
              <span style={{color:C.text,fontSize:12}}>Event Recording</span>
              <button style={{...st.btn,...st.btnGray,padding:'3px 10px'}} onClick={()=>setPlayingUrl(null)}>✕</button>
            </div>
            <video src={playingUrl} controls autoPlay style={{width:'100%',borderRadius:6,backgroundColor:'#000'}}/>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── QR Enrollment Modal ──────────────────────────────────────────
function EnrollmentModal({ onClose, onEnrolled }) {
  const [step,        setStep]        = useState('form');
  const [cameraName,  setCameraName]  = useState('');
  const [location,    setLocation]    = useState('');
  const [expiresIn,   setExpiresIn]   = useState(24);
  const [enrollData,  setEnrollData]  = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [copied,      setCopied]      = useState(false);
  const qrRef = useRef(null);

  const generate = async () => {
    if (!cameraName.trim()) return;
    setLoading(true);
    try {
      const res = await api.post('/api/enrollment/generate', { cameraName, location, expiresIn });
      setEnrollData(res.data.data);
      setStep('qr');
      setTimeout(()=>{
        if (qrRef.current) {
          qrRef.current.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(res.data.data.url)}&bgcolor=0a0a0a&color=00ff88&margin=10`;
        }
      }, 100);
    } catch(e) {
      alert('Failed to generate enrollment QR: ' + e.message);
    }
    setLoading(false);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(enrollData.url);
    setCopied(true);
    setTimeout(()=>setCopied(false), 2000);
  };

  const expiresLabel = (h) => h < 24 ? h+'h' : (h/24)+'d';

  return (
    <div style={st.modal} onClick={onClose}>
      <div style={{...st.modalBox, maxWidth:480}} onClick={e=>e.stopPropagation()}>
        <div style={{...st.flexBetween, marginBottom:16}}>
          <h2 style={{margin:0, color:C.green}}>📷 Enroll New Camera</h2>
          <button style={{...st.btn,...st.btnGray}} onClick={onClose}>✕</button>
        </div>

        {step==='form' && (
          <>
            <p style={{color:C.sub,fontSize:13,marginBottom:16}}>
              Generate a QR code. Any device that scans it automatically becomes a security camera in your system.
            </p>
            <label style={st.label}>Camera Name *</label>
            <input style={{...st.input,marginBottom:12}} value={cameraName}
              onChange={e=>setCameraName(e.target.value)}
              placeholder="e.g. Front Door, Garage, Living Room"/>
            <label style={st.label}>Location</label>
            <input style={{...st.input,marginBottom:12}} value={location}
              onChange={e=>setLocation(e.target.value)}
              placeholder="e.g. First Floor, Outside"/>
            <label style={st.label}>QR Code Valid For</label>
            <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
              {[1,6,24,48,168].map(h=>(
                <button key={h} onClick={()=>setExpiresIn(h)} style={{
                  ...st.btn, flex:1, fontSize:12,
                  backgroundColor: expiresIn===h ? C.green : C.card,
                  color: expiresIn===h ? '#000' : C.text,
                  border: `1px solid ${expiresIn===h ? C.green : C.border}`,
                }}>{expiresLabel(h)}</button>
              ))}
            </div>
            <div style={{backgroundColor:'#0a1a0a',border:`1px solid ${C.green}30`,borderRadius:8,padding:12,marginBottom:16,fontSize:12,color:C.sub}}>
              <div style={{color:C.green,fontWeight:'bold',marginBottom:4}}>📋 How it works</div>
              <div>1. Generate the QR code below</div>
              <div>2. Show it to the device you want to enroll (old phone, tablet, IP cam)</div>
              <div>3. Device scans QR → opens enrollment URL → auto-registers</div>
              <div>4. Camera appears in your dashboard instantly</div>
              <div style={{marginTop:6,color:'#666'}}>Only your 2 admin devices can view or trigger cameras</div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...st.btn,...st.btnGray,flex:1}} onClick={onClose}>Cancel</button>
              <button style={{...st.btn,...st.btnGreen,flex:2}} onClick={generate} disabled={loading||!cameraName.trim()||!location.trim()}>
                {loading ? 'Generating...' : '🔳 Generate QR Code'}
              </button>
            </div>
          </>
        )}

        {step==='qr' && enrollData && (
          <>
            <div style={{textAlign:'center',marginBottom:16}}>
              <div style={{backgroundColor:'#0a0a0a',borderRadius:12,padding:16,display:'inline-block',border:`2px solid ${C.green}`}}>
                <img ref={qrRef} alt="Enrollment QR Code" style={{width:220,height:220,display:'block'}}/>
              </div>
              <div style={{color:C.green,fontWeight:'bold',marginTop:10,fontSize:15}}>{cameraName}</div>
              {location && <div style={{color:C.sub,fontSize:12}}>📍 {location}</div>}
              <div style={{color:'#666',fontSize:11,marginTop:4}}>
                Expires: {new Date(enrollData.expiresAt).toLocaleString()} ({expiresIn}h)
              </div>
            </div>
            <div style={{backgroundColor:C.card,borderRadius:8,padding:10,marginBottom:12}}>
              <div style={{fontSize:11,color:C.sub,marginBottom:4}}>Enrollment URL (tap to copy):</div>
              <div style={{fontSize:11,color:C.green,wordBreak:'break-all',cursor:'pointer',fontFamily:'monospace'}}
                onClick={copyUrl}>
                {enrollData.url}
              </div>
            </div>
            <div style={{display:'flex',gap:6,marginBottom:12}}>
              <button style={{...st.btn,...st.btnGray,flex:1,fontSize:12}} onClick={copyUrl}>
                {copied ? '✅ Copied!' : '📋 Copy URL'}
              </button>
              <button style={{...st.btn,...st.btnGray,flex:1,fontSize:12}} onClick={()=>{
                const a = document.createElement('a');
                a.href = qrRef.current?.src;
                a.download = `enroll_${cameraName.replace(/\s+/g,'_')}.png`;
                a.click();
              }}>⬇️ Save QR</button>
            </div>
            <div style={{backgroundColor:'#0a1a0a',border:`1px solid ${C.green}30`,borderRadius:8,padding:10,fontSize:12,color:C.sub,marginBottom:12}}>
              <strong style={{color:C.text}}>📱 On the camera device:</strong>
              <div style={{marginTop:4}}>Open camera app → Scan QR code → Tap the link → Device auto-enrolls and appears in your dashboard</div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...st.btn,...st.btnGray,flex:1}} onClick={()=>setStep('form')}>← Back</button>
              <button style={{...st.btn,...st.btnGreen,flex:1}} onClick={()=>{ onClose(); }}>✓ Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Admin Management Modal ───────────────────────────────────────
function AdminManageModal({ onClose }) {
  const [admins,  setAdmins]  = useState([]);
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [selected,setSelected]= useState([]);

  useEffect(()=>{
    api.get('/api/enrollment/admins').then(r=>{
      const data = r.data.data || [];
      setUsers(data);
      setAdmins(data.filter(u=>u.is_admin).map(u=>u.id));
      setSelected(data.filter(u=>u.is_admin).map(u=>u.id));
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  const toggle = (id) => {
    setSelected(s => s.includes(id)
      ? s.filter(x=>x!==id)
      : s.length<2 ? [...s,id] : s
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/enrollment/set-admins', { adminUserIds: selected });
      alert('Admin devices updated!');
      onClose();
    } catch(e) { alert('Failed: '+e.message); }
    setSaving(false);
  };

  return (
    <div style={st.modal} onClick={onClose}>
      <div style={{...st.modalBox,maxWidth:440}} onClick={e=>e.stopPropagation()}>
        <div style={{...st.flexBetween,marginBottom:16}}>
          <h2 style={{margin:0,color:C.green}}>👥 Admin Devices</h2>
          <button style={{...st.btn,...st.btnGray}} onClick={onClose}>✕</button>
        </div>
        <div style={{backgroundColor:'#0a1a2a',border:`1px solid ${C.blue}30`,borderRadius:8,padding:12,marginBottom:16,fontSize:12,color:C.sub}}>
          <div style={{color:C.blue,fontWeight:'bold',marginBottom:4}}>📐 Access Control</div>
          <div>Select up to <strong style={{color:C.text}}>2 admin accounts</strong> (e.g. you and your spouse). Only admins can view live feeds and trigger cameras.</div>
        </div>
        {loading ? <div style={{textAlign:'center',padding:20,color:C.sub}}>Loading...</div> : (
          <div style={{marginBottom:16}}>
            {users.map(u=>(
              <div key={u.id} onClick={()=>toggle(u.id)} style={{
                display:'flex',alignItems:'center',gap:12,padding:'10px 12px',
                borderRadius:8,marginBottom:6,cursor:'pointer',
                backgroundColor: selected.includes(u.id) ? '#00ff8815' : C.card,
                border: `1px solid ${selected.includes(u.id) ? C.green : C.border}`,
              }}>
                <div style={{width:32,height:32,borderRadius:'50%',backgroundColor:selected.includes(u.id)?C.green:'#333',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:selected.includes(u.id)?'#000':'#666',fontWeight:'bold'}}>
                  {(u.first_name||u.email||'?')[0].toUpperCase()}
                </div>
                <div style={{flex:1}}>
                  <div style={{color:C.text,fontSize:13,fontWeight:'bold'}}>{u.first_name} {u.last_name}</div>
                  <div style={{color:C.sub,fontSize:11}}>{u.email}</div>
                </div>
                <div style={{color:selected.includes(u.id)?C.green:C.sub,fontSize:12}}>
                  {selected.includes(u.id) ? '✓ Admin' : '○'}
                </div>
              </div>
            ))}
            {users.length===0 && <div style={{color:C.sub,textAlign:'center',padding:20}}>No users found</div>}
          </div>
        )}
        <div style={{color:C.sub,fontSize:11,marginBottom:12,textAlign:'center'}}>
          {selected.length}/2 admin slots used
        </div>
        <div style={{display:'flex',gap:8}}>
          <button style={{...st.btn,...st.btnGray,flex:1}} onClick={onClose}>Cancel</button>
          <button style={{...st.btn,...st.btnGreen,flex:1}} onClick={save} disabled={saving}>
            {saving?'Saving...':'Save Admins'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Device Modal ─────────────────────────────────────────────
function AddDeviceModal({ onClose, onAdded }) {
  const [name,setName]=useState('');
  const [loc,setLoc]=useState('');
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState('');
  const submit = async () => {
    if (!name.trim()) { setErr('Camera name is required.'); return; }
    if (!loc.trim())  { setErr('Location is required.');    return; }
    setErr(''); setLoading(true);
    try {
      await api.post('/api/devices', { name: name.trim(), location: loc.trim(), rtsp_url: '' });
      onAdded();
      onClose();
    } catch(ex) {
      setErr(ex.response?.data?.message || 'Failed to add camera. Please try again.');
    }
    setLoading(false);
  };
  return (
    <div style={st.modal} onClick={onClose}>
      <div style={st.modalBox} onClick={e=>e.stopPropagation()}>
        <h2 style={{marginTop:0,color:C.green}}>➕ Add Camera</h2>
        <p style={{color:C.sub,fontSize:13,marginBottom:16}}>Register a new IP camera or placeholder entry.</p>
        <label style={st.label}>Camera Name *</label>
        <input
          style={{...st.input,marginBottom:12,borderColor:err&&!name.trim()?C.red:C.border}}
          value={name}
          onChange={e=>{setName(e.target.value);setErr('');}}
          placeholder="e.g. Front Door, Garage"
          autoFocus
        />
        <label style={st.label}>Location *</label>
        <input
          style={{...st.input,marginBottom:err?8:16,borderColor:err&&!loc.trim()?C.red:C.border}}
          value={loc}
          onChange={e=>{setLoc(e.target.value);setErr('');}}
          placeholder="e.g. Front Yard, Master Bedroom"
          onKeyDown={e=>{ if(e.key==='Enter') submit(); }}
        />
        {err && <p style={{color:C.red,fontSize:12,marginBottom:12,marginTop:0}}>{err}</p>}
        <div style={{display:'flex',gap:8}}>
          <button style={{...st.btn,...st.btnGray,flex:1}} onClick={onClose} disabled={loading}>Cancel</button>
          <button style={{...st.btn,...st.btnGreen,flex:2}} onClick={submit} disabled={loading}>
            {loading ? '⏳ Adding...' : '✓ Add Camera'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Subscription Page ────────────────────────────────────────────
// ─── Subscription Page ────────────────────────────────────────────────────────
// Drop-in replacement for the SubscriptionPage function in App.js
// Connects to real /api/billing endpoints and Stripe checkout

function SubscriptionPage() {
  const [billing,      setBilling]      = useState(null);
  const [plans,        setPlans]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [upgrading,    setUpgrading]    = useState('');
  const [coupon,       setCoupon]       = useState('');
  const [couponInput,  setCouponInput]  = useState('');
  const [portalLoading,setPortalLoading]= useState(false);
  const [error,        setError]        = useState('');

  useEffect(()=>{
    loadBillingData();
  },[]);

  // Check for billing success/cancel in URL
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      const plan = params.get('plan');
      showToastMsg(`✅ ${plan ? plan.charAt(0).toUpperCase()+plan.slice(1) : 'Plan'} activated! Welcome aboard.`);
      window.history.replaceState({}, '', window.location.pathname);
      loadBillingData();
    }
    if (params.get('billing') === 'cancelled') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  },[]);

  const showToastMsg = (msg) => {
    // Use the parent app's toast if available, else alert
    const event = new CustomEvent('rsc:toast', { detail: msg });
    window.dispatchEvent(event);
  };

  const loadBillingData = async () => {
    setLoading(true);
    try {
      const [billingRes, plansRes] = await Promise.all([
        api.get('/api/billing/status'),
        api.get('/api/billing/plans'),
      ]);
      setBilling(billingRes.data.billing);
      setPlans(plansRes.data.plans);
    } catch(e) {
      setError('Failed to load billing info: ' + (e.response?.data?.message || e.message));
    }
    setLoading(false);
  };

  const subscribe = async (planId) => {
    if (planId === 'free') return;
    setUpgrading(planId);
    setError('');
    try {
      const res = await api.post('/api/billing/subscribe', {
        plan: planId,
        coupon: coupon || undefined,
      });
      if (res.data.checkout_url) {
        window.location.href = res.data.checkout_url;
      }
    } catch(e) {
      setError(e.response?.data?.message || 'Failed to start checkout');
      setUpgrading('');
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await api.post('/api/billing/portal');
      if (res.data.portal_url) window.location.href = res.data.portal_url;
    } catch(e) {
      setError('Failed to open billing portal: ' + (e.response?.data?.message || e.message));
    }
    setPortalLoading(false);
  };

  const applyCoupon = () => {
    setCoupon(couponInput.trim().toUpperCase());
    setCouponInput('');
  };

  const removeCoupon = () => {
    setCoupon('');
    setCouponInput('');
  };

  // Plan display config
  const PLAN_CONFIG = {
    free:       { color: C.sub,   icon: '🔓', popular: false },
    pro:        { color: C.green, icon: '⚡', popular: true  },
    business:   { color: C.blue,  icon: '🏢', popular: false },
    enterprise: { color: C.gold,  icon: '👑', popular: false },
  };

  const currentPlan = billing?.plan || 'free';
  const isPaid = currentPlan !== 'free';

  if (loading) return (
    <div style={{textAlign:'center',padding:60,color:C.sub}}>
      <div style={{fontSize:32,marginBottom:12}}>⏳</div>
      Loading billing info...
    </div>
  );

  return (
    <div style={{maxWidth:1000,margin:'0 auto'}}>
      <div style={{...st.flexBetween,marginBottom:8,flexWrap:'wrap',gap:8}}>
        <div>
          <h2 style={{color:C.green,margin:0}}>⭐ Subscription</h2>
          <p style={{color:C.sub,margin:'4px 0 0',fontSize:13}}>
            Current plan: <span style={{color:C.text,fontWeight:'bold'}}>{billing?.plan_name || 'Free'}</span>
            {billing?.plan_expires_at && (
              <span style={{color:C.sub}}> · Renews {new Date(billing.plan_expires_at).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        {isPaid && (
          <button
            style={{...st.btn,...st.btnGray,fontSize:13}}
            onClick={openPortal}
            disabled={portalLoading}
          >
            {portalLoading ? 'Opening...' : '💳 Manage Billing'}
          </button>
        )}
      </div>

      {error && (
        <div style={{backgroundColor:'#ff444420',border:`1px solid ${C.red}`,borderRadius:8,
          padding:'10px 14px',marginBottom:16,color:C.red,fontSize:13}}>
          {error}
        </div>
      )}

      {/* Current usage */}
      {billing?.usage && (
        <div style={{...st.card,marginBottom:20,display:'grid',
          gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:12}}>
          {[
            { label:'Cameras',     used: billing.usage.cameras,     limit: billing.limits.cameras,     unit:'' },
            { label:'SSIDs',       used: billing.usage.ssids,       limit: billing.limits.ssids,       unit:'' },
            { label:'Storage',     used: billing.usage.storage_gb,  limit: billing.limits.storage_gb,  unit:'GB' },
            { label:'Liberations', used: billing.usage.liberations_this_month ?? billing.usage.liberations ?? 0, limit: billing.limits.liberations_per_month, unit:'/mo' },
          ].map(item => {
            const pct = item.limit > 0 ? Math.min(100, (item.used / item.limit) * 100) : 0;
            const isUnlimited = item.limit === -1;
            const color = pct > 90 ? C.red : pct > 70 ? C.gold : C.green;
            return (
              <div key={item.label} style={{textAlign:'center'}}>
                <div style={{fontSize:11,color:C.sub,marginBottom:4}}>{item.label}</div>
                <div style={{fontSize:16,fontWeight:'bold',color}}>
                  {item.used}{item.unit}
                  <span style={{fontSize:11,color:C.sub,fontWeight:'normal'}}>
                    /{isUnlimited ? '∞' : item.limit+item.unit}
                  </span>
                </div>
                {!isUnlimited && (
                  <div style={{backgroundColor:C.border,borderRadius:4,height:3,marginTop:4}}>
                    <div style={{backgroundColor:color,height:3,borderRadius:4,width:pct+'%',transition:'width 0.3s'}}/>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Coupon input */}
      {!isPaid && (
        <div style={{...st.card,marginBottom:20,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:13,color:C.sub}}>🎟 Coupon code:</span>
          {coupon ? (
            <>
              <span style={{backgroundColor:C.green+'20',color:C.green,padding:'4px 10px',borderRadius:6,fontSize:13,fontWeight:'bold',border:`1px solid ${C.green}40`}}>
                {coupon} ✓
              </span>
              <button style={{...st.btn,...st.btnGray,fontSize:12,padding:'4px 10px'}} onClick={removeCoupon}>Remove</button>
            </>
          ) : (
            <>
              <input
                style={{...st.input,flex:1,minWidth:140,maxWidth:200,fontSize:13,padding:'6px 10px'}}
                placeholder="Enter coupon code"
                value={couponInput}
                onChange={e=>setCouponInput(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&applyCoupon()}
              />
              <button style={{...st.btn,...st.btnGreen,fontSize:12}} onClick={applyCoupon} disabled={!couponInput.trim()}>
                Apply
              </button>
            </>
          )}
        </div>
      )}

      {/* Plans grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16,marginBottom:24}}>
        {plans.map(plan => {
          const cfg = PLAN_CONFIG[plan.id] || { color: C.sub, icon: '📦', popular: false };
          const isCurrent = currentPlan === plan.id;
          const isDowngrade = plan.id === 'free' && isPaid;
          const price = plan.price === 0 ? '$0' : `$${(plan.price/100).toFixed(2)}`;

          return (
            <div key={plan.id} style={{
              ...st.card,
              border: `2px solid ${isCurrent ? cfg.color : C.border}`,
              position:'relative',
              transition:'border-color 0.2s',
            }}>
              {cfg.popular && !isCurrent && (
                <div style={{position:'absolute',top:-10,left:'50%',transform:'translateX(-50%)',
                  backgroundColor:C.green,color:'#000',padding:'2px 12px',borderRadius:10,
                  fontSize:10,fontWeight:'bold',whiteSpace:'nowrap'}}>
                  MOST POPULAR
                </div>
              )}
              {isCurrent && (
                <div style={{position:'absolute',top:-10,right:12,
                  backgroundColor:cfg.color,color:'#000',padding:'2px 10px',borderRadius:10,
                  fontSize:10,fontWeight:'bold'}}>
                  CURRENT
                </div>
              )}

              <div style={{marginBottom:12}}>
                <div style={{fontSize:22,marginBottom:4}}>{cfg.icon}</div>
                <div style={{fontSize:18,fontWeight:'bold',color:cfg.color}}>{plan.name}</div>
                <div style={{fontSize:22,fontWeight:'bold',color:C.text,marginTop:4}}>
                  {price}<span style={{fontSize:13,color:C.sub,fontWeight:'normal'}}>/mo</span>
                </div>
              </div>

              <div style={{marginBottom:16,fontSize:12,color:C.sub}}>
                {[
                  `${plan.cameras === -1 ? 'Unlimited' : plan.cameras} cameras`,
                  `${plan.ssids} SSIDs`,
                  `${plan.retention_days}-day retention`,
                  `${plan.storage_gb === 1024 ? '1TB' : plan.storage_gb+'GB'} storage`,
                  plan.ai_intelligence ? '🤖 AI Intelligence' : null,
                  plan.liberations_per_month === -1 ? 'Unlimited liberations' :
                    plan.liberations_per_month > 0 ? `${plan.liberations_per_month} liberations/mo` : null,
                  `${plan.admins === -1 ? 'Unlimited' : plan.admins} admin${plan.admins === 1 ? '' : 's'}`,
                ].filter(Boolean).map((f,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
                    <span style={{color:cfg.color}}>✓</span> {f}
                  </div>
                ))}
              </div>

              {isCurrent ? (
                <div style={{textAlign:'center',padding:'10px',color:cfg.color,fontWeight:'bold',fontSize:13,
                  border:`1px solid ${cfg.color}40`,borderRadius:6}}>
                  ✓ Active Plan
                </div>
              ) : isDowngrade ? (
                <button
                  style={{...st.btn,width:'100%',padding:10,backgroundColor:'transparent',
                    color:C.sub,border:`1px solid ${C.border}`,fontSize:13}}
                  onClick={openPortal}
                  disabled={portalLoading}
                >
                  Downgrade via Portal
                </button>
              ) : plan.id === 'free' ? (
                <div style={{textAlign:'center',padding:10,color:C.sub,fontSize:12}}>
                  Free forever
                </div>
              ) : (
                <button
                  style={{...st.btn,width:'100%',padding:10,fontSize:13,fontWeight:'bold',
                    backgroundColor:cfg.color,
                    color: plan.id==='enterprise'?'#000':'#000',
                    opacity: upgrading===plan.id ? 0.7 : 1,
                  }}
                  onClick={()=>subscribe(plan.id)}
                  disabled={!!upgrading}
                >
                  {upgrading===plan.id ? '⏳ Redirecting...' :
                    coupon ? `Upgrade with ${coupon}` : `Upgrade to ${plan.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Overage rates */}
      <div style={{...st.card,marginBottom:16}}>
        <div style={{fontWeight:'bold',color:C.text,marginBottom:12,fontSize:14}}>💰 Overage & Add-On Rates</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,fontSize:12,color:C.sub}}>
          <div>
            <div style={{color:C.text,fontWeight:'bold',marginBottom:6}}>Storage Overages (per 5GB chunk)</div>
            <div>Free: $0.99/GB</div>
            <div>Pro: $0.49/GB</div>
            <div>Business: $0.39/GB</div>
            <div>Enterprise: $0.33/GB</div>
          </div>
          <div>
            <div style={{color:C.text,fontWeight:'bold',marginBottom:6}}>Camera Liberations</div>
            <div>Free: $9.99/device</div>
            <div>Pro: $4.99/device (after 3 free)</div>
            <div>Business: $2.99/device (after 10 free)</div>
            <div>Enterprise: Included</div>
          </div>
          <div>
            <div style={{color:C.text,fontWeight:'bold',marginBottom:6}}>Grace Periods</div>
            <div>Low usage: 72 hours</div>
            <div>Medium usage: 48 hours</div>
            <div>High usage: 24 hours</div>
            <div style={{marginTop:4,color:C.green,fontSize:11}}>✓ 60-day add-on optimization</div>
          </div>
        </div>
      </div>

      <p style={{color:'#444',fontSize:12,textAlign:'center'}}>
        Payments via Stripe · Cancel anytime · Unused liberations expire monthly
      </p>
    </div>
  );
}


// ─── Login ────────────────────────────────────────────────────────

// ─── Network Scanner (WebRTC-based — works on HTTPS) ─────────────
async function getLocalIPs() {
  return new Promise((resolve) => {
    const ips = new Set();
    const pc = new RTCPeerConnection({ iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]});
    pc.createDataChannel('');
    pc.onicecandidate = (e) => {
      if (!e.candidate) {
        pc.close();
        resolve([...ips]);
        return;
      }
      // Extract IP from ICE candidate
      const parts = e.candidate.candidate.split(' ');
      const ip = parts[4];
      if (ip && !ip.includes(':') && ip !== '0.0.0.0') {
        ips.add(ip);
        // Also add subnet range
        const subnet = ip.split('.').slice(0,3).join('.');
        ips.add(subnet);
      }
    };
    pc.createOffer().then(o => pc.setLocalDescription(o));
    // Timeout after 3 seconds
    setTimeout(() => { pc.close(); resolve([...ips]); }, 3000);
  });
}

async function scanLocalNetwork() {
  const localData = await getLocalIPs();
  // Extract subnet (e.g. "192.168.1" from "192.168.1.5" or direct subnet)
  let subnet = '192.168.1';
  for (const ip of localData) {
    const parts = ip.split('.');
    if (parts.length === 3) { subnet = ip; break; }
    if (parts.length === 4 && parts[0] !== '169') {
      subnet = parts.slice(0,3).join('.');
      break;
    }
  }

  // Use WebSocket probing — works cross-origin on HTTPS
  const alive = [];
  const probe = (ip) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${ip}:80`);
    const timer = setTimeout(() => { ws.close(); resolve(null); }, 400);
    ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(ip); };
    ws.onerror = (e) => {
      clearTimeout(timer);
      // onerror fires on connection refused — means host exists!
      // If error is not timeout, the IP is reachable
      resolve(e.type === 'error' ? ip : null);
    };
  });

  const promises = [];
  for (let i = 1; i <= 254; i++) {
    promises.push(probe(`${subnet}.${i}`));
  }

  // Batch of 40 at a time
  for (let i = 0; i < promises.length; i += 40) {
    const batch = await Promise.allSettled(promises.slice(i, i+40));
    batch.forEach(r => { if (r.value) alive.push(r.value); });
  }
  return alive;
}

// Probe for camera ports using WebSocket
async function probeDevice(ip) {
  const ports = [
    { port: 554,  type: 'IPCamera',  label: 'RTSP Camera' },
    { port: 8080, type: 'IPCamera',  label: 'IP Camera (8080)' },
    { port: 80,   type: 'IPCamera',  label: 'HTTP Camera' },
    { port: 8081, type: 'RSCCamera', label: 'Real Security Camera' },
  ];
  for (const p of ports) {
    const found = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://${ip}:${p.port}`);
      const t = setTimeout(() => { ws.close(); resolve(false); }, 500);
      ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
      ws.onerror = () => { clearTimeout(t); resolve(true); }; // host exists
    });
    if (found) return { type: p.type, label: p.label, port: p.port };
  }
  return null;
}

// ─── MAC OUI Database ─────────────────────────────────────────────
const OUI_MAP = {
  '00:03:93':'iOS','00:0A:95':'iOS','00:1C:B3':'iOS','00:21:E9':'iOS',
  '04:0C:CE':'iOS','04:26:65':'iOS','04:52:F3':'iOS','04:54:53':'iOS',
  '00:07:AB':'Android','00:12:47':'Android','00:15:99':'Android',
  '00:1A:8A':'Android','00:1D:25':'Android','04:18:0F':'Android',
  'F4:F5:D8':'Android','3C:5A:B4':'Android',
  '00:12:17':'IPCamera','44:19:B6':'IPCamera','4C:BD:8F':'IPCamera',
  'BC:AD:28':'IPCamera','B4:A3:82':'IPCamera','EC:71:DB':'IPCamera',
  '00:40:8C':'IPCamera','AC:CC:8E':'IPCamera','28:57:BE':'IPCamera',
};
function identifyDevice(mac) {
  if (!mac) return 'Unknown';
  return OUI_MAP[mac.substring(0,8).toUpperCase()] || 'Unknown';
}

// ─── MAC → Brand/RTSP detection ──────────────────────────────────
const MAC_BRANDS = {
  // Sercomm/ADC
  '00:0E:8F':'Sercomm','2C:26:17':'Sercomm','B0:B2:DC':'Sercomm',
  // Zmodo/Monitorix
  'B8:3A:9D':'Zmodo','54:C4:15':'Zmodo',
  // Hikvision
  '00:12:17':'Hikvision','44:19:B6':'Hikvision','4C:BD:8F':'Hikvision',
  'BC:AD:28':'Hikvision','C0:56:E3':'Hikvision',
  // Dahua
  '00:12:45':'Dahua','28:57:BE':'Dahua','34:E1:D0':'Dahua',
  'E0:50:8B':'Dahua','90:02:A9':'Dahua',
  // Reolink
  'B4:A3:82':'Reolink','EC:71:DB':'Reolink','00:62:6E':'Reolink',
  // Axis
  '00:40:8C':'Axis','AC:CC:8E':'Axis','B8:A4:4F':'Axis',
  // Amcrest
  '9C:8E:CD':'Amcrest','00:0C:E5':'Amcrest',
  // TP-Link
  '50:C7:BF':'TP-Link','B0:4E:26':'TP-Link',
  // Foscam
  'C4:D9:87':'Foscam','00:00:C0':'Foscam',
  // Wyze
  '2C:AA:8E':'Wyze','D0:3F:27':'Wyze',
};

const RTSP_TEMPLATES = {
  'Hikvision': (ip) => `rtsp://admin:password@${ip}:554/Streaming/Channels/101`,
  'Dahua':     (ip) => `rtsp://admin:password@${ip}:554/cam/realmonitor?channel=1&subtype=0`,
  'Reolink':   (ip) => `rtsp://admin:password@${ip}:554/h264Preview_01_main`,
  'Sercomm':   (ip) => `rtsp://root:adcvideo@${ip}:554/stream1`,
    'Zmodo':     (ip) => `rtsp://admin:password@${ip}:554/live/main`,
  'Axis':      (ip) => `rtsp://admin:password@${ip}:554/axis-media/media.amp`,
  'Amcrest':   (ip) => `rtsp://admin:password@${ip}:554/cam/realmonitor?channel=1`,
  'TP-Link':   (ip) => `rtsp://admin:password@${ip}:554/stream1`,
  'Foscam':    (ip) => `rtsp://admin:password@${ip}:554/videoMain`,
  'Wyze':      (ip) => `rtsp://admin:password@${ip}:554/live`,
  'default':   (ip) => `rtsp://admin:password@${ip}:554/stream`,
};

function getMacBrand(mac) {
  if (!mac) return null;
  const prefix = mac.substring(0,8).toUpperCase().replace(/-/g,':');
  return MAC_BRANDS[prefix] || null;
}

function getRtspSuggestion(ip, mac) {
  const brand = getMacBrand(mac);
  const template = brand ? RTSP_TEMPLATES[brand] : RTSP_TEMPLATES['default'];
  return { brand, rtsp: template ? template(ip) : RTSP_TEMPLATES['default'](ip) };
}

// ─── Discover Page ────────────────────────────────────────────────
function DiscoverPage({ socket, onDeviceAdded, onEnroll }) {
  const [scanning,     setScanning]     = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [discovered,   setDiscovered]   = useState([]);
  const [enrolling,    setEnrolling]    = useState(null);
    const [enrollPending, setEnrollPending] = useState(null);
  const [removing,     setRemoving]     = useState(null);
  const [mdnsDevices,  setMdnsDevices]  = useState([]);

  useEffect(()=>{
    if (!socket) return;
    socket.on('mdns:device', (device)=>{
      setMdnsDevices(d=>[...d.filter(x=>x.id!==device.id), device]);
    });
    return ()=>socket.off('mdns:device');
  },[socket]);

  // Auto-scan on page load
  useEffect(() => { scanNetwork(); }, []);

  const scanNetwork = async () => {
    setScanning(true);
    setScanProgress('Checking backend for discovered devices...');
    setDiscovered([]);
    try {
      const res = await api.get('/api/devices/discover');
      const found = res.data.data || [];
      mdnsDevices.forEach(m => { if (!found.find(d => d.ip === m.ip)) found.push(m); });
      setDiscovered(found);
      setScanProgress(found.length > 0
        ? `Found ${found.length} device(s)`
        : 'No devices found — run the discovery agent on your local network');
    } catch(e) {
      setScanProgress('Error: ' + (e.response?.data?.message || e.message));
    }
    setScanning(false);
  };

  const enroll = (device) => {
    const { brand, rtsp } = getRtspSuggestion(device.ip, device.mac);
    const cameraName = brand ? `${brand} Camera (${device.ip})` : (device.name || device.device_name || `Camera Device (${device.ip})`);
    const loc = (device.location && !/^\d+\.\d+\.\d+\.\d+$/.test(device.location)) ? device.location : '';
    setEnrollPending({ name: cameraName, location: loc, rtsp: rtsp||'', device });
  };

  const confirmEnroll = async () => {
    if (!enrollPending) return;
    const { name, location, rtsp, device } = enrollPending;
    setEnrolling(device.id || device.ip);
    setEnrollPending(null);
    try {
      await api.post('/api/devices', {
        name,
        location,
        rtsp_url: rtsp || '',
      });
      setDiscovered(d => d.map(x =>
        (x.id || x.ip) === (device.id || device.ip)
          ? { ...x, source: 'registered', is_active: true }
          : x
      ));
      if (onDeviceAdded) onDeviceAdded();
      setScanProgress(`✅ ${name} enrolled — set RTSP password in Camera Settings if needed`);
    } catch(e) {
      alert('Enrollment failed: ' + (e.response?.data?.message || e.message));
    }
    setEnrolling(null);
  };

  const unenroll = async (device) => {
    if (!window.confirm(`Remove "${device.name || device.device_name || device.ip}"?`)) return;
    setRemoving(device.id);
    try {
      await api.delete(`/api/devices/${device.id}`);
      setDiscovered(d => d.filter(x => x.id !== device.id));
      if (onDeviceAdded) onDeviceAdded();
    } catch(e) {
      alert('Remove failed: ' + (e.response?.data?.message || e.message));
    }
    setRemoving(null);
  };

  // Deduplicate: if same IP appears as both 'registered' and 'agent', keep registered only
  const deduped = [];
  const seenIPs = new Set();
  const seenIDs = new Set();
  // First pass: registered devices (skip unscanned QR — is_active=false)
  discovered.filter(d => d.source === 'registered' && d.is_active !== false).forEach(d => {
    if (!seenIDs.has(d.id)) { deduped.push(d); seenIDs.add(d.id); if(d.location) seenIPs.add(d.location); }
  });
  // Second pass: agent/ARP devices not already registered
  discovered.filter(d => d.source !== 'registered' && (d.ip || d.mac)).forEach(d => {
    if (!seenIPs.has(d.ip) && !seenIDs.has(d.id||d.ip)) {
      deduped.push(d); if(d.ip) seenIPs.add(d.ip);
    }
  });
  mdnsDevices.filter(m => !seenIPs.has(m.ip)).forEach(m => deduped.push(m));
  const allDevices = deduped;
  const typeIcon = (t) => t==='iOS'?'📱':t==='Android'?'🤖':t==='IPCamera'?'📹':t==='RSCCamera'?'📱':'📡';
  const isRegistered = (d) => d.source === 'registered';

  return (
    <div style={{padding:24,maxWidth:900,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div>
          <h2 style={{color:C.text,margin:0,fontSize:20}}>📍 Discover Cameras</h2>
          <p style={{color:C.sub,fontSize:13,margin:'4px 0 0'}}>Find phones and IP cameras on your network</p>
        </div>
        <button style={{...st.btn,...st.btnGreen,display:'flex',alignItems:'center',gap:8}}
          onClick={scanNetwork} disabled={scanning}>
          {scanning ? '⏳ Scanning...' : '📍 Scan Network'}
        </button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
        <div style={{...st.card,borderColor:C.green+'40',backgroundColor:C.green+'08'}}>
          <div style={{fontWeight:'bold',color:C.green,marginBottom:4}}>🖥️ Discovery Agent</div>
          <div style={{color:C.sub,fontSize:12}}>Run on any PC on your network — scans via ARP + port probing + credential detection.</div>
          <div style={{marginTop:8,fontFamily:'monospace',fontSize:11,color:C.green,
            backgroundColor:'rgba(0,0,0,0.3)',padding:'6px 8px',borderRadius:4}}>
            node discovery-agent.js
          </div>
        </div>
        <div style={{...st.card,borderColor:C.blue+'40',backgroundColor:C.blue+'08'}}>
          <div style={{fontWeight:'bold',color:C.blue,marginBottom:4}}>📱 Mobile App</div>
          <div style={{color:C.sub,fontSize:12}}>Phones running the RSC app register automatically via Socket.io — no scanning needed.</div>
        </div>
      </div>

      <div style={{...st.card,marginBottom:20,display:'flex',alignItems:'center',gap:12}}>
        <span style={{fontSize:24}}>🔳</span>
        <div style={{flex:1}}>
          <div style={{fontWeight:'bold',color:C.text}}>QR Code Enrollment</div>
          <div style={{color:C.sub,fontSize:12}}>Use the Enroll Camera button to generate a QR code — works anywhere</div>
        </div>
      </div>

      {scanProgress && <div style={{color:C.sub,fontSize:12,marginBottom:12,textAlign:'center'}}>{scanProgress}</div>}

      {scanning && (
        <div style={{textAlign:'center',padding:40}}>
          <div style={{color:C.green,fontSize:16,marginBottom:8}}>⏳ Scanning network...</div>
          <div style={{backgroundColor:C.border,borderRadius:4,height:4,width:'100%',maxWidth:300,margin:'0 auto'}}>
            <div style={{backgroundColor:C.green,height:4,borderRadius:4,width:'60%'}}/>
          </div>
        </div>
      )}

      {!scanning && allDevices.length===0 && (
        <div style={{textAlign:'center',padding:60}}>
          <div style={{fontSize:48,marginBottom:16}}>📡</div>
          <div style={{color:C.text,fontSize:18,marginBottom:8}}>No devices found yet</div>
          <div style={{color:C.sub,fontSize:13}}>Make sure devices are on the same WiFi, then click Scan Network</div>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
        {allDevices.map(d => {
          const enrolled = isRegistered(d);
          const brand = getMacBrand(d.mac);
          return (
            <div key={d.id||d.ip} style={{...st.card,
              borderColor: enrolled ? C.blue+'60' : C.green+'40',
              backgroundColor: enrolled ? C.blue+'08' : 'transparent'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                <span style={{fontSize:28}}>{typeIcon(d.type)}</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:'bold',color:C.text,fontSize:14}}>
                    {d.name || d.device_name || `${d.type||'Camera'} Device`}
                  </div>
                  <div style={{color:C.sub,fontSize:11,marginTop:2}}>
                    {d.ip&&`IP: ${d.ip}`}{d.mac&&` · MAC: ${d.mac}`}
                    {d.location&&!d.ip&&`📍 ${d.location}`}
                  </div>
                  {brand && !enrolled && (
                    <div style={{color:C.green,fontSize:10,marginTop:2,fontWeight:'bold'}}>
                      🏷 {brand} · RTSP ready
                    </div>
                  )}
                </div>
                <span style={{fontSize:10,
                  backgroundColor: enrolled ? C.blue+'20' : C.green+'20',
                  color: enrolled ? C.blue : C.green,
                  padding:'2px 8px',borderRadius:10,fontWeight:'bold'}}>
                  {enrolled ? 'ACTIVE' : (d.source==='mdns'?'mDNS':'ARP')}
                </span>
              </div>
              {enrolled ? (
                <button
                  style={{...st.btn,width:'100%',backgroundColor:'transparent',
                    border:`1px solid ${C.red}40`,color:C.red,
                    opacity:removing===d.id?0.6:1}}
                  onClick={()=>unenroll(d)}
                  disabled={removing===d.id}>
                  {removing===d.id?'Removing...':'🗑 Remove / Un-enroll'}
                </button>
              ) : (
                <button
                  style={{...st.btn,...st.btnGreen,width:'100%',
                    opacity:enrolling===(d.id||d.ip)?0.6:1}}
                  onClick={()=>enroll(d)}
                  disabled={enrolling===(d.id||d.ip)}>
                  {enrolling===(d.id||d.ip)?'Enrolling...':'+ Enroll Camera'}
                </button>
              )}
            </div>
          );
        })}

      {enrollPending && (
        <div style={st.modal} onClick={()=>setEnrollPending(null)}>
          <div style={{...st.modalBox,maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 16px',color:C.green}}>Confirm Camera Enrollment</h3>
            <p style={{color:C.sub,fontSize:13,marginBottom:16}}>Review detected info — edit if needed.</p>
            <label style={st.label}>Camera Name *</label>
            <input style={{...st.input,marginBottom:12}}
              value={enrollPending.name}
              onChange={e=>setEnrollPending(p=>({...p,name:e.target.value}))}
              placeholder="e.g. Front Door Camera"/>
            <label style={st.label}>Location *</label>
            <input style={{...st.input,marginBottom:16}}
              value={enrollPending.location}
              onChange={e=>setEnrollPending(p=>({...p,location:e.target.value}))}
              placeholder="e.g. Front Yard, Living Room"/>
            {enrollPending.rtsp && (
              <div style={{fontSize:11,color:C.sub,marginBottom:12,fontFamily:'monospace',wordBreak:'break-all'}}>
                RTSP: {enrollPending.rtsp}
              </div>
            )}
            <div style={{display:'flex',gap:8}}>
              <button style={{...st.btn,...st.btnGray,flex:1}} onClick={()=>setEnrollPending(null)}>Cancel</button>
              <button style={{...st.btn,...st.btnGreen,flex:2}}
                disabled={!enrollPending.name.trim()||!enrollPending.location.trim()}
                onClick={confirmEnroll}>Add Camera</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );

}

// ─── Admin Page ───────────────────────────────────────────────────
function AdminPage({ user }) {
  const [members,  setMembers]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [invEmail, setInvEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  // TODO: ENABLE PAYWALL — max 2 admins on free plan
  const MAX_ADMINS = 2;

  useEffect(()=>{ loadMembers(); },[]);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/org/members');
      setMembers(res.data.data||[]);
    } catch(e) { console.log(e.message); }
    setLoading(false);
  };

  const grantAdmin = async (userId) => {
    const adminCount = members.filter(m=>m.role==='admin').length;
    if (adminCount >= MAX_ADMINS) {
      // TODO: ENABLE PAYWALL — show upgrade modal here
      alert(`Admin limit reached. Your plan allows ${MAX_ADMINS} admins. Upgrade to add more.`);
      return;
    }
    try {
      await api.put(`/api/org/members/${userId}/role`, { role:'admin' });
      loadMembers();
    } catch(e) { alert('Failed to grant admin'); }
  };

  const revokeAdmin = async (userId) => {
    if (!window.confirm('Remove admin access for this user?')) return;
    try {
      await api.put(`/api/org/members/${userId}/role`, { role:'viewer' });
      loadMembers();
    } catch(e) { alert('Failed to revoke admin'); }
  };

  const inviteUser = async () => {
    if (!invEmail) return;
    setInviting(true);
    try {
      await api.post('/api/org/invite', { email: invEmail });
      alert(`Invitation sent to ${invEmail}`);
      setInvEmail('');
      loadMembers();
    } catch(e) { alert(e.response?.data?.message||'Invitation failed'); }
    setInviting(false);
  };

  const adminCount = members.filter(m=>m.role==='admin').length;

  return (
    <div style={{padding:24,maxWidth:800,margin:'0 auto'}}>
      <h2 style={{color:C.text,marginBottom:20}}>👥 Admin Management</h2>

      {/* Org Stats */}
      <div style={{...st.card,marginBottom:20}}>
        <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:24,fontWeight:'bold',color:C.green}}>{members.length}</div>
            <div style={{color:C.sub,fontSize:11}}>Members</div>
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:24,fontWeight:'bold',color:C.green}}>{adminCount}</div>
            <div style={{color:C.sub,fontSize:11}}>Admins</div>
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:24,fontWeight:'bold',
              color:adminCount>=MAX_ADMINS?C.red:C.green}}>
              {MAX_ADMINS-adminCount}
            </div>
            <div style={{color:C.sub,fontSize:11}}>Slots Left</div>
          </div>
        </div>
      </div>

      {/* TODO: ENABLE PAYWALL banner */}
      {adminCount >= MAX_ADMINS && (
        <div style={{...st.card,marginBottom:20,borderColor:C.gold,
          backgroundColor:C.gold+'10'}}>
          <div style={{color:C.gold,fontWeight:'bold',marginBottom:4}}>
            ⭐ Upgrade for More Admins
          </div>
          <div style={{color:C.sub,fontSize:13}}>
            Your plan includes {MAX_ADMINS} admins. Upgrade to Pro for up to 5 admins.
          </div>
          {/* TODO: ENABLE PAYWALL — uncomment before production deploy */}
          {/* <button style={{...st.btn,...st.btnGold,marginTop:10}} onClick={()=>{}}>
            Upgrade Plan
          </button> */}
        </div>
      )}

      {/* Invite */}
      <div style={{...st.card,marginBottom:20}}>
        <div style={{fontWeight:'bold',color:C.text,marginBottom:12}}>✉️ Invite User</div>
        <div style={{display:'flex',gap:8}}>
          <input style={{...st.input,flex:1}} type="email"
            placeholder="Email address"
            value={invEmail} onChange={e=>setInvEmail(e.target.value)}/>
          <button style={{...st.btn,...st.btnGreen}}
            onClick={inviteUser} disabled={inviting||!invEmail}>
            {inviting?'Sending...':'Send Invite'}
          </button>
        </div>
      </div>

      {/* Members */}
      <div style={{fontWeight:'bold',color:C.text,marginBottom:12,fontSize:15}}>
        Members
      </div>
      {loading ? <div style={{color:C.sub}}>Loading...</div> :
        members.map(m=>(
          <div key={m.id} style={{...st.card,marginBottom:8,
            display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,borderRadius:'50%',
              backgroundColor:C.green+'20',display:'flex',alignItems:'center',
              justifyContent:'center',fontWeight:'bold',color:C.green,fontSize:16,flexShrink:0}}>
              {(m.first_name||m.email||'?')[0].toUpperCase()}
            </div>
            <div style={{flex:1}}>
              <div style={{fontWeight:'bold',color:C.text,fontSize:14}}>
                {m.first_name} {m.last_name}
              </div>
              <div style={{color:C.sub,fontSize:12}}>{m.email}</div>
            </div>
            <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,fontWeight:'bold',
              backgroundColor:m.role==='admin'?C.green+'20':'rgba(100,100,100,0.15)',
              color:m.role==='admin'?C.green:C.sub}}>
              {m.role==='admin'?'Admin':'Viewer'}
            </span>
            {m.id !== user?.userId && (
              m.role==='admin' ? (
                <button style={{...st.btn,backgroundColor:'transparent',
                  color:C.red,border:`1px solid ${C.red}`,fontSize:12,padding:'4px 10px'}}
                  onClick={()=>revokeAdmin(m.id)}>
                  Revoke
                </button>
              ) : (
                <button style={{...st.btn,backgroundColor:'transparent',
                  color:C.green,border:`1px solid ${C.green}`,fontSize:12,padding:'4px 10px'}}
                  onClick={()=>grantAdmin(m.id)}>
                  Make Admin
                </button>
              )
            )}
          </div>
        ))
      }
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────
function SettingsPage({ currentTheme, onThemeChange, user, onViewSubscription }) {
  const [customColor, setCustomColor] = useState(
    localStorage.getItem('rsc_custom_color')||'#00ff88'
  );

  const COLOR_PRESETS = [
    '#00ff88','#4488ff','#ff4444','#ff9500',
    '#af52de','#ff2d55','#00c7be','#ffd700','#ff6b35','#00d4aa',
  ];

  const applyCustomColor = (color) => {
    setCustomColor(color);
    localStorage.setItem('rsc_custom_color', color);
    onThemeChange('custom', {
      ...THEMES.custom,
      green: color,
      primary: color,
    });
  };

  return (
    <div style={{padding:24,maxWidth:800,margin:'0 auto'}}>
      <h2 style={{color:C.text,marginBottom:20}}>⚙️ Settings</h2>

      {/* Theme Selector */}
      <div style={{...st.card,marginBottom:20}}>
        <div style={{fontWeight:'bold',color:C.text,marginBottom:16,fontSize:15}}>
          🎨 App Theme
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {Object.entries(THEMES).map(([key, t])=>(
            <button key={key}
              style={{
                padding:14, borderRadius:12, cursor:'pointer',
                border:`2px solid ${currentTheme===key?t.green:C.border}`,
                backgroundColor:currentTheme===key?t.green+'18':C.bg,
                textAlign:'left', display:'flex', alignItems:'center', gap:10,
              }}
              onClick={()=>onThemeChange(key)}>
              <div style={{width:24,height:24,borderRadius:12,
                backgroundColor:t.green,flexShrink:0}}/>
              <div>
                <div style={{fontWeight:'bold',color:C.text,fontSize:13}}>{t.name}</div>
                <div style={{color:C.sub,fontSize:11,marginTop:2}}>
                  {key==='operator'?'Dark tactical neon'
                   :key==='life360'?'Clean white with blue accents'
                   :key==='bubble'?'Frosted glass minimal style'
                   :key==='urban'?'Street brutalist concrete'
                   :key==='psychedelic'?'Electric neon trip'
                   :key==='modern'?'Pure minimal Swiss'
                   :key==='jazz'?'Late night smoky club'
                   :key==='graffiti'?'Wild style spray paint'
                   :key==='farmlife'?'Warm rustic countryside'
                   :key==='sunflower'?'Golden sun-drenched fields'
                   :key==='butterfly'?'Iridescent purple wings'
                   :key==='rose'?'Deep romantic crimson'
                   :'Pick your own colors'}
                </div>
              </div>
              {currentTheme===key&&(
                <span style={{marginLeft:'auto',color:t.green,fontSize:16,fontWeight:'bold'}}>✓</span>
              )}
            </button>
          ))}
        </div>

        {/* Custom color picker */}
        {currentTheme==='custom'&&(
          <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
            <div style={{fontWeight:'bold',color:C.text,marginBottom:10,fontSize:13}}>
              Primary Color
            </div>
            <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
              {COLOR_PRESETS.map(c=>(
                <div key={c}
                  style={{width:36,height:36,borderRadius:18,backgroundColor:c,
                    cursor:'pointer',border:customColor===c?'3px solid #fff':'3px solid transparent',
                    boxShadow:customColor===c?`0 0 0 2px ${c}`:'none'}}
                  onClick={()=>applyCustomColor(c)}/>
              ))}
              <input type="color" value={customColor}
                onChange={e=>applyCustomColor(e.target.value)}
                style={{width:36,height:36,borderRadius:18,border:'none',
                  cursor:'pointer',backgroundColor:'transparent'}}/>
            </div>
          </div>
        )}
      </div>

      {/* Account */}
      <div style={{...st.card,marginBottom:20}}>
        <div style={{fontWeight:'bold',color:C.text,marginBottom:12,fontSize:15}}>
          👤 Account
        </div>
        <div style={{color:C.sub,fontSize:12,marginBottom:4}}>Logged in as</div>
        <div style={{color:C.text,fontWeight:'bold',fontSize:15}}>{user?.email}</div>
        <div style={{color:C.sub,fontSize:12,marginTop:4}}>
          {user?.role==='admin'?'Administrator':'Viewer'}
        </div>
      </div>

      {/* TODO: Subscription */}
      <div style={{...st.card,borderColor:C.gold,marginBottom:20}}>
        <div style={{color:C.gold,fontWeight:'bold',marginBottom:4,fontSize:15}}>
          ⭐ Subscription
        </div>
        <div style={{color:C.text,fontSize:13,marginBottom:8}}>
          Manage your plan, billing, and add-ons.
        </div>
        <button style={{...st.btn,backgroundColor:C.gold,color:'#000',marginTop:4,width:'100%'}}
          onClick={()=>onViewSubscription&&onViewSubscription()}>
          View Subscription →
        </button>
      </div>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [email,setEmail]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState(''); const [loading,setLoading]=useState(false);
  const login = async e => {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const res = await api.post('/api/auth/login',{email,password:pw});
      localStorage.setItem('accessToken',res.data.data.accessToken);
      sessionStorage.setItem('rsc_token', res.data.data.accessToken);
      sessionStorage.setItem('rsc_org_id', res.data.data.user?.organization_id || res.data.data.user?.org_id || '');
      localStorage.setItem('rsc_org_id', res.data.data.user?.organization_id || res.data.data.user?.org_id || '');
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
  const [events,     setEvents]     = useState(()=>{
    // Restore today's events from localStorage
    try {
      const saved = localStorage.getItem('securityEvents');
      if (saved) {
        const parsed = JSON.parse(saved);
        const today = new Date().toDateString();
        return parsed.filter(e => new Date(e.savedAt||e.id).toDateString()===today);
      }
    } catch {}
    return [];
  });
  const [tab,        setTab]        = useState('cameras');
  const [showAdd,    setShowAdd]    = useState(false);
  const [toast,      setToast]      = useState('');
  const [user,       setUser]       = useState(null);
  const [onlineMap,  setOnlineMap]  = useState({});
  const [settingsFor,setSettingsFor]= useState(null);
  const [rtspViewing, setRtspViewing]  = useState(null); // device to view via relay
  const [deviceSettings,setDeviceSettings]=useState({});
  const [showEnroll,   setShowEnroll]   = useState(false);
  const [showAdmins,   setShowAdmins]   = useState(false);
  const [adminSubTab,  setAdminSubTab]  = useState('members');
  const [activitySubTab, setActivitySubTab] = useState('clips');
  const [usbStatus,    setUsbStatus]    = useState(''); // 'armed' | 'recording' | ''
  const [usbAutoStart,   setUsbAutoStart]   = useState(false);
  const [usbExpanded,    setUsbExpanded]    = useState(false);
  const [clipsRefreshKey, setClipsRefreshKey] = useState(0);
  const [usbLinkedDevice, setUsbLinkedDevice] = useState(()=>sessionStorage.getItem('usbLinkedDevice')||'');
  const [theme, setTheme] = useState(()=>localStorage.getItem('rsc_theme')||'operator');
  const [, forceRender] = useState(0);

  const applyTheme = (key, customData) => {
    setTheme(key);
    localStorage.setItem('rsc_theme', key);
    if (customData) localStorage.setItem('rsc_custom_theme', JSON.stringify(customData));
    refreshTheme();
    forceRender(n=>n+1); // trigger re-render with new theme
  };

  const showToast = (msg, duration=3000) => { setToast(msg); setTimeout(()=>setToast(''),duration); };
  // Persist events to localStorage (today only)
  const addEvent = (e) => {
    setEvents(ev => {
      const updated = [e,...ev].slice(0,500);
      try { localStorage.setItem('securityEvents', JSON.stringify(
        updated.map(x=>({...x, savedAt: x.savedAt||Date.now()}))
      )); } catch {}
      return updated;
    });
    // Show 14-second toast for motion/sound events
    if (e.type==='motion'||e.type==='sound') {
      showToast(`🚨 ${e.type==='motion'?'Motion':'Sound'} detected — ${e.deviceName||'Camera'}`, 14000);
    }
  };

  useEffect(()=>{
    if (!token) return;
    try { const p=JSON.parse(atob(token.split('.')[1])); setUser(p); } catch {}
  },[token]);

  const loadDevices = useCallback(async()=>{
    if (!token) return;
    try {
      const res=await api.get('/api/devices');
      const devs = (res.data.data||[]).map(d=>({...d,name:d.name||d.device_name||''}));
      setDevices(devs);
      // Sync camera count to billing DB so usage meters are accurate
      try {
        const activeCount = devs.filter(d=>d.is_active!==false&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.name||'')).length;
        await api.patch('/api/users/usage', { cameras_count: activeCount });
      } catch {}
    } catch {}
  },[token]);

  const loadStreams = useCallback(async()=>{
    if (!token) return;
    try {
      const res = await api.get('/api/streaming/streams');
      const streams = res.data.data || [];
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
    const doAuth = () => {
      const orgId = user.organizationId || user.org_id || user.organization_id;
      s.emit('auth',{userId:user.userId||user.id,organizationId:orgId,role:'viewer',deviceName:'Web Dashboard'});
    };
    s.on('connect',()=>{
      doAuth();
      showToast('Connected to streaming server');
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
    s.on('disconnect',()=>showToast('Disconnected — reconnecting...'));
    s.on('connect',()=>doAuth());
    setSocket(s);
    return ()=>s.disconnect();
  },[token,user]);

  const logout = ()=>{ localStorage.removeItem('accessToken'); setToken(null); setSocket(null); };

  if (!token) return <LoginPage onLogin={setToken}/>;

  const TABS = [
    {id:'cameras',  label:'📷 Cameras'},
    {id:'discover', label:'📍 Discover'},
    {id:'activity', label:'🎬 Activity'},
    {id:'admin',    label:'👥 Admin'},
  ];

  const switchTab = (newTab) => {
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
        <div style={st.statRow}>
          <div style={st.stat}>
            <p style={st.statN}>
              {devices.filter(d=>d.is_active!==false&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.name||'')).length}
            </p>
            <p style={st.statL}>Total Cameras</p>
          </div>
          <div style={st.stat}>
            <p style={{...st.statN,color:C.green}}>
              {devices.filter(d=>onlineMap[d.id]?.online||onlineMap[d.id]===true).length}
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

        <div style={st.tabs}>
          {TABS.map(t=>(
            <button key={t.id} data-tab={t.id} onClick={()=>switchTab(t.id)} style={{
              ...st.tab,
              backgroundColor:tab===t.id?C.green:C.card,
              color:tab===t.id?'#000':C.text,
              border:tab===t.id?'none':`1px solid ${C.border}`,
              position:'relative',
            }}>
              {t.label}
            </button>
          ))}
          <div style={{display:'flex',gap:6,marginLeft:'auto'}}>
            <button style={{...st.btn,backgroundColor:'#4488ff20',color:C.blue,border:`1px solid ${C.blue}`}} onClick={()=>setShowEnroll(true)}>📳 Enroll Camera</button>

          </div>
        </div>

        <div style={{display: tab==='cameras' ? 'block' : 'none'}}>
          {devices.length===0
            ? <div style={{...st.card,textAlign:'center',padding:40,color:C.sub}}>
                <div style={{fontSize:48}}>📷</div>
                <div style={{marginTop:12}}>No cameras yet. Click "+ Add Camera" above.</div>
              </div>
            : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:16}}>
                {devices.filter(d=>{
                  if (d.is_active === false) return false;
                  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.name||'')) return false;
                  return true;
                }).map(d=>(
                  <CameraCard key={d.id}
                    device={{...d,online:onlineMap[d.id]?.online||onlineMap[d.id]===true}}
                    socket={socket}
                    onEvent={e=>addEvent(e)}
                    settings={deviceSettings[d.id]}
                    onSettings={()=>setSettingsFor(d)}
                    onWatchRemote={(dev)=>setRtspViewing(dev)}
                    onSwitchToUsb={d.device_type==='usb'?()=>{ setUsbAutoStart(true); setUsbExpanded(true); }:null}
                    usbArmed={d.device_type==='usb'?usbStatus==='armed':false}
                    onDisarmUsb={d.device_type==='usb'?()=>{ if(window.__executeCommand) window.__executeCommand('disarm',{}); else socket?.emit('camera:command',{deviceId:d.id,command:'disarm'}); setUsbStatus(''); setUsbExpanded(false); }:null}
                    usbExpanded={d.device_type==='usb'?usbExpanded:false}
                    onCollapseUsb={d.device_type==='usb'?()=>setUsbExpanded(false):null}
                    onArmRemote={d.device_type==='mobile'&&!d.rtsp_url?()=>socket?.emit('camera:command',{deviceId:d.id,command:'arm'}):null}
                  />
                ))}
              </div>
          }
        </div>

        {usbExpanded && (
          <div style={{position:'fixed',inset:0,backgroundColor:'rgba(0,0,0,0.92)',zIndex:300,overflow:'auto',padding:20}}>
            <div style={{maxWidth:1000,margin:'0 auto'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <h2 style={{color:C.green,margin:0}}>🖥️ USB / Webcam — Security Camera</h2>
                <button style={{...st.btn,...st.btnGray,fontSize:13}} onClick={()=>{ setUsbExpanded(false); setUsbAutoStart(false); setClipsRefreshKey(k=>k+1); }}>✕ Close</button>
              </div>
        <div style={{display:'block'}}>
          <USBCameraPage socket={socket} devices={devices} userId={user?.userId} organizationId={user?.organizationId} onUsbStatus={setUsbStatus} onLinkedDevice={setUsbLinkedDevice} onSettings={(dev)=>setSettingsFor(dev)} autoStart={usbAutoStart} onAutoStartDone={()=>setUsbAutoStart(false)} onEvent={e=>{
            if (e.type==='clip_ready') {
              setEvents(ev=>{
                const updated = ev.map(existing=>
                  existing.id===e.eventId ? {...existing, clip_url:e.clip_url, clip_pending:false} : existing
                );
                try { localStorage.setItem('securityEvents', JSON.stringify(updated)); } catch {}
                return updated;
              });
            } else {
              addEvent(e);
            }
          }}/>
        </div>
          </div>
        </div>
        )}
        <div style={{display:'none'}}><div/></div>
        <div style={{display: tab==='activity' ? 'block' : 'none'}}>
          <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:`1px solid ${C.border}`,paddingBottom:12}}>
            {[
              {id:'clips',  label:'🎬 Clips'},
              {id:'events', label:'🚨 Events'},
            ].map(st2=>(
              <button key={st2.id} onClick={()=>setActivitySubTab(st2.id)} style={{
                padding:'7px 16px', borderRadius:6, cursor:'pointer', fontSize:13,
                fontWeight:'bold', border:'none',
                backgroundColor: activitySubTab===st2.id ? C.green : C.card,
                color: activitySubTab===st2.id ? '#000' : C.text,
              }}>{st2.label}</button>
            ))}
          </div>
          {activitySubTab==='clips'  && <ClipsPage key={clipsRefreshKey} devices={devices} onlineMap={onlineMap}/>}
          {activitySubTab==='events' && <EventsPanel events={events} devices={devices}/>}
        </div>
        <div style={{display: tab==='sub' ? 'block' : 'none'}}>
          <SubscriptionPage/>
        </div>
        <div style={{display: tab==='discover' ? 'block' : 'none'}}>
          <DiscoverPage socket={socket} onDeviceAdded={()=>loadDevices()} onEnroll={()=>setShowEnroll(true)}/>
        </div>
        <div style={{display: tab==='admin' ? 'block' : 'none'}}>
          <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:`1px solid ${C.border}`,paddingBottom:12}}>
            {[
              {id:'members',      label:'👥 Members'},
              {id:'settings',     label:'⚙️ Settings'},
              {id:'subscription', label:'⭐ Subscription'},
            ].map(st2=>(
              <button key={st2.id} onClick={()=>setAdminSubTab(st2.id)} style={{
                padding:'7px 16px', borderRadius:6, cursor:'pointer', fontSize:13,
                fontWeight:'bold', border:'none',
                backgroundColor: adminSubTab===st2.id ? C.green : C.card,
                color: adminSubTab===st2.id ? '#000' : C.text,
              }}>{st2.label}</button>
            ))}
          </div>
          {adminSubTab==='members'      && <AdminPage user={user}/>}
          {adminSubTab==='settings'     && <SettingsPage currentTheme={theme} onThemeChange={applyTheme} user={user} onViewSubscription={()=>setAdminSubTab('subscription')}/>}
          {adminSubTab==='subscription' && <SubscriptionPage/>}
        </div>
      </main>

      {showAdd && <AddDeviceModal onClose={()=>setShowAdd(false)} onAdded={()=>{ loadDevices(); showToast('Camera added!'); }}/>}

      {rtspViewing && (
        <RTSPViewer
          device={rtspViewing}
          onClose={() => setRtspViewing(null)}
          orgId={rtspViewing.organization_id}
        />
      )}
      {settingsFor && (
        <CameraSettingsPanel
          key={settingsFor.id}
          device={devices.find(d=>d.id===settingsFor.id)||settingsFor}
          settings={deviceSettings[settingsFor.id]}
          onChange={s=>setDeviceSettings(p=>({...p,[settingsFor.id]:s}))}
          onClose={()=>setSettingsFor(null)}
          onDeviceUpdated={(updated)=>{ if(updated===null){setDevices(prev=>prev.filter(d=>d.id!==settingsFor.id)); setSettingsFor(null);} else setDevices(prev=>prev.map(d=>d.id===updated.id?{...d,...updated}:d)); }}
        />
      )}

      {toast && <div style={st.toast}>{toast}</div>}
      {showEnroll && <EnrollmentModal onClose={()=>setShowEnroll(false)} onEnrolled={loadDevices}/>}
      {showAdmins && <AdminManageModal onClose={()=>setShowAdmins(false)}/>}
    </div>
  );
}















