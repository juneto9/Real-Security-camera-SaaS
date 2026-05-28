import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

function LoginScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔒 SecureCamera</Text>
      <Text style={styles.subtitle}>Enterprise Security System</Text>
      <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Dashboard')}>
        <Text style={styles.buttonText}>Go to Dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}

function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>📷 Dashboard</Text>
      <Text style={styles.subtitle}>Your cameras will appear here</Text>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: '#00ff88', fontSize: 32, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { color: '#666', fontSize: 14, marginBottom: 40 },
  button: { backgroundColor: '#00ff88', padding: 16, borderRadius: 8, width: '100%', alignItems: 'center' },
  buttonText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
});