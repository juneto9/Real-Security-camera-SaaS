import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Wifi } from 'lucide-react';
import SetupCodeModal from '@/components/agents/SetupCodeModal';

const INSTALLED_KEY = 'realseccam_agent_installed';
// Agent is considered "running" if it published to the relay within this window
const RUNNING_WINDOW_MS = 2 * 60 * 1000;

export default function AgentBadge({ user: userProp, theme, layout = 'stacked' }) {
  const [user, setUser] = useState(userProp || null);
  const [installed, setInstalled] = useState(false);
  const [running, setRunning] = useState(false); // agent actually publishing (real heartbeat)
  const [showTooltip, setShowTooltip] = useState(false);
  const [cameraId, setCameraId] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [camera, setCamera] = useState(null);
  const pollRef = useRef(null);

  // Fetch our own user so the badge renders independently of the parent
  useEffect(() => {
    if (userProp) { setUser(userProp); return; }
    base44.auth.me().then(setUser).catch(() => {});
  }, [userProp]);

  // Determine if a Camera record shows the agent actively running (recently published to relay)
  const isCameraRunning = (cam) => {
    if (!cam) return false;
    const lastSeen = cam.relay_last_seen;
    if (!lastSeen) return false;
    return (Date.now() - new Date(lastSeen).getTime()) < RUNNING_WINDOW_MS;
  };

  // Poll the device's Camera record for the real running state
  const refreshRunning = async (camId) => {
    if (!camId) { setRunning(false); return; }
    try {
      const results = await base44.entities.Camera.filter({ id: camId });
      const cam = results[0];
      if (cam) setCamera(cam);
      setRunning(isCameraRunning(cam));
    } catch {
      setRunning(false);
    }
  };

  // On mount, restore install marker + start polling real running state for this device
  useEffect(() => {
    if (!user) return;
    setInstalled(localStorage.getItem(INSTALLED_KEY) === 'true');
    const stored = localStorage.getItem('realseccam_agent_camera_id');
    if (stored) {
      setCameraId(stored);
      refreshRunning(stored);
      pollRef.current = setInterval(() => refreshRunning(stored), 15000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user]);

  // Ensure this device has a Camera record, return it
  const ensureCamera = async () => {
    let camRecord = null;
    if (cameraId) {
      const found = await base44.entities.Camera.filter({ id: cameraId });
      camRecord = found[0] || null;
    }
    if (!camRecord) {
      const existing = await base44.entities.Camera.filter({ created_by_id: user.id, device_type: 'laptop' });
      camRecord = existing[0] || await base44.entities.Camera.create({
        name: user.full_name ? `${user.full_name}'s PC` : 'My PC',
        device_type: 'laptop',
        status: 'offline',
        is_enrolled: true,
      });
    }
    setCameraId(camRecord.id);
    setCamera(camRecord);
    localStorage.setItem('realseccam_agent_camera_id', camRecord.id);
    if (!pollRef.current) {
      pollRef.current = setInterval(() => refreshRunning(camRecord.id), 15000);
    }
    return camRecord;
  };

  // Click the badge → if not installed, open the one-click installer
  const handleBadgeClick = async () => {
    if (installed) return;
    try {
      await ensureCamera();
      setShowInstall(true);
    } catch (e) {
      console.error('Agent setup failed', e);
    }
  };

  // Toggle start/stop. For browser cameras it sends a push-signal wake up;
  // for native agents (laptop — no push subscription) it refreshes the running
  // state aggressively since the Windows service self-manages.
  const handleToggle = async () => {
    if (!installed) return;
    try {
      const cam = camera || await ensureCamera();
      const action = running ? 'stop' : 'start';

      if (cam.device_type === 'laptop') {
        // Native Windows agent — self-managed service, no browser push.
        // Just poll aggressively; the green state is driven by relay_last_seen.
        if (!running) {
          await refreshRunning(cam.id);
          // Poll again shortly — the agent service may already be starting up
          setTimeout(() => refreshRunning(cam.id), 4000);
          setTimeout(() => refreshRunning(cam.id), 10000);
        }
        // "Stop" for a native agent is not supported from the dashboard —
        // it runs as a system service controlled by the OS.
        return;
      }

      await base44.functions.invoke('pushSignal', { camera_id: cam.id, action });
      setTimeout(() => refreshRunning(cam.id), 4000);
    } catch (e) {
      console.error('Agent toggle failed', e);
      // Fallback: just poll — the running state comes from the relay
      if (cameraId) setTimeout(() => refreshRunning(cameraId), 4000);
    }
  };

  const markInstalled = () => {
    localStorage.setItem(INSTALLED_KEY, 'true');
    setInstalled(true);
    // Do NOT mark running — green only turns on when the agent actually reports in.
    if (cameraId) setTimeout(() => refreshRunning(cameraId), 4000);
  };

  if (!user) return null;

  const green = theme?.green || '#00ff88';
  const yellow = '#ffcc00';
  const red = '#ff3b30';

  // Three-state: red (not installed) → yellow (installed, not running) → green (running)
  const state = !installed ? 'off' : (running ? 'running' : 'idle');
  const color = state === 'off' ? red : state === 'idle' ? yellow : green;
  const stateLabel = state === 'off' ? 'Not Installed' : state === 'idle' ? 'Installed — Not Running' : 'Running';
  const glow = state === 'off'
    ? `0 0 6px ${red}55`
    : state === 'idle'
      ? `0 0 6px ${yellow}66`
      : `0 0 10px ${green}aa, 0 0 20px ${green}55`;

  const tooltipText = state === 'off'
    ? 'Click the glowing red icon to set up the camera agent. You\'ll get a 6-digit code to enter in the agent installer.'
    : state === 'idle'
      ? 'Agent installed but not running yet. It turns green once it starts streaming. Use the toggle to start it.'
      : 'This device is running as a background security camera and streaming live.';

  // Tile box styling — matches the Cloud Relay tile in FleetTab
  const tileBox = {
    backgroundColor: theme?.card || '#141414',
    border: `1px solid ${theme?.border || '#2a2a2a'}`,
    borderRadius: theme?.radius || 6,
    padding: '8px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const iconBlock = (
    <div
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={handleBadgeClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        cursor: installed ? 'default' : 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{
        position: 'relative',
        width: 32, height: 32, borderRadius: '50%',
        backgroundColor: `${color}18`,
        border: `1px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: glow,
        transition: 'all 0.35s',
        animation: state === 'off' ? 'agentInstallPulse 1.6s ease-in-out infinite' : 'none',
      }}>
        <Wifi size={15} color={color} style={{ filter: `drop-shadow(0 0 3px ${color}99)` }} />
        {state === 'running' && (
          <span style={{
            position: 'absolute', top: 1, right: 1,
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: green,
            boxShadow: `0 0 6px ${green}`,
            animation: 'agentPulse 1.6s ease-in-out infinite',
          }} />
        )}
      </div>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
        color,
        textTransform: 'uppercase', lineHeight: 1,
      }}>
        Cam Agent
      </span>
    </div>
  );

  // Before install: show a clear "Set Up" action. After install: on/off toggle.
  const toggleBlock = !installed ? (
    <button
      onClick={handleBadgeClick}
      style={{
        padding: '4px 12px', borderRadius: 6,
        backgroundColor: `${red}1a`, border: `1px solid ${red}66`,
        color: red, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
        textTransform: 'uppercase', cursor: 'pointer', lineHeight: 1.4,
      }}
    >
      Set Up
    </button>
  ) : (
    <div
      onClick={handleToggle}
      title={running ? 'Stop camera agent' : 'Start camera agent'}
      style={{
        width: 36, height: 20, borderRadius: 10,
        backgroundColor: running ? green : '#2a2a2a',
        border: `1px solid ${running ? green : '#444'}`,
        boxShadow: running ? `0 0 8px ${green}66` : 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 0.25s',
        flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute',
        top: 2, left: running ? 18 : 2,
        width: 14, height: 14, borderRadius: '50%',
        backgroundColor: running ? '#000' : '#555',
        transition: 'left 0.25s',
      }} />
    </div>
  );

  const tooltipBlock = showTooltip && (
    <div style={{
      position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6,
      backgroundColor: '#1a1a1a', border: `1px solid ${color}55`,
      borderRadius: 8, padding: '10px 14px',
      width: 240, zIndex: 999,
      boxShadow: `0 4px 20px rgba(0,0,0,0.6)`,
      pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, display: 'inline-block', boxShadow: `0 0 4px ${color}` }} />
        <span style={{ color, fontWeight: 700, fontSize: 12 }}>
          Cam Agent — {stateLabel}
        </span>
      </div>
      <p style={{ color: '#aaa', fontSize: 11, lineHeight: 1.6, margin: 0 }}>
        {tooltipText}
      </p>
    </div>
  );

  const keyframes = (
    <style>{`
      @keyframes agentPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.4); }
      }
      @keyframes agentInstallPulse {
        0%, 100% { box-shadow: 0 0 8px ${red}aa, 0 0 14px ${red}44; }
        50% { box-shadow: 0 0 14px ${red}, 0 0 26px ${red}88; }
      }
    `}</style>
  );

  const modal = showInstall && camera && (
    <SetupCodeModal
      theme={theme}
      camera={camera}
      onCodeRegistered={markInstalled}
      onClose={() => setShowInstall(false)}
    />
  );

  // Split layout: two separate tile boxes
  if (layout === 'split') {
    return (
      <>
        <div style={{ ...tileBox, position: 'relative' }}>
          {iconBlock}
          {tooltipBlock}
        </div>
        <div style={tileBox}>
          {toggleBlock}
        </div>
        {keyframes}
        {modal}
      </>
    );
  }

  return (
    <div style={{
      position: 'relative',
      display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: theme?.card || '#141414',
      border: `1px solid ${theme?.border || '#2a2a2a'}`,
      borderRadius: theme?.radius || 6,
      padding: '2px 12px',
    }}>
      {iconBlock}
      {toggleBlock}
      {tooltipBlock}
      {keyframes}
      {modal}
    </div>
  );
}