import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useAuth } from '../AuthContext';

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' });
  const [loading, setLoading] = useState(false);

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const handleRegister = async () => {
    if (!form.name || !form.email || !form.password || !form.orgName) {
      Alert.alert('Required', 'Please fill in all fields.');
      return;
    }
    if (form.password.length < 8) {
      Alert.alert('Password', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        orgName: form.orgName.trim(),
      });
    } catch (e) {
      Alert.alert('Registration Failed', e.response?.data?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={s.title}>Create Organization</Text>
        <Text style={s.sub}>You'll be the primary admin</Text>

        {[
          { key: 'name', label: 'Your Full Name', keyboard: 'default', caps: 'words' },
          { key: 'orgName', label: 'Organization Name', keyboard: 'default', caps: 'words' },
          { key: 'email', label: 'Email', keyboard: 'email-address', caps: 'none' },
          { key: 'password', label: 'Password (min 8 chars)', keyboard: 'default', caps: 'none', secure: true },
        ].map(({ key, label, keyboard, caps, secure }) => (
          <TextInput
            key={key}
            style={s.input}
            placeholder={label}
            placeholderTextColor="#555"
            value={form[key]}
            onChangeText={set(key)}
            keyboardType={keyboard}
            autoCapitalize={caps}
            autoCorrect={false}
            secureTextEntry={!!secure}
            editable={!loading}
          />
        ))}

        <TouchableOpacity style={s.btn} onPress={handleRegister} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Create Account</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingVertical: 48 },
  back: { marginBottom: 24 },
  backText: { color: '#E02020', fontSize: 15 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 4 },
  sub: { color: '#888', fontSize: 13, marginBottom: 32 },
  input: {
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, color: '#fff',
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, marginBottom: 14,
  },
  btn: {
    backgroundColor: '#E02020', borderRadius: 10,
    paddingVertical: 15, alignItems: 'center', marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
