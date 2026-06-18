/**
 * RSC Discover Screen
 *
 * Phone equivalent of the web Discover tab.
 * Shows devices found on the local network, lets user tap to enroll them.
 * Has a "Scan Now" button that wakes the phone and runs a full subnet scan.
 *
 * Discovery runs automatically:
 *   - On screen mount (quick ARP-only on Android, quick range on iOS)
 *   - When user taps "Scan Now" (full subnet scan)
 *   - Every 8 minutes while screen is active
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Platform, AppState,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { runDiscovery, startAutoDiscovery } from '../lib/discovery';
import api from '../lib/api';

const DEVICE_ICONS = {
  'Hikvision': '📷', 'Dahua': '📷', 'Reolink': '📷', 'Amcrest': '📷',
  'Wyze': '📷', 'Ring': '🔔', 'Arlo': '📷', 'Eufy': '📷',
  'Axis': '📷', 'Alarm.com': '🔒', 'SkyBell': '🔔', 'TP-Link Tapo': '📷',
  'Apple': '📱', 'Samsung': '📱', 'Google': '📱',
  'Amazon': '🔊', 'Raspberry Pi': '🖥️',
};

function deviceIcon(manufacturer) {
  return DEVICE_ICONS[manufacturer] || '📡';
}

function isCameraLikely(device) {
  return device.is_camera_likely ||
    (device.open_ports && (device.open_ports.includes(554) || device.open_ports.includes(8554))) ||
    false;
}

export default function DiscoverScreen({ navigation }) {
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [lastScan, setLastScan] = useState(null);
  const [enrolling, setEnrolling] = useState(null);
  const cleanupRef = useRef(null);

  // Run quick scan when screen comes into focus
  useFocusEffect(useCallback(() => {
    runQuickScan();
    // Start auto-scan interval while screen is focused
    cleanupRef.current = startAutoDiscovery({
      onProgress: (msg) => setStatusMsg(msg),
      onComplete: ({ found }) => {
        if (found > 0) loadDevicesFromServer();
      },
    });
    return () => {
      cleanupRef.current?.();
    };
  }, []));

  const loadDevicesFromServer = async () => {
    try {
      const res = await api.get('/api/cameras?discovered=true&enrolled=false');
      const data = res.data.cameras || res.data || [];
      setDevices(data);
    } catch (e) {
      console.warn('[DiscoverScreen] load error:', e.message);
    }
  };

  const runQuickScan = () => {
    setScanning(true);
    setStatusMsg('Starting quick scan...');
    runDiscovery({
      quickMode: true,
      onProgress: (msg) => setStatusMsg(msg),
      onComplete: ({ found, posted }) => {
        setScanning(false);
        setLastScan(new Date());
        setStatusMsg(found > 0 ? `Found ${found} devices` : 'Scan complete');
        loadDevicesFromServer();
      },
    });
  };

  const runFullScan = () => {
    setScanning(true);
    setDevices([]);
    setStatusMsg('Starting full subnet scan...');
    runDiscovery({
      quickMode: false,
      onProgress: (msg) => setStatusMsg(msg),
      onComplete: ({ found, posted }) => {
        setScanning(false);
        setLastScan(new Date());
        setStatusMsg(`Scan complete — ${found} devices found, ${posted} updated`);
        loadDevicesFromServer();
      },
    });
  };

  const enrollDevice = async (device) => {
    setEnrolling(device.id || device.ip);
    try {
      await api.post('/api/cameras', {
        name: device.name || device.manufacturer || `Device ${device.ip}`,
        ip_address: device.ip_address || device.ip,
        mac_address: device.mac_address || device.mac,
        manufacturer: device.manufacturer,
        device_type: isCameraLikely(device) ? 'ip_camera' : 'unknown',
        is_enrolled: true,
        ssid_name: device.ssid_name,
      });
      // Remove from list after enrolling
      setDevices(prev => prev.filter(d => (d.id || d.ip) !== (device.id || device.ip)));
    } catch (e) {
      console.warn('[DiscoverScreen] enroll error:', e.message);
    } finally {
      setEnrolling(null);
    }
  };

  const dismissDevice = async (device) => {
    try {
      if (device.id) {
        await api.patch(`/api/cameras/${device.id}`, { is_dismissed: true });
      }
      setDevices(prev => prev.filter(d => (d.id || d.ip) !== (device.id || device.ip)));
    } catch (e) {}
  };

  const formatTime = (date) => {
    if (!date) return 'Never';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backText}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={s.title}>Discover</Text>
          <Text style={s.sub}>
            {Platform.OS === 'android' ? '🤖 ARP + Subnet' : '🍎 HTTP Scan'} · Last: {formatTime(lastScan)}
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
      {statusMsg ? (
        <View style={s.statusBar}>
          <Text style={s.statusText}>{statusMsg}</Text>
        </View>
      ) : null}

      {/* Platform advantage badge */}
      {Platform.OS === 'android' && (
        <View style={s.androidBadge}>
          <Text style={s.androidBadgeText}>
            🟢 Android ARP — reading real MAC addresses from network layer
          </Text>
        </View>
      )}

      {/* Device list */}
      <FlatList
        data={devices}
        keyExtractor={(item) => item.id || item.ip_address || item.ip || Math.random().toString()}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={scanning}
            onRefresh={runFullScan}
            tintColor="#E02020"
          />
        }
        ListEmptyComponent={
          !scanning ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>📡</Text>
              <Text style={s.emptyText}>No unenrolled devices found</Text>
              <Text style={s.emptySub}>Pull down or tap Scan to search your network</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const isCamera = isCameraLikely(item);
          const isEnrolling = enrolling === (item.id || item.ip_address || item.ip);
          const ip = item.ip_address || item.ip;
          const mac = item.mac_address || item.mac;
          const manufacturer = item.manufacturer || item.oui_manufacturer;

          return (
            <View style={[s.card, isCamera && s.cardCamera]}>
              <View style={s.cardLeft}>
                <Text style={s.cardIcon}>{deviceIcon(manufacturer)}</Text>
              </View>
              <View style={s.cardBody}>
                <Text style={s.cardName}>
                  {item.name || manufacturer || 'Unknown Device'}
                </Text>
                <Text style={s.cardIp}>{ip}</Text>
                {mac && <Text style={s.cardMac}>{mac}</Text>}
                {manufacturer && (
                  <View style={[s.mfrBadge, isCamera && s.mfrBadgeCamera]}>
                    <Text style={[s.mfrText, isCamera && s.mfrTextCamera]}>
                      {manufacturer}
                    </Text>
                  </View>
                )}
                {item.open_ports?.length > 0 && (
                  <Text style={s.ports}>
                    Ports: {item.open_ports.join(', ')}
                  </Text>
                )}
              </View>
              <View style={s.cardActions}>
                {isCamera && (
                  <TouchableOpacity
                    style={s.enrollBtn}
                    onPress={() => enrollDevice(item)}
                    disabled={isEnrolling}
                  >
                    {isEnrolling
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.enrollBtnText}>+ Add</Text>}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={s.dismissBtn}
                  onPress={() => dismissDevice(item)}
                >
                  <Text style={s.dismissBtnText}>✕</Text>
                </TouchableOpacity>
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
  back: { padding: 8 },
  backText: { color: '#E02020', fontSize: 22 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  sub: { color: '#555', fontSize: 11, marginTop: 2 },
  scanBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
    minWidth: 72, alignItems: 'center',
  },
  scanBtnActive: { borderColor: '#E02020' },
  scanBtnText: { color: '#E02020', fontWeight: '700', fontSize: 13 },

  statusBar: {
    backgroundColor: '#111', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  statusText: { color: '#888', fontSize: 12 },

  androidBadge: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    paddingHorizontal: 16, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: 'rgba(34,197,94,0.2)',
  },
  androidBadgeText: { color: '#22c55e', fontSize: 11 },

  list: { padding: 12, paddingBottom: 40 },
  empty: { paddingTop: 60, alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#555', fontSize: 16, fontWeight: '600' },
  emptySub: { color: '#333', fontSize: 13, marginTop: 6, textAlign: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 12,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1a1a1a',
  },
  cardCamera: { borderColor: 'rgba(224,32,32,0.3)' },
  cardLeft: { marginRight: 12 },
  cardIcon: { fontSize: 28 },
  cardBody: { flex: 1 },
  cardName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardIp: { color: '#888', fontSize: 12, marginTop: 2 },
  cardMac: { color: '#444', fontSize: 11, marginTop: 1 },
  mfrBadge: {
    alignSelf: 'flex-start', marginTop: 5,
    backgroundColor: '#1a1a1a', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  mfrBadgeCamera: { backgroundColor: 'rgba(224,32,32,0.15)' },
  mfrText: { color: '#666', fontSize: 11 },
  mfrTextCamera: { color: '#E02020', fontWeight: '600' },
  ports: { color: '#444', fontSize: 11, marginTop: 3 },

  cardActions: { gap: 8, alignItems: 'center' },
  enrollBtn: {
    backgroundColor: '#E02020', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7, minWidth: 56, alignItems: 'center',
  },
  enrollBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  dismissBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center',
  },
  dismissBtnText: { color: '#555', fontSize: 12 },
});
