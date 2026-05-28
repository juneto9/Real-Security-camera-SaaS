import { registerRootComponent } from 'expo';
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

function LoginScreen({ navigation }) {
  return (
    <View style={s.c}>
      <Text style={s.t}>🔒 SecureCamera</Text>
      <TouchableOpacity style={s.btn} onPress={() => {
        Alert.alert('Tapped!', 'Navigation working?');
        navigation.navigate('Dashboard');
      }}>
        <Text style={s.btxt}>Open App</Text>
      </TouchableOpacity>
    </View>
  );
}

function DashboardScreen() {
  return (
    <View style={s.c}>
      <Text style={s.t}>📷 Dashboard</Text>
      <Text style={{color:'#666'}}>Navigation works!</Text>
    </View>
  );
}

function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  t: { color: '#00ff88', fontSize: 32, fontWeight: 'bold', marginBottom: 40 },
  btn: { backgroundColor: '#00ff88', padding: 16, borderRadius: 8, width: '100%', alignItems: 'center' },
  btxt: { color: '#000', fontSize: 16, fontWeight: 'bold' },
});

registerRootComponent(App);
