import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, ScrollView, Alert,
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
  const { user, org } = useAuth();

  const [dashclip, setDashclip] = useState(60);
  const [secclip, setSecclip] = useState(30);
  const [cloudEnabled, setCloudEnabled] = useState(true);   // always cloud by default
  const [nightDefault, setNightDefault] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      const keys = await AsyncStorage.multiGet([
        'rsc_dashcam_clip', 'rsc_security_clip',
        'rsc_cloud_enabled', 'rsc_night_default', 'rsc_audio_enabled',
      ]);
      const map = Object.fromEntries(keys.map(([k, v]) => [k, v]));
      if (map.rsc_dashcam_clip) setDashclip(parseInt(map.rsc_dashcam_clip, 10));
      if (map.rsc_security_clip) setSecclip(parseInt(map.rsc_security_clip, 10));
      // Cloud defaults to TRUE — never false unless user explicitly toggles
      setCloudEnabled(map.rsc_cloud_enabled !== 'false');
      if (map.rsc_night_default) setNightDefault(map.rsc_night_default === 'true');
      if (map.rsc_audio_enabled) setAudioEnabled(map.rsc_audio_enabled !== 'false');
    })();
  }, []);

  const save = async (key, val) => {
    await AsyncStorage.setItem(key, String(val));
  };

  const toggleCloud = async (val) => {
    if (!val) {
      Alert.alert(
        'Disable Cloud Storage?',
        'Recordings will only save to this device. RSC Cloud is recommended for remote access and backup.',
        [
          { text: 'Keep Cloud On', style: 'cancel' },
          {
            text: 'Disable Cloud',
            style: 'destructive',
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

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Camera Settings</Text>
      </View>

      {/* Account Info */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Account</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>Name</Text>
          <Text style={s.rowVal}>{user?.name || '—'}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>Email</Text>
          <Text style={s.rowVal}>{user?.email || '—'}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>Organization</Text>
          <Text style={s.rowVal}>{org?.name || '—'}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>Plan</Text>
          <Text style={[s.rowVal, { color: '#E02020' }]}>
            {org?.plan ? org.plan.charAt(0).toUpperCase() + org.plan.slice(1) : 'Free'}
          </Text>
        </View>
      </View>

      {/* Cloud Storage */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Storage</Text>
        <View style={s.row}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>RSC Cloud Storage</Text>
            <Text style={s.rowSub}>Always on · Recommended</Text>
          </View>
          <Switch
            value={cloudEnabled}
            onValueChange={toggleCloud}
            trackColor={{ false: '#222', true: '#E02020' }}
            thumbColor="#fff"
          />
        </View>
        <Text style={s.cloudNote}>
          ☁️ Clips are saved to RSC Cloud and never auto-deleted. Storage fills up as you record — upgrade your plan for more space.
        </Text>
      </View>

      {/* Dashcam Defaults */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>🚗 Dashcam Default Clip Length</Text>
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

      {/* Security Cam Defaults */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>🏠 Security Cam Default Clip Length</Text>
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
        <View style={s.row}>
          <View style={s.rowLeft}>
            <Text style={s.rowLabel}>Record Audio</Text>
            <Text style={s.rowSub}>Include microphone in recordings</Text>
          </View>
          <Switch
            value={audioEnabled}
            onValueChange={async (v) => { setAudioEnabled(v); await save('rsc_audio_enabled', v); }}
            trackColor={{ false: '#222', true: '#E02020' }}
            thumbColor="#fff"
          />
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingBottom: 60 },
  header: {
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16,
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
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10,
  },
  rowLeft: { flex: 1, paddingRight: 12 },
  rowLabel: { color: '#ccc', fontSize: 15 },
  rowSub: { color: '#555', fontSize: 12, marginTop: 2 },
  rowVal: { color: '#888', fontSize: 14 },

  cloudNote: {
    color: '#444', fontSize: 12, lineHeight: 18,
    marginTop: 8, paddingHorizontal: 2,
  },

  radioRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12,
  },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#333',
    justifyContent: 'center', alignItems: 'center',
  },
  radioActive: { borderColor: '#E02020' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E02020' },
  radioLabel: { color: '#ccc', fontSize: 15 },
});
