import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert, ScrollView
} from 'react-native';
import useAuthStore from '../store/authStore';

export default function RegisterScreen({ navigation }) {
  const [form, setForm] = useState({
    email: '', password: '', firstName: '', lastName: '', orgName: ''
  });
  const { register, isLoading, error } = useAuthStore();

  const handleRegister = async () => {
    if (!form.email || !form.password || !form.firstName || !form.lastName) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }
    const success = await register(form.email, form.password, form.firstName, form.lastName, form.orgName);
    if (!success) Alert.alert('Registration Failed', error || 'Please try again');
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.title}>🔒 SecureCamera</Text>
        <Text style={styles.subtitle}>Create your account</Text>

        {['firstName', 'lastName', 'email', 'orgName'].map((field) => (
          <TextInput
            key={field}
            style={styles.input}
            placeholder={field === 'orgName' ? 'Organization Name (optional)' :
              field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
            placeholderTextColor="#666"
            value={form[field]}
            onChangeText={(v) => setForm(f => ({ ...f, [field]: v }))}
            keyboardType={field === 'email' ? 'email-address' : 'default'}
            autoCapitalize={field === 'email' ? 'none' : 'words'}
          />
        ))}
        <TextInput
          style={styles.input}
          placeholder="Password (min 8 chars)"
          placeholderTextColor="#666"
          value={form.password}
          onChangeText={(v) => setForm(f => ({ ...f, password: v }))}
          secureTextEntry
        />

        <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Create Account</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.link}>Already have an account? Login</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#00ff88', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 40 },
  input: {
    backgroundColor: '#1a1a1a', color: '#fff', padding: 16,
    borderRadius: 8, marginBottom: 16, fontSize: 16,
    borderWidth: 1, borderColor: '#333'
  },
  button: {
    backgroundColor: '#00ff88', padding: 16, borderRadius: 8,
    alignItems: 'center', marginBottom: 16
  },
  buttonText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  link: { color: '#00ff88', textAlign: 'center', marginTop: 8 },
});
