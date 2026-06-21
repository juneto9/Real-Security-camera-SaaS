/**
 * RSC Discover Screen
 * VPS is single source of truth for all Layer 3-7 intelligence.
 * This screen triggers the scan and displays what VPS returns.
 *
 * KEY: Scan runs to completion regardless of app state.
 * AppState change to background does NOT cancel the scan —
 * the discovery library posts to VPS which does the heavy lifting.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Platform, AppState,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { runDiscovery } from '../lib/discovery';
import api from '../lib/api';


function cleanLabel(d) {
  const raw = d.name || d.hostname || '';
  // Strip raw protocol banners that leaked into name field
  if (/^(RTSP|HTTP|SMB|FTP)\/[\d\.]+\s+\d{3}/.test(raw)) return d.manufacturer || d.hostname || 'Network Device';
  if (raw.startsWith('Device ') && raw.match(/Device \d+/)) return d.manufacturer || 'Unknown Device';
  return raw || d.manufacturer || 'Network Device';
}
// ── Category helpers ──────────────────────────────────────────────────────────
function categoryFromDevice(d) {
  const dtype = (d.device_type || '').toLowerCase();
  const port  = d.port || 0;
  const host  = (d.hostname || d.name || '').toLowerCase();
  const os    = (d.os_hint  || '').toLowerCase();
  const svc   = (d.service  || '').toLowerCase();
  const mfr   = (d.manufacturer || '').toLowerCase();
  const isUnknownMfr = !mfr || mfr === 'network device';

  if ([554, 8554, 10554, 5554].includes(port) || svc === 'rtsp' || dtype === 'ip_camera')
    return { cat: 'camera', icon: '📷', color: '#22c55e', label: d.name || 'IP Security Camera' };
  if (dtype === 'computer' || os.includes('windows') || svc === 'smb')
    return { cat: 'computer', icon: '💻', color: '#a78bfa', label: d.name || d.hostname || 'Computer' };
  if (dtype === 'phone')
    return { cat: 'phone', icon: '📱', color: '#00aaff', label: d.name || 'Phone / Tablet' };
  if (dtype === 'router')
    return { cat: 'router', icon: '📡', color: '#fbbf24', label: d.name || 'Router' };
  if (dtype === 'streaming')
    return { cat: 'smart_home', icon: '📺', color: '#fbbf24', label: d.name || 'Streaming Device' };
  if (dtype === 'printer' || [9100, 515, 631].includes(port))
    return { cat: 'smart_home', icon: '🖨️', color: '#fbbf24', label: d.name || 'Printer' };
  if (dtype === 'nas')
    return { cat: 'computer', icon: '🗄️', color: '#a78bfa', label: d.name || 'NAS Storage' };
  if ([34567, 37777, 8000, 8001].includes(port))
    return { cat: 'camera', icon: '📷', color: '#22c55e', label: d.name || 'Possible Camera' };
  if (/\b(cam|ipc|dvr|nvr|cctv)\b/.test(host))
    return { cat: 'camera', icon: '📷', color: '#22c55e', label: d.name || 'Possible Camera' };
  if (host.includes('desktop') || host.includes('-pc'))
    return { cat: 'computer', icon: '💻', color: '#a78bfa', label: d.hostname || 'PC' };
  if (!isUnknownMfr) {
    const m = mfr;
    if (['hikvision','dahua','reolink','amcrest','axis','ring','nest','wyze','arlo','eufy','foscam'].some(b => m.includes(b)))
      return { cat: 'camera', icon: '📷', color: '#22c55e', label: d.name || d.manufacturer + ' Camera' };
    if (['apple','samsung','google','oneplus','xiaomi'].some(b => m.includes(b)))
      return { cat: 'phone', icon: '📱', color: '#00aaff', label: d.name || d.manufacturer + ' Device' };
    if (['netgear','tp-link','cisco','ubiquiti','linksys'].some(b => m.includes(b)))
      return { cat: 'router', icon: '📡', color: '#fbbf24', label: d.name || d.manufacturer + ' Device' };
    if (['hp','dell','lenovo','asus','intel','microsoft'].some(b => m.includes(b)))
      return { cat: 'computer', icon: '💻', color: '#a78bfa', label: d.name || d.manufacturer + ' PC' };
  }
  return { cat: 'unknown', icon: '❓', color: '#444', label: d.name || ('Unknown Device (' + d.ip_address + ')') };
}

function confidenceScore(d, cat) {
  const port = d.port || 0;
  const dtype = (d.device_type || '').toLowerCase();
  if ([554, 8554].includes(port)) return 95;
  if (dtype === 'ip_camera') return 88;
  if (dtype === 'computer') return 85;
  if (dtype === 'phone') return 80;
  if (cat === 'camera') return 68;
  if (cat !== 'unknown') return 72;
  return 20;
}

function reasonText(d) {
  const parts = [];
  if (d.port && [554,8554,10554].includes(d.port)) parts.push('RTSP port ' + d.port);
  if (d.service) parts.push(d.service.toUpperCase());
  if (d.os_hint) parts.push(d.os_hint);
  if (d.hostname && d.hostname !== d.ip_address) parts.push(d.hostname);
  if (d.device_type && d.device_type !== 'unknown') parts.push('VPS: ' + d.device_type);
  if (d.manufacturer && d.manufacturer.toLowerCase() !== 'network device' && d.manufacturer) parts.push(d.manufacturer);
  return parts.length ? parts.join(' · ') : 'No additional info';
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DiscoverScreen() {
  const [devices, setDevices]     = useState([]);
  const [ssidName, setSsidName]   = useState('');

  const [scanning, setScanning]   = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [lastScan, setLastScan]   = useState(null);
  const scanActiveRef  = useRef(false);
  const appStateRef    = useRef(AppState.currentState);
  const autoTimerRef   = useRef(null);

  const loadSsid = useCallback(async () => {
    try {
      const r = await api.get('/api/cameras/network-info');
      if (r.data?.ssid) setSsidName(r.data.ssid);
    } catch(e) {}
  }, []);

  const loadFromVPS = useCallback(async () => {
    try {
      const res = await api.get('/api/cameras?enrolled=false&dismissed=false');
      const data = Array.isArray(res.data) ? res.data : (res.data?.cameras || []);
      // Dedup by IP — keep most recently updated record per IP
      const byIP = {};
      data.filter(d => d.ip_address && !d.ip_address.endsWith('.1') && !d.is_dismissed).forEach(d => {
        const key = d.ip_address;
        if (!byIP[key] || new Date(d.updated_at) > new Date(byIP[key].updated_at)) byIP[key] = d;
      });
      // Also dedup by name — if same hostname appears on two IPs, keep most recent
      const byName = {};
      Object.values(byIP).forEach(d => {
        const key = (d.name || d.hostname || '').toLowerCase().trim();
        if (!key) { byName[d.ip_address] = d; return; }
        if (!byName[key] || new Date(d.updated_at) > new Date(byName[key].updated_at)) byName[key] = d;
      });
      setDevices(Object.values(byName).filter(d => !d.is_enrolled));
    } catch(e) { console.warn('[Discover] VPS load:', e.message); }
  }, []);

  // ── Run scan — completes even if app goes to background ──────────────────
  const runScan = useCallback((quick = false) => {
    if (scanActiveRef.current) return; // already running
    scanActiveRef.current = true;
    setScanning(true);
    setStatusMsg(quick ? 'Quick scan...' : 'Scanning network...');

    runDiscovery({
      quickMode: quick,
      onProgress: msg => setStatusMsg(msg),
      onComplete: ({ found, posted }) => {
        scanActiveRef.current = false;
        setScanning(false);
        setLastScan(new Date());
        setStatusMsg(found > 0 ? found + ' devices found · updating...' : 'Scan complete');
        loadFromVPS();
      },
    });
    // NOTE: runDiscovery posts to VPS and does NOT cancel on unmount or background.
    // The fetch() calls run to completion via the JS engine regardless of app state.
  }, [loadFromVPS]);

  // ── Auto-scan every 8 min — timer persists across tab switches ───────────
  const startAutoTimer = useCallback(() => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    autoTimerRef.current = setInterval(() => {
      if (!scanActiveRef.current) runScan(true);
    }, 8 * 60 * 1000);
  }, [runScan]);

  // ── AppState handler — resume scan check when app comes back ────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        // App came back to foreground — reload VPS data but don't restart scan
        // (scan already completed in background via JS fetch)
        loadFromVPS();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [loadFromVPS]);

  // ── On screen focus ──────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    loadFromVPS();
    runScan(true);
    startAutoTimer();
    return () => {
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      // DO NOT cancel scan on unmount — it keeps running to completion
    };
  }, [loadFromVPS, runScan, startAutoTimer]));

  const enrollDevice = async (device) => {
    try {
      await api.patch('/api/cameras/' + device.id, { is_enrolled: true });
      setDevices(prev => prev.filter(d => d.id !== device.id));
    } catch(e) { console.warn('[Discover] enroll:', e.message); }
  };

  const dismissDevice = async (device) => {
    try {
      if (device.id) await api.patch('/api/cameras/' + device.id, { is_dismissed: true });
      setDevices(prev => prev.filter(d => d.id !== device.id));
    } catch(e) {}
  };

  const cameraCount = devices.filter(d => categoryFromDevice(d).cat === 'camera').length;
  const formatTime  = d => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.title}>Network Assets</Text>
          <Text style={s.sub}>
            {ssidName ? '📶 ' + ssidName + ' · ' : ''}{Platform.OS === 'android' ? '🤖 ARP' : '🍎 HTTP'} · {devices.length} devices
            {cameraCount > 0 ? ' · 📷 ' + cameraCount : ''}
          </Text>
        </View>
        <TouchableOpacity style={[s.scanBtn, scanning && s.scanActive]} onPress={() => runScan(false)} disabled={scanning}>
          {scanning ? <ActivityIndicator color="#E02020" size="small" /> : <Text style={s.scanBtnText}>⟳ Scan</Text>}
        </TouchableOpacity>
      </View>

      {!!statusMsg && (
        <View style={s.statusBar}>
          <Text style={s.statusText}>{statusMsg}</Text>
        </View>
      )}

      {Platform.OS === 'android' && (
        <View style={s.badge}>
          <Text style={s.badgeText}>🟢 Android ARP · Last: {formatTime(lastScan)} · Scan runs in background ✓</Text>
        </View>
      )}

      <FlatList
        data={devices}
        keyExtractor={item => item.id || item.ip_address || String(Math.random())}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={scanning} onRefresh={() => runScan(false)} tintColor="#E02020" />}
        ListEmptyComponent={
          !scanning ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>📡</Text>
              <Text style={s.emptyTitle}>No unenrolled devices</Text>
              <Text style={s.emptySub}>Pull down or tap Scan to search your network</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const { cat, icon, color, label: _rawLabel } = categoryFromDevice(item);
          const label = cleanLabel(item) !== 'Network Device' ? cleanLabel(item) : _rawLabel;
          const conf   = confidenceScore(item, cat);
          const _reason = reasonText(item);
          const reason = _reason.replace(/RTSP\/[\d.]+\s+\d+[^,]*/g,'').replace(/HTTP\/[\d.]+\s+\d+[^,]*/g,'').trim().replace(/^[·,\s]+/,'').replace(/[·,\s]+$/,'');
          const isCamera = cat === 'camera';

          return (
            <View style={[s.card, { borderColor: color + '40' }]}>
              <View style={[s.stripe, { backgroundColor: color, opacity: conf > 50 ? 1 : 0.35 }]} />
              <View style={s.cardInner}>
                <View style={s.row1}>
                  <Text style={s.cardIcon}>{icon}</Text>
                  <View style={s.cardNameBlock}>
                    <Text style={s.cardName} numberOfLines={1}>{label}</Text>
                    <Text style={[s.cardSub, { color }]} numberOfLines={1}>{item.ip_address}</Text>
                  </View>
                  <View style={[s.catBadge, { backgroundColor: color + '20', borderColor: color + '50' }]}>
                    <Text style={[s.catBadgeText, { color }]}>
                      {cat === 'camera' ? 'CAM' : cat === 'computer' ? 'PC' : cat === 'phone' ? 'PHONE' : cat === 'router' ? 'NET' : cat === 'smart_home' ? 'IOT' : '?'}
                    </Text>
                  </View>
                </View>

                <View style={s.confRow}>
                  <View style={s.confTrack}>
                    <View style={[s.confFill, { width: conf + '%', backgroundColor: color }]} />
                  </View>
                  <Text style={[s.confPct, { color }]}>{conf}%</Text>
                </View>

                <View style={[s.reasonBox, { borderLeftColor: color + '60' }]}>
                  <Text style={s.reasonText} numberOfLines={2}>{reason}</Text>
                </View>

                {(item.port || item.mac_address) && (
                  <View style={s.portRow}>
                    {!!item.port && (
                      <View style={[s.chip, [554,8554].includes(item.port) ? s.chipRtsp : s.chipDefault]}>
                        <Text style={[s.chipText, { color: [554,8554].includes(item.port) ? '#22c55e' : '#666' }]}>
                          :{item.port}{[554,8554].includes(item.port) ? ' RTSP' : ''}
                        </Text>
                      </View>
                    )}
                    {!!item.mac_address && <Text style={s.mac}>{item.mac_address}</Text>}
                  </View>
                )}

                <View style={s.actions}>
                  <TouchableOpacity style={[s.enrollBtn, { backgroundColor: isCamera ? '#E02020' : '#00aaff' }]} onPress={() => enrollDevice(item)}>
                    <Text style={s.enrollText}>{isCamera ? '+ Add Camera' : '+ Enroll'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.dismissBtn} onPress={() => dismissDevice(item)}>
                    <Text style={s.dismissText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerLeft: { flex: 1 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  sub:   { color: '#555', fontSize: 11, marginTop: 2 },
  scanBtn:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', minWidth: 72, alignItems: 'center' },
  scanActive: { borderColor: '#E02020' },
  scanBtnText:{ color: '#E02020', fontWeight: '700', fontSize: 13 },
  statusBar:  { backgroundColor: '#111', paddingHorizontal: 16, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  statusText: { color: '#888', fontSize: 12 },
  badge:      { backgroundColor: 'rgba(34,197,94,0.08)', paddingHorizontal: 16, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: 'rgba(34,197,94,0.15)' },
  badgeText:  { color: '#22c55e', fontSize: 11 },
  list:       { padding: 12, paddingBottom: 40 },
  empty:      { paddingTop: 60, alignItems: 'center' },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#555', fontSize: 16, fontWeight: '600' },
  emptySub:   { color: '#333', fontSize: 13, marginTop: 6, textAlign: 'center' },
  card:       { backgroundColor: '#111', borderRadius: 12, marginBottom: 12, borderWidth: 1, overflow: 'hidden' },
  stripe:     { height: 3 },
  cardInner:  { padding: 14 },
  row1:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  cardIcon:   { fontSize: 24, marginRight: 10, marginTop: 2 },
  cardNameBlock: { flex: 1, minWidth: 0 },
  cardName:   { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardSub:    { fontSize: 11, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  catBadge:   { borderRadius: 20, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8, alignSelf: 'flex-start' },
  catBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  confRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  confTrack:  { flex: 1, height: 4, backgroundColor: '#1e1e1e', borderRadius: 2 },
  confFill:   { height: 4, borderRadius: 2 },
  confPct:    { fontSize: 10, fontWeight: '700', minWidth: 30, textAlign: 'right' },
  reasonBox:  { borderLeftWidth: 2, paddingLeft: 8, paddingVertical: 5, backgroundColor: '#0d0d0d', borderRadius: 4, marginBottom: 8 },
  reasonText: { color: '#666', fontSize: 11, lineHeight: 16 },
  portRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10, alignItems: 'center' },
  chip:       { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  chipRtsp:   { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)' },
  chipDefault:{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' },
  chipText:   { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  mac:        { color: '#444', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  actions:    { flexDirection: 'row', gap: 8 },
  enrollBtn:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 8 },
  enrollText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  dismissBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  dismissText:{ color: '#555', fontSize: 13 },
});
