import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';

const useAuthStore = create((set) => ({
  user: null,
  token: null,
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/api/auth/login', { email, password });
      const { user, accessToken, refreshToken } = res.data.data;
      await AsyncStorage.setItem('accessToken', accessToken);
      await AsyncStorage.setItem('refreshToken', refreshToken);
      set({ user, token: accessToken, isLoading: false });
      return true;
    } catch (err) {
      set({ error: err.response?.data?.message || 'Login failed', isLoading: false });
      return false;
    }
  },

  register: async (email, password, firstName, lastName, orgName) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/api/auth/register', {
        email, password,
        first_name: firstName,
        last_name: lastName,
        org_name: orgName,
      });
      const { user, accessToken, refreshToken } = res.data.data;
      await AsyncStorage.setItem('accessToken', accessToken);
      await AsyncStorage.setItem('refreshToken', refreshToken);
      set({ user, token: accessToken, isLoading: false });
      return true;
    } catch (err) {
      set({ error: err.response?.data?.message || 'Registration failed', isLoading: false });
      return false;
    }
  },

  logout: async () => {
    await AsyncStorage.removeItem('accessToken');
    await AsyncStorage.removeItem('refreshToken');
    set({ user: null, token: null });
  },

  loadStoredAuth: async () => {
    const token = await AsyncStorage.getItem('accessToken');
    if (token) set({ token });
  },
}));

export default useAuthStore;
