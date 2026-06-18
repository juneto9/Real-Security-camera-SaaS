import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './lib/api';

export const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedUser, savedOrg] = await AsyncStorage.multiGet([
          'accessToken', 'user', 'org',
        ]);
        if (savedToken[1]) {
          setToken(savedToken[1]);
          setUser(savedUser[1] ? JSON.parse(savedUser[1]) : null);
          setOrg(savedOrg[1] ? JSON.parse(savedOrg[1]) : null);
        }
      } catch (e) {
        console.log('Auth restore error:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/api/auth/login', { email, password });
    const { accessToken, user: userData } = res.data.data;
    await AsyncStorage.multiSet([
      ['accessToken', accessToken],
      ['user', JSON.stringify(userData)],
    ]);
    setToken(accessToken);
    setUser(userData);

    // Fetch org info right after login
    try {
      const orgRes = await api.get('/api/org', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      const orgData = orgRes.data;
      await AsyncStorage.setItem('org', JSON.stringify(orgData));
      setOrg(orgData);
    } catch (e) {
      console.log('Org fetch error:', e);
    }

    return { success: true, user: userData };
  };

  const register = async (formData) => {
    const res = await api.post('/api/auth/register', formData);
    const { accessToken, user: userData } = res.data.data;
    await AsyncStorage.multiSet([
      ['accessToken', accessToken],
      ['user', JSON.stringify(userData)],
    ]);
    setToken(accessToken);
    setUser(userData);
    return { success: true, user: userData };
  };

  const logout = async () => {
    await AsyncStorage.multiRemove(['accessToken', 'user', 'org']);
    setToken(null);
    setUser(null);
    setOrg(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, org, ready, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
