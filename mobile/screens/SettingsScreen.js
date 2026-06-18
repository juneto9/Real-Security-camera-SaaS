/**
 * RSC Settings Screen
 *
 * Permission model:
 *   AUTHENTICATED USER  — clip lengths, night vision, audio alerts, geofence,
 *                         cloud storage toggle, AI detection toggle
 *   ORG ADMIN ONLY      — geofence radius, face matching, member management
 *   NO ONE              — API endpoints, storage destination URL, AI models,
 *                         other org data
 *
 * Defaults: cloud ON, AI ON. Users can toggle either off on their own device.
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

  const [dashclip, setDashclip]             = useState(60);
  const [secclip, setSecclip]               = useState(15);
  const [nightDefault, setNightDefault]     = useState(false);
  const [audioAlerts, setAudioAlerts]       = useState(true);
  const [cloudEnabled, setCloudEnabled]     = useState(true);   // default ON
  const [aiEnabled, setAiEnabled]           = useState(true);   // default ON
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      const keys = await AsyncStorage.multiGet([
        'rsc_dashcam_clip', 'rsc_security_clip', 'rsc_night_default',
        'rsc_audio_alerts', 'rsc_cloud_enabled', 'rsc_ai_enabled',
        'rsc_geofence_enabled',
      ]);
      const m = Object.fromEntries(keys.map(([k, v]) => [k, v]));
      if (m.rsc_dashcam_clip)     setDashclip(parseInt(m.rsc_dashcam_clip, 10));
      if (m.rsc_security_clip)    setSecclip(parseInt(m.rsc_security_clip, 10));
      if (m.rsc_night_default)    setNightDefault(m.rsc_night_default === 'true');
      if (m.rsc_audio_alerts)     setAudioAlerts(m.rsc_audio_alerts !== 'false');
      // Cloud and AI default to ON — only false if explicitly set to 'false'
      if (m.rsc_cloud_enabled)    setCloudEnabled(m.rsc_cloud_enabled !== 'false');
      if (m.rsc_ai_enabled)       setAiEnabled(m.rsc_ai_enabled !== 'false');
      if (m.rsc_geofence_enabled) setGeofenceEnabled(m.rsc_geofence_enabled === 'true');
    })();
  }, []);

  const save = async (key, val) => AsyncStorage.setItem(key, String(val));

  const toggleCloud = async (val) => {
    if (!val) {
      Alert.alert(
        'Switch to Device Storage?',
        'Recordings will save to this device only. You can still view your existing cloud clips from the web dashboard.',
        [
          { text: 'Keep Cloud On', style: 'cancel' },
          {
            text: 'Use Device Storage',
            onPress: async () => {
              setCloudEnabled(false);
              await save('rsc_cloud_enabled', 'false');
            },
          },
        ]
      );
    } else {
      setCloudEnabled(true);
      await save('rsc_cloud_enabled', 'true');
    }
  };

  const toggleAI = async (val) => {
    if (!val) {
      Alert.alert(
        'Disable AI Detection?',
        'Object detection, pose analysis, and face detection will be paused. Motion and sound detection still work. You can turn AI back on anytime.',
        [
          { text: 'Keep AI On', style: 'cancel' },
          {
            text: 'Disable AI',
            onPress: async () => {
              setAiEnabled(false);
              await save('rsc_ai_enabled', 'false');
            },
          },
        ]
      );
    } else {
      setAiEnabled(true);
      await save('rsc_ai_enabled', 'true');
    }
  };

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
        <InfoRow label="Name"         value={user?.name || '—'} />
        <InfoRow label="Email"        value={user?.email || '—'} />
        <InfoRow label="Organization" value={org?.name || '—'} />
        <InfoRow label="Role"         value={user?.role || 'member'} highlight />
        <InfoRow label="Plan"         value={planLabel} accent />
      </View>

      {/* Storage */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Storage</Text>
        <View style={s.toggleRow}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>☁️ RSC Cloud Storage</Text>
            <Text style={s.rowSub}>
              {cloudEnabled
                ? 'Clips upload to RSC Cloud automatically · Never deleted'
                : 'Saving to this device only · Cloud clips still accessible on web'}
            </Text>
          </View>
          <Switch
            value={cloudEnabled}
            onValueChange={toggleCloud}
            trackColor={{ false: '#222', true: '#E02020' }}
            thumbColor="#fff"
          />
        </View>
        {!cloudEnabled && (
          <View style={s.warningCard}>
            <Text style={s.warningText}>
              ⚠️ Device storage fills up over time. Cloud storage is recommended for full access from any device.
            </Text>
          </View>
        )}
      </View>

      {/* AI Detection */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>AI Detection</Text>
        <View style={s.toggleRow}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>🧠 On-Device AI</Text>
            <Text style={s.rowSub}>
              {aiEnabled
                ? 'YOLOv8 object detection, pose analysis, face detection · Active'
                : 'AI paused · Motion and sound detection still active'}
            </Text>
          </View>
          <Switch
            value={aiEnabled}
            onValueChange={toggleAI}
            trackColor={{ false: '#222', true: '#E02020' }}
            thumbColor="#fff"
          />
        </View>
        {aiEnabled && (
          <View style={s.aiBadgeRow}>
            {['👤 Person', '🚗 Vehicle', '🐕 Animal', '📦 Package', '🏃 Behavior', '👁️ Face'].map(label => (
              <View key={label} style={s.aiBadge}>
                <Text style={s.aiBadgeText}>{label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Audio alerts always user-controllable */}
        <View style={s.toggleRow}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>🔊 Audio Alert Notifications</Text>
            <Text style={s.rowSub}>Glass break, shouting, alarms, dog barking</Text>
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
        <View style={s.toggleRow}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>🌙 Night Vision on Start</Text>
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

      {/* Geofence */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>📍 Auto-Arm Geofence</Text>
        <View style={s.toggleRow}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>Auto-Arm When You Leave Home</Text>
            <Text style={s.rowSub}>
              Cameras arm when you leave, disarm when you return
            </Text>
          </View>
          <Switch
            value={geofenceEnabled}
            onValueChange={async (v) => { setGeofenceEnabled(v); await save('rsc_geofence_enabled', v); }}
            trackColor={{ false: '#222', true: '#E02020' }}
            thumbColor="#fff"
          />
        </View>
        {geofenceEnabled && (
          <TouchableOpacity
            style={s.setHomeBtn}
            onPress={() => Alert.alert(
              'Set Home Location',
              'Save your current GPS position as home. Cameras arm when you travel more than 150m away.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Set Home Here', onPress: () => {} },
              ]
            )}
          >
            <Text style={s.setHomeBtnText}>📍 Set Home Location</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Admin redirect */}
      {isAdmin && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>⚙️ Admin Controls</Text>
          <Text style={s.adminNote}>
            Camera enrollment, member management, Subject configuration, and billing
            are managed at realsecuritycamera.com
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

function InfoRow({ label, value, highlight, accent }) {
  return (
    <View style={s.infoRow}>
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

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 9,
  },
  toggleRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
  },
  rowLeft: { flex: 1, paddingRight: 12 },
  rowLabel: { color: '#ccc', fontSize: 15 },
  rowSub: { color: '#555', fontSize: 12, marginTop: 2, lineHeight: 17 },
  rowVal: { color: '#888', fontSize: 14 },

  warningCard: {
    backgroundColor: 'rgba(234,88,12,0.1)',
    borderRadius: 10, padding: 12, marginTop: 4,
    borderWidth: 1, borderColor: 'rgba(234,88,12,0.3)',
  },
  warningText: { color: '#f97316', fontSize: 12, lineHeight: 18 },

  aiBadgeRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 12,
  },
  aiBadge: {
    backgroundColor: 'rgba(224,32,32,0.12)',
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(224,32,32,0.25)',
  },
  aiBadgeText: { color: '#E02020', fontSize: 11, fontWeight: '600' },

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
