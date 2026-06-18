import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../AuthContext';
import api from '../lib/api';

export default function DashboardScreen({ navigation }) {
  const { user, org, logout } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDevices = async () => {
    try {
      const res = await api.get('/api/cameras');
      setDevices(res.data.cameras || res.data || []);
    } catch (e) {
      console.error('Fetch devices error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { fetchDevices(); }, []));

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Sign out of RSC?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const planLabel = org?.plan ? org.plan.charAt(0).toUpperCase() + org.plan.slice(1) : 'Free';

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.orgName}>{org?.name || 'My Organization'}</Text>
          <Text style={s.planBadge}>{planLabel} Plan</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}>
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Launch Phone Camera Button */}
      <TouchableOpacity
        style={s.launchBtn}
        onPress={() => navigation.navigate('Camera')}
      >
        <Text style={s.launchIcon}>📷</Text>
        <View style={s.launchTextWrap}>
          <Text style={s.launchTitle}>Use This Phone as Camera</Text>
          <Text style={s.launchSub}>Dual stream · Cloud recording · Live PiP</Text>
        </View>
        <Text style={s.launchArrow}>▶</Text>
      </TouchableOpacity>

      {/* Device List */}
      <Text style={s.sectionTitle}>Organization Cameras</Text>
      <FlatList
        data={devices}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchDevices(); }}
            tintColor="#E02020"
          />
        }
        contentContainerStyle={s.list}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>No cameras enrolled yet.</Text>
              <Text style={s.emptySub}>Tap the button above to add this phone.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={s.deviceCard}>
            <View style={[s.statusDot, { backgroundColor: item.is_online ? '#22c55e' : '#444' }]} />
            <View style={s.deviceInfo}>
              <Text style={s.deviceName}>{item.name || item.device_name || 'Camera'}</Text>
              <Text style={s.deviceSub}>
                {item.ip_address || 'No IP'} · {item.is_online ? 'Online' : 'Offline'}
              </Text>
            </View>
            <TouchableOpacity
              style={s.viewBtn}
              onPress={() => navigation.navigate('ViewCamera', { device: item })}
            >
              <Text style={s.viewBtnText}>View</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Bottom Nav */}
      <View style={s.bottomNav}>
        <TouchableOpacity style={s.navItem} onPress={() => navigation.navigate('Settings')}>
          <Text style={s.navIcon}>⚙️</Text>
          <Text style={s.navLabel}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.navItem} onPress={() => navigation.navigate('Recordings')}>
          <Text style={s.navIcon}>🎬</Text>
          <Text style={s.navLabel}>Recordings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  orgName: { color: '#fff', fontSize: 18, fontWeight: '700' },
  planBadge: { color: '#E02020', fontSize: 12, marginTop: 2 },
  logoutBtn: { padding: 8 },
  logoutText: { color: '#555', fontSize: 14 },

  launchBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#E02020', margin: 16,
    borderRadius: 14, padding: 16, gap: 12,
  },
  launchIcon: { fontSize: 28 },
  launchTextWrap: { flex: 1 },
  launchTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  launchSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  launchArrow: { color: '#fff', fontSize: 20, fontWeight: '300' },

  sectionTitle: {
    color: '#555', fontSize: 12, fontWeight: '600',
    paddingHorizontal: 20, paddingBottom: 8,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  empty: { paddingTop: 40, alignItems: 'center' },
  emptyText: { color: '#555', fontSize: 15 },
  emptySub: { color: '#333', fontSize: 13, marginTop: 6 },

  deviceCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 12,
    padding: 14, marginBottom: 10, gap: 12,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  deviceInfo: { flex: 1 },
  deviceName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  deviceSub: { color: '#555', fontSize: 12, marginTop: 2 },
  viewBtn: {
    backgroundColor: '#1a1a1a', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  viewBtnText: { color: '#E02020', fontWeight: '600', fontSize: 13 },

  bottomNav: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row',
    backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#1a1a1a',
    paddingBottom: 28, paddingTop: 10,
  },
  navItem: { flex: 1, alignItems: 'center', gap: 4 },
  navIcon: { fontSize: 22 },
  navLabel: { color: '#555', fontSize: 11 },
});
