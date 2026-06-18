import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_BASE = 'https://api.realsecuritycamera.com';
export const LIVEKIT_URL = 'wss://livekit.realsecuritycamera.com';
export const LIVEKIT_TOKEN_URL = 'https://api.realsecuritycamera.com/api/livekit/token';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  try {
    const token = await AsyncStorage.getItem('accessToken');
    if (token) config.headers.Authorization = 'Bearer ' + token;
  } catch (e) {}
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.multiRemove(['accessToken', 'user']);
    }
    return Promise.reject(error);
  }
);

export default api;
