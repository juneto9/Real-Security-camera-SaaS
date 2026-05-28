import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check if user is already logged in on app start
  useEffect(() => {
    const bootstrapAsync = async () => {
      try {
        const savedToken = await AsyncStorage.getItem('accessToken');
        const savedUser = await AsyncStorage.getItem('user');
        if (savedToken) {
          setToken(savedToken);
          setUser(savedUser ? JSON.parse(savedUser) : null);
        }
      } catch (e) {
        console.log('Failed to restore token', e);
      } finally {
        setReady(true);
      }
    };

    bootstrapAsync();
  }, []);

  const authContext = {
    token,
    user,
    ready,
    loading,
    login: async (email, password, api) => {
      setLoading(true);
      try {
        const res = await api.post('/api/auth/login', { email, password });
        const { accessToken, user: userData } = res.data.data;
        
        await AsyncStorage.setItem('accessToken', accessToken);
        await AsyncStorage.setItem('user', JSON.stringify(userData));
        
        setToken(accessToken);
        setUser(userData);
        return { success: true, user: userData };
      } catch (error) {
        const message = error.response?.data?.message || 'Login failed';
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    register: async (formData, api) => {
      setLoading(true);
      try {
        const res = await api.post('/api/auth/register', formData);
        const { accessToken, user: userData } = res.data.data;
        
        await AsyncStorage.setItem('accessToken', accessToken);
        await AsyncStorage.setItem('user', JSON.stringify(userData));
        
        setToken(accessToken);
        setUser(userData);
        return { success: true, user: userData };
      } catch (error) {
        const message = error.response?.data?.message || 'Registration failed';
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    logout: async () => {
      setLoading(true);
      try {
        await AsyncStorage.removeItem('accessToken');
        await AsyncStorage.removeItem('user');
        setToken(null);
        setUser(null);
      } catch (error) {
        console.log('Logout error', error);
      } finally {
        setLoading(false);
      }
    },
  };

  return (
    <AuthContext.Provider value={authContext}>
      {children}
    </AuthContext.Provider>
  );
}