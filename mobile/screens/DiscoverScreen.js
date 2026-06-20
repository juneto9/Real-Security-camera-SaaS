/**
 * RSC Discover Screen
 *
 * Fetches VPS-enriched device data — the VPS is the single source of truth
 * for all Layer 3-7 intelligence (device_type, manufacturer, hostname,
 * banner, os_hint, service, port). This screen just displays and scans.
 *
 * On focus: loads unenrolled devices from VPS, then triggers a quick ARP scan.
 * "Scan Now": runs full subnet scan, re-fetches from VPS after.
 * Auto-refresh: every 8 minutes while screen is active.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { runDiscovery, startAutoDiscovery } from '../lib/discovery';
import api from '../lib/api';

// ── Category helpers (mirrors web DeviceConfidenceEngine) ────────────────────
function categoryFromDevice(d) {
  const dtype = (d.device_type || '').toLowerCase();
  const port  = d.port || 0;
  const host  = (d.hostname || d.name || '').toLowerCase();
  const os    = (d.os_hint  || '').toLowerCase();
  const svc   = (d.service  || '').toLowerCase();
  const mfr   = (d.manufacturer || '').toLowerCase();
  const isNetworkDevice = mfr === 'network device' || !mfr;

  // RTSP = camera, period
  if ([554, 8554, 10554, 5554].includes(port) || svc === 'rtsp')
    return { cat: 'camera', icon: '📷', color: '#22c55e', label: 'IP Security Camera' };

  // VPS-classified
  if (dtype === 'ip_camera')
    return { cat: 'camera', icon: '📷', color: '#22c55e', label: 'IP Security Camera' };
  if (dtype === 'computer')
    return { cat: 'computer', icon: '💻', color: '#a78bfa', label: d.hostname || 'Computer' };
  if (dtype === 'phone')
    return { cat: 'phone', icon: '📱', color: '#00aaff', label: 'Phone / Tablet' };
  if (dtype === 'router')
    return { cat: 'router', icon: '📡', color: '#fbbf24', label: 'Router' };
  if (dtype === 'streaming')
    return { cat: 'smart_home', icon: '📺', color: '#fbbf24', label: 'Streaming Device' };
  if (dtype === 'printer')
    return { cat: 'smart_home', icon: '🖨️', color: '#fbbf24', label: 'Printer' };

  // Cam ports
  if ([34567, 37777, 9000, 8000].includes(port))
    return { cat: 'camera', icon: '📷', color: '#22c55e', label: 'Possible Camera' };

  // Hostname hints
  if (/\b(cam|ipc|dvr|nvr|cctv)\b/.test(host))
    return { cat: 'camera', icon: '📷', color: '#22c55e', label: 'Possible Camera' };
  if (host.includes('desktop') || host.includes('laptop') || host.includes('-pc'))
    return { cat: 'computer', icon: '💻', color: '#a78bfa', label: d.hostname || 'PC' };
  if (host.includes('iphone')) return { cat: 'phone', icon: '📱', color: '#00aaff', label: 'iPhone' };
  if (host.includes('ipad'))   return { cat: 'phone', icon: '📱', color: '#00aaff', label: 'iPad' };
  if (host.includes('roku') || host.includes('firetv'))
    return { cat: 'smart_home', icon: '📺', color: '#fbbf24', label: 'Streaming Device' };

  // OS hint
  if (os.includes('windows') || os.includes('samba'))
    return { cat: 'computer', icon: '💻', color: '#a78bfa', label: d.hostname || 'Windows PC' };
  if (os.includes('linux'))
    return { cat: 'computer', icon: '🖥️', color: '#a78bfa', label: 'Linux Device' };

  // Known manufacturers (non-blank)
  if (!isNetworkDevice) {
    const m = mfr;
    if (['hikvision','dahua','reolink','amcrest','axis','hanwha','foscam','ezviz',
         'uniview','lorex','annke','swann','wyze','arlo','ring','eufy','blink'].some(b => m.includes(b)))
      return { cat: 'camera', icon: '📷', color: '#22c55e', label: d.manufacturer + ' Camera' };
    if (['apple','samsung','google','oneplus','xiaomi','huawei','motorola'].some(b => m.includes(b)))
      return { cat: 'phone', icon: '📱', color: '#00aaff', label: d.manufacturer + ' Device' };
    if (['hp','dell','lenovo','asus','acer','intel','microsoft','toshiba'].some(b => m.includes(b)))
      return { cat: 'computer', icon: '💻', color: '#a78bfa', label: d.manufacturer + ' PC' };
    if (['netgear','tp-link','cisco','d-link','ubiquiti','linksys','eero'].some(b => m.includes(b)))
      return { cat: 'smart_home', icon: '📡', color: '#fbbf24', label: d.manufacturer + ' Device' };
    return { cat: 'unknown', icon: '📦', color: '#555', label: d.manufacturer + ' Device' };
  }

  return { cat: 'unknown', icon: '❓', color: '#555', label: 'Unidentified Device' };
}

function confidenceScore(d, cat) {
  const port = d.port || 0;
  const dtype = (d.device_type || '').toLowerCase();
  if ([554, 8554].includes(port)) return 95;
  if (dtype === 'ip_camera') return 85;
  if (dtype === 'computer')  return 82;
  if (dtype === 'phone')     return 80;
  if (cat === 'camera')      return 68;
  if (cat !== 'unknown')     return 72;
  return 20;
}

function reasonText(d, cat) {
  const parts = [];
  if (d.port && [554,8554,10554].includes(d.port)) parts.push('RTSP port ' + d.port);
  if (d.service) parts.push(d.service.toUpperCase());
  if (d.os_hint) parts.push(d.os_hint);
  if (d.hostname && d.hostname !== d.ip_address) parts.push(d.hostname);
  if (d.device_type && d.device_type !== 'unknown') parts.push('VPS: ' + d.device_type);
  if (d.manufacturer && d.manufacturer.toLowerCase() !== 'network device') parts.push(d.manufacturer);
  if (!parts.length) return 'No additional info — scan for more detail';
  return parts.join(' · ');
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DiscoverScreen() {
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [lastScan, setLastScan] = useState(null);
  const cleanupRef = useRef(null);

  const loadFromVPS = useCallback(async () => {
    try {
      const res = await api.get('/api/cameras?enrolled=false&dismissed=false');
      const data = Array.isArray(res.data) ? res.data : (res.data.cameras || []);
      // Filter out gateways (.1) and enrolled devices
      setDevices(data.filter(d =>
        d.ip_address && !d.ip_address.endsWith('.1') && !d.is_enrolled && !d.is_dismissed
      ));
    } catch (e) {
      console.warn('[DiscoverScreen] VPS load error:', e.message);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadFromVPS();
    // Quick ARP scan on focus, then auto every 8 min
    runDiscovery({
      quickMode: true,
      onProgress: msg => setStatusMsg(msg),
      onComplete: ({ found }) => {
        setLastScan(new Date());
        setStatusMsg(found > 0 ? found + ' devices on network' : '');
        if (found > 0) loadFromVPS();
      },
    });
    cleanupRef.current = startAutoDiscovery({
      onProgress: msg => setStatusMsg(msg),
      onComplete: ({ found }) => { if (found > 0) loadFromVPS(); },
    });
    return () => cleanupRef.current?.();
  }, [loadFromVPS]));

  const runFullScan = () => {
    setScanning(true);
    setStatusMsg('Starting full subnet scan...');
    runDiscovery({
      quickMode: false,
      onProgress: msg => setStatusMsg(msg),
      onComplete: ({ found, posted }) => {
        setScanning(false);
        setLastScan(new Date());
        setStatusMsg('Scan complete — ' + found + ' devices, ' + posted + ' updated');
        loadFromVPS();
      },
    });
  };

  const enrollDevice = async (device) => {
    try {
      await api.patch('/api/cameras/' + device.id, { is_enrolled: true });
      setDevices(prev => prev.filter(d => d.id !== device.id));
    } catch (e) { console.warn('[DiscoverScreen] enroll error:', e.message); }
  };

  const dismissDevice = async (device) => {
    try {
      if (device.id) await api.patch('/api/cameras/' + device.id, { is_dismissed: true });
      setDevices(prev => prev.filter(d => d.id !== device.id));
    } catch (e) {}
  };

  const formatTime = (date) => date
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Never';

  const cameraCount = devices.filter(d => categoryFromDevice(d).cat === 'camera').length;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.title}>Network Assets</Text>
          <Text style={s.sub}>
            {Platform.OS === 'android' ? '🤖 ARP' : '🍎 HTTP'} · {devices.length} devices
            {cameraCount > 0 ? ' · 📷 ' + cameraCount + ' cameras' : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={[s.scanBtn, scanning && s.scanBtnActive]}
          onPress={runFullScan}
          disabled={scanning}
        >
          {scanning
            ? <ActivityIndicator color="#E02020" size="small" />
            : <Text style={s.scanBtnText}>⟳ Scan</Text>}
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      {!!statusMsg && (
        <View style={s.statusBar}>
          <Text style={s.statusText}>{statusMsg}</Text>
        </View>
      )}

      {/* Android ARP badge */}
      {Platform.OS === 'android' && (
        <View style={s.badge}>
          <Text style={s.badgeText}>🟢 Android ARP · Last scan: {formatTime(lastScan)}</Text>
        </View>
      )}

      <FlatList
        data={devices}
        keyExtractor={item => item.id || item.ip_address || String(Math.random())}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={scanning} onRefresh={runFullScan} tintColor="#E02020" />}
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
          const { cat, icon, color, label } = categoryFromDevice(item);
          const conf   = confidenceScore(item, cat);
          const reason = reasonText(item, cat);
          const isCamera = cat === 'camera';

          return (
            <View style={[s.card, { borderColor: color + '40' }]}>
              {/* Top color stripe */}
              <View style={[s.stripe, { backgroundColor: color, opacity: conf > 50 ? 1 : 0.35 }]} />

              <View style={s.cardInner}>
                {/* Row 1: icon + label + category badge */}
                <View style={s.row1}>
                  <Text style={s.cardIcon}>{icon}</Text>
                  <View style={s.cardNameBlock}>
                    <Text style={s.cardName} numberOfLines={1}>
                      {item.name || label}
                    </Text>
                    <Text style={[s.cardLabel, { color }]}>{label}</Text>
                  </View>
                  <View style={[s.catBadge, { backgroundColor: color + '20', borderColor: color + '50' }]}>
                    <Text style={[s.catBadgeText, { color }]}>
                      {cat === 'camera' ? 'CAMERA' : cat === 'computer' ? 'COMPUTER'
                        : cat === 'phone' ? 'PHONE' : cat === 'smart_home' ? 'SMART HOME' : 'UNKNOWN'}
                    </Text>
                  </View>
                </View>

                {/* IP + MAC */}
                <View style={s.row2}>
                  <View style={[s.dot, { backgroundColor: item.status === 'online' ? '#22c55e' : '#444' }]} />
                  <Text style={s.ip}>{item.ip_address || '—'}</Text>
                  {!!item.mac_address && <Text style={s.mac}>{item.mac_address}</Text>}
                </View>

                {/* Confidence bar */}
                <View style={s.confRow}>
                  <View style={s.confTrack}>
                    <View style={[s.confFill, { width: conf + '%', backgroundColor: color }]} />
                  </View>
                  <Text style={[s.confPct, { color }]}>{conf}%</Text>
                </View>

                {/* Reason */}
                <View style={[s.reasonBox, { borderLeftColor: color + '60' }]}>
                  <Text style={s.reasonText}>{reason}</Text>
                </View>

                {/* Port chips */}
                {!!item.port && (
                  <View style={s.portRow}>
                    {[item.port].map(p => (
                      <View key={p} style={[s.portChip,
                        [554,8554,10554].includes(p) ? s.portChipRtsp : s.portChipDefault]}>
                        <Text style={[s.portChipText,
                          [554,8554,10554].includes(p) ? { color: '#22c55e' } : { color: '#888' }]}>
                          :{p}{[554,8554].includes(p) ? ' RTSP' : ''}
                        </Text>
                      </View>
                    ))}
                    {!!item.hostname && item.hostname !== item.ip_address && (
                      <Text style={s.hostnameChip}>{item.hostname}</Text>
                    )}
                  </View>
                )}

                {/* Action buttons */}
                <View style={s.actions}>
                  <TouchableOpacity
                    style={[s.enrollBtn, { backgroundColor: isCamera ? '#E02020' : '#00aaff' }]}
                    onPress={() => enrollDevice(item)}
                  >
                    <Text style={s.enrollBtnText}>
                      {isCamera ? '+ Add Camera' : '+ Enroll Device'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.dismissBtn} onPress={() => dismissDevice(item)}>
                    <Text style={s.dismissBtnText}>✕</Text>
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

  scanBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
    minWidth: 72, alignItems: 'center',
  },
  scanBtnActive: { borderColor: '#E02020' },
  scanBtnText:   { color: '#E02020', fontWeight: '700', fontSize: 13 },

  statusBar: {
    backgroundColor: '#111', paddingHorizontal: 16, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  statusText: { color: '#888', fontSize: 12 },

  badge: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    paddingHorizontal: 16, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: 'rgba(34,197,94,0.15)',
  },
  badgeText: { color: '#22c55e', fontSize: 11 },

  list:  { padding: 12, paddingBottom: 40 },
  empty: { paddingTop: 60, alignItems: 'center' },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#555', fontSize: 16, fontWeight: '600' },
  emptySub:   { color: '#333', fontSize: 13, marginTop: 6, textAlign: 'center' },

  card: {
    backgroundColor: '#111', borderRadius: 12, marginBottom: 12,
    borderWidth: 1, overflow: 'hidden',
  },
  stripe:    { height: 3 },
  cardInner: { padding: 14 },

  row1: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  cardIcon: { fontSize: 24, marginRight: 10, marginTop: 2 },
  cardNameBlock: { flex: 1, minWidth: 0 },
  cardName:  { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  catBadge:  {
    borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8, alignSelf: 'flex-start',
  },
  catBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },

  row2: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  dot:  { width: 6, height: 6, borderRadius: 3 },
  ip:   { color: '#888', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  mac:  { color: '#444', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

  confRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  confTrack: { flex: 1, height: 4, backgroundColor: '#1e1e1e', borderRadius: 2 },
  confFill:  { height: 4, borderRadius: 2 },
  confPct:   { fontSize: 10, fontWeight: '700', minWidth: 30, textAlign: 'right' },

  reasonBox: {
    borderLeftWidth: 2, paddingLeft: 8, paddingVertical: 5,
    backgroundColor: '#0d0d0d', borderRadius: 4, marginBottom: 8,
  },
  reasonText: { color: '#666', fontSize: 11, lineHeight: 16 },

  portRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10 },
  portChip:      { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  portChipRtsp:  { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)' },
  portChipDefault:{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' },
  portChipText:  { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  hostnameChip:  { color: '#555', fontSize: 10, alignSelf: 'center' },

  actions:    { flexDirection: 'row', gap: 8 },
  enrollBtn:  {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 9, borderRadius: 8,
  },
  enrollBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  dismissBtn: {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center',
  },
  dismissBtnText: { color: '#555', fontSize: 13 },
});
