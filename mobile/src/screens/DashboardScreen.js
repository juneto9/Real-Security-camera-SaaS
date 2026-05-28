import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Alert, Dimensions
} from 'react-native';
import api from '../api';
import useAuthStore from '../store/authStore';

const { width } = Dimensions.get('window');

export default function DashboardScreen({ navigation }) {
  const [devices, setDevices] = useState([]);
  const [motionEvents, setMotionEvents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeMode, setActiveMode] = useState('viewer');
  const { user, logout } = useAuthStore();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [devRes, ] = await Promise.all([
        api.get('/api/devices'),
      ]);
      setDevices(devRes.data.data || []);
    } catch (err) {
      console.log('Load error:', err.message);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const addDevice = async () => {
    Alert.prompt('Add Camera', 'Enter device name:', async (name) => {
      if (!name) return;
      Alert.prompt('Location', 'Enter location:', async (location) => {
        try {
          await api.post('/api/devices', {
            device_name: name,
            location: location || 'Unknown',
            device_type: 'camera',
          });
          loadData();
        } catch (err) {
          Alert.alert('Error', 'Failed to add device');
        }
      });
    });
  };

  const openCamera = (device) => {
    navigation.navigate('Camera', { device, mode: 'camera' });
  };

  const renderDevice = ({ item }) => (
    <TouchableOpacity style={styles.deviceCard} onPress={() => openCamera(item)}>
      <View style={styles.deviceCardHeader}>
        <Text style={styles.deviceIcon}>📷</Text>
        <View style={[styles.statusDot,
          { backgroundColor: item.is_active ? '#00ff88' : '#666' }]} />
      </View>
      <Text style={styles.deviceName}>{item.device_name}</Text>
      <Text style={styles.deviceLocation}>📍 {item.location || 'No location'}</Text>
      <Text style={styles.deviceType}>{item.device_type || 'camera'}</Text>
      <TouchableOpacity
        style={styles.activateBtn}
        onPress={() => openCamera(item)}
      >
        <Text style={styles.activateBtnText}>
          {activeMode === 'camera' ? '📷 Use as Camera' : '👁 View Stream'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🔒 SecureCamera</Text>
          <Text style={styles.headerSub}>Welcome, {user?.first_name || 'User'}</Text>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logoutBtn}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Mode Toggle */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeBtn, activeMode === 'camera' && styles.modeBtnActive]}
          onPress={() => setActiveMode('camera')}
        >
          <Text style={[styles.modeBtnText, activeMode === 'camera' && styles.modeBtnTextActive]}>
            📷 Camera Mode
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, activeMode === 'viewer' && styles.modeBtnActive]}
          onPress={() => setActiveMode('viewer')}
        >
          <Text style={[styles.modeBtnText, activeMode === 'viewer' && styles.modeBtnTextActive]}>
            👁 Viewer Mode
          </Text>
        </TouchableOpacity>
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{devices.length}</Text>
          <Text style={styles.statLabel}>Cameras</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>
            {devices.filter(d => d.is_active).length}
          </Text>
          <Text style={styles.statLabel}>Online</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>11</Text>
          <Text style={styles.statLabel}>Days Storage</Text>
        </View>
      </View>

      {/* Devices grid */}
      <FlatList
        data={devices}
        renderItem={renderDevice}
        keyExtractor={item => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📷</Text>
            <Text style={styles.emptyText}>No cameras added yet</Text>
            <Text style={styles.emptySubtext}>Tap + to add your first camera</Text>
          </View>
        }
      />

      {/* Add device FAB */}
      <TouchableOpacity style={styles.fab} onPress={addDevice}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 20, paddingTop: 50,
    backgroundColor: '#111',
  },
  headerTitle: { color: '#00ff88', fontSize: 20, fontWeight: 'bold' },
  headerSub: { color: '#666', fontSize: 12, marginTop: 2 },
  logoutBtn: { color: '#ff4444', fontSize: 14 },
  modeToggle: {
    flexDirection: 'row', margin: 16,
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 4,
  },
  modeBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#00ff88' },
  modeBtnText: { color: '#666', fontWeight: '600', fontSize: 13 },
  modeBtnTextActive: { color: '#000' },
  statsBar: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: '#111', marginHorizontal: 16,
    borderRadius: 10, padding: 16, marginBottom: 16,
  },
  statItem: { alignItems: 'center' },
  statNumber: { color: '#00ff88', fontSize: 24, fontWeight: 'bold' },
  statLabel: { color: '#666', fontSize: 11, marginTop: 2 },
  grid: { padding: 8 },
  deviceCard: {
    flex: 1, margin: 6, backgroundColor: '#1a1a1a',
    borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#222',
  },
  deviceCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  deviceIcon: { fontSize: 28 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  deviceName: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  deviceLocation: { color: '#666', fontSize: 11, marginBottom: 4 },
  deviceType: { color: '#444', fontSize: 10, marginBottom: 8 },
  activateBtn: {
    backgroundColor: '#00ff8820', padding: 8,
    borderRadius: 6, alignItems: 'center',
    borderWidth: 1, borderColor: '#00ff8840',
  },
  activateBtnText: { color: '#00ff88', fontSize: 11, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptySubtext: { color: '#666', fontSize: 14, marginTop: 8 },
  fab: {
    position: 'absolute', bottom: 30, right: 20,
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#00ff88', justifyContent: 'center', alignItems: 'center',
    elevation: 8, shadowColor: '#00ff88', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  fabText: { color: '#000', fontSize: 32, fontWeight: 'bold', lineHeight: 36 },
});
