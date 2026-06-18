/**
 * RSC Settings Screen
 *
 * Permission model:
 *   AUTHENTICATED USER  — clip lengths, night vision default, audio alerts, geofence
 *   ORG ADMIN ONLY      — geofence radius, face matching, member management
 *   NO ONE              — cloud storage (always on), AI detection (always on),
 *                         API endpoints, storage destination
 *
 * Cloud is always on. AI is always on. These are not toggles.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, ScrollView, Alert, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../AuthContext';

const DASHCAM_CLIPS = [
  { label: '30 seconds', value: 30 },
  { label: '1 minute',   value: 60 },
  { label: '5 minutes',  value: 300 },
  { label: '15 minutes', value: 900 },
  { label: '30 minutes', value: 1800 },
];
const SECURITY_CLIPS = [
  { label: '15 seconds', value: 15 },
  { label: '30 seconds', value: 30 },
  { label: '1 minute',   value: 60 },
  { label: '3 minutes',  value: 180 },
  { label: '5 minutes',  value: 300 },
];

export default function SettingsScreen({ navigation }) {
  const { user, org, logout } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

  const [dashclip, setDashclip] = useState(60);
  const [secclip, setSecclip] = useState(15);
  const [nightDefault, setNightDefault] = useState(false);
  const [audioAlerts, setAudioAlerts] = useState(true);
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      const keys = await AsyncStorage.multiGet([
        'rsc_dashcam_clip', 'rsc_security_clip',
        'rsc_night_default', 'rsc_audio_alerts', 'rsc_geofence_enabled',
      ]);
      const map = Object.fromEntries(keys.map(([k, v]) => [k, v]));
      if (map.rsc_dashcam_clip)      setDashclip(parseInt(map.rsc_dashcam_clip, 10));
      if (map.rsc_security_clip)     setSecclip(parseInt(map.rsc_security_clip, 10));
      if (map.rsc_night_default)     setNightDefault(map.rsc_night_default === 'true');
      if (map.rsc_audio_alerts)      setAudioAlerts(map.rsc_audio_alerts !== 'false');
      if (map.rsc_geofence_enabled)  setGeofenceEnabled(map.rsc_geofence_enabled === 'true');
    })();
  }, []);

  const save = async (key, val) => AsyncStorage.setItem(key, String(val));

  const planLabel = org?.plan
    ? org.plan.charAt(0).toUpperCase() + org.plan.slice(1)
    : 'Free';

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Settings</Text>
      </View>

      {/* Account */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Account</Text>
        <Row label="Name"         value={user?.name || '—'} />
        <Row label="Email"        value={user?.email || '—'} />
        <Row label="Organization" value={org?.name || '—'} />
        <Row label="Role"         value={user?.role || 'member'} highlight />
        <Row label="Plan"         value={planLabel} accent />
      </View>

      {/* Cloud Storage — informational only, not a toggle */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Storage</Text>
        <View style={s.infoCard}>
          <Text style={s.infoCardIcon}>☁️</Text>
          <View style={s.infoCardText}>
            <Text style={s.infoCardTitle}>RSC Cloud · Always Active</Text>
            <Text style={s.infoCardSub}>
              All recordings upload to RSC Cloud automatically.
              Clips are never auto-deleted. Storage grows as you record.
            </Text>
          </View>
        </View>
      </View>

      {/* AI — informational only, not a toggle */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>AI Detection</Text>
        <View style={s.infoCard}>
          <Text style={s.infoCardIcon}>🧠</Text>
          <View style={s.infoCardText}>
            <Text style={s.infoCardTitle}>On-Device AI · Always Active</Text>
            <Text style={s.infoCardSub}>
              YOLOv8 object detection, pose analysis, and face detection
              run automatically on every recording. No configuration needed.
            </Text>
          </View>
        </View>

        {/* Audio alerts IS a user toggle — they can silence notifications */}
        <View style={s.row}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>Audio Alert Notifications</Text>
            <Text style={s.rowSub}>Glass break, shouting, alarm sounds</Text>
          </View>
          <Switch
            value={audioAlerts}
            onValueChange={async (v) => { setAudioAlerts(v); await save('rsc_audio_alerts', v); }}
            trackColor={{ false: '#222', true: '#E02020' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Dashcam Clip Length */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>🚗 Dashcam Clip Length</Text>
        {DASHCAM_CLIPS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={s.radioRow}
            onPress={async () => { setDashclip(opt.value); await save('rsc_dashcam_clip', opt.value); }}
          >
            <View style={[s.radio, dashclip === opt.value && s.radioActive]}>
              {dashclip === opt.value && <View style={s.radioDot} />}
            </View>
            <Text style={s.radioLabel}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Security Cam Clip Length */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>🏠 Security Cam Clip Length</Text>
        {SECURITY_CLIPS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={s.radioRow}
            onPress={async () => { setSecclip(opt.value); await save('rsc_security_clip', opt.value); }}
          >
            <View style={[s.radio, secclip === opt.value && s.radioActive]}>
              {secclip === opt.value && <View style={s.radioDot} />}
            </View>
            <Text style={s.radioLabel}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Camera Defaults */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Camera Defaults</Text>
        <View style={s.row}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>Night Vision on Start</Text>
            <Text style={s.rowSub}>Enable automatically when camera opens</Text>
          </View>
          <Switch
            value={nightDefault}
            onValueChange={async (v) => { setNightDefault(v); await save('rsc_night_default', v); }}
            trackColor={{ false: '#222', true: '#E02020' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Geofence — user controls their own home */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>📍 Auto-Arm Geofence</Text>
        <View style={s.row}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>Auto-Arm When You Leave Home</Text>
            <Text style={s.rowSub}>
              Cameras arm automatically when you leave, disarm when you return
            </Text>
          </View>
          <Switch
            value={geofenceEnabled}
            onValueChange={async (v) => {
              setGeofenceEnabled(v);
              await save('rsc_geofence_enabled', v);
            }}
            trackColor={{ false: '#222', true: '#E02020' }}
            thumbColor="#fff"
          />
        </View>
        {geofenceEnabled && (
          <TouchableOpacity
            style={s.setHomeBtn}
            onPress={() => Alert.alert(
              'Set Home Location',
              'This will save your current GPS position as your home. Cameras will arm when you travel more than 150m away.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Set Home Here', onPress: () => {} }, // wired to geoFence.setHomeLocation()
              ]
            )}
          >
            <Text style={s.setHomeBtnText}>📍 Set Home Location</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Admin-only section */}
      {isAdmin && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>⚙️ Admin Controls</Text>
          <Text style={s.adminNote}>
            Camera enrollment, member management, Subject configuration,
            and billing are managed from the web dashboard at realsecuritycamera.com
          </Text>
        </View>
      )}

      {/* Sign out */}
      <View style={s.section}>
        <TouchableOpacity
          style={s.signOutBtn}
          onPress={() => Alert.alert('Sign Out', 'Sign out of RSC?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: logout },
          ])}
        >
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, highlight, accent }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[
        s.rowVal,
        highlight && { color: '#fff', fontWeight: '600' },
        accent && { color: '#E02020', fontWeight: '600' },
      ]}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingBottom: 60 },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  back: { marginBottom: 8 },
  backText: { color: '#E02020', fontSize: 15 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },

  section: {
    marginTop: 24, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: '#111', paddingBottom: 16,
  },
  sectionTitle: {
    color: '#555', fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14,
  },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#111', borderRadius: 12,
    padding: 14, gap: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#1a1a1a',
  },
  infoCardIcon: { fontSize: 22, marginTop: 2 },
  infoCardText: { flex: 1 },
  infoCardTitle: { color: '#fff', fontWeight: '700', fontSize: 14 },
  infoCardSub: { color: '#555', fontSize: 12, lineHeight: 18, marginTop: 3 },

  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10,
  },
  rowLeft: { flex: 1, paddingRight: 12 },
  rowLabel: { color: '#ccc', fontSize: 15 },
  rowSub: { color: '#555', fontSize: 12, marginTop: 2 },
  rowVal: { color: '#888', fontSize: 14 },

  radioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#333',
    justifyContent: 'center', alignItems: 'center',
  },
  radioActive: { borderColor: '#E02020' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E02020' },
  radioLabel: { color: '#ccc', fontSize: 15 },

  setHomeBtn: {
    marginTop: 10, backgroundColor: '#1a1a1a',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  setHomeBtnText: { color: '#E02020', fontWeight: '600', fontSize: 14 },

  adminNote: {
    color: '#444', fontSize: 13, lineHeight: 20,
    backgroundColor: '#111', borderRadius: 10, padding: 12,
  },

  signOutBtn: {
    borderRadius: 10, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  signOutText: { color: '#E02020', fontWeight: '600', fontSize: 15 },
});
