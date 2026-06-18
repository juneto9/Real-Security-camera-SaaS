import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useAuth } from '../AuthContext';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Required', 'Enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e) {
      Alert.alert('Login Failed', e.response?.data?.message || 'Check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.logoRow}>
          <View style={s.logoBadge}>
            <Text style={s.logoText}>RSC</Text>
          </View>
        </View>
        <Text style={s.title}>Real Security Camera</Text>
        <Text style={s.sub}>Liberate Your Home</Text>

        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor="#555"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />
        <TextInput
          style={s.input}
          placeholder="Password"
          placeholderTextColor="#555"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />

        <TouchableOpacity style={s.btn} onPress={handleLogin} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Sign In</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')} disabled={loading}>
          <Text style={s.link}>No account? Register your organization</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 48 },
  logoRow: { alignItems: 'center', marginBottom: 16 },
  logoBadge: {
    width: 80, height: 80, borderRadius: 16,
    backgroundColor: '#E02020',
    justifyContent: 'center', alignItems: 'center',
  },
  logoText: { color: '#fff', fontWeight: '900', fontSize: 26, letterSpacing: 2 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  sub: { color: '#E02020', fontSize: 13, textAlign: 'center', marginBottom: 36, letterSpacing: 1 },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, color: '#fff',
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, marginBottom: 14,
  },
  btn: {
    backgroundColor: '#E02020', borderRadius: 10,
    paddingVertical: 15, alignItems: 'center', marginTop: 4, marginBottom: 20,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { color: '#888', textAlign: 'center', fontSize: 14 },
});
