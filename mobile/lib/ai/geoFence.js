/**
 * RSC GeoFence — Auto-Arm / Auto-Disarm
 *
 * Uses the phone's GPS to automatically arm cameras when the user
 * leaves home and disarm when they return.
 *
 * This is an exclusive mobile-only feature that the web dashboard
 * cannot replicate — the phone knows where you are.
 *
 * Free tier: manual arm/disarm only
 * Pro tier:  full geofence automation
 *
 * How it works:
 *   1. User sets home location (saved once)
 *   2. App monitors GPS every 2 minutes in background
 *   3. When user leaves the geofence radius → all cameras ARM
 *   4. When user enters the geofence radius → all cameras DISARM
 *   5. Push notification confirms: "Cameras armed — you've left home"
 */

import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';

const GEOFENCE_KEY = 'rsc_home_geofence';
const GEOFENCE_RADIUS_METERS = 150; // ~half a block
const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

let _pollInterval = null;
let _lastArmedState = null; // 'armed' | 'disarmed' | null
let _onStatusChange = null;

/**
 * Save home location from current GPS position.
 */
export async function setHomeLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission denied');

  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const geofence = {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    radius: GEOFENCE_RADIUS_METERS,
    setAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(GEOFENCE_KEY, JSON.stringify(geofence));
  console.log('[GeoFence] Home location saved:', geofence.lat, geofence.lng);
  return geofence;
}

/**
 * Get saved home geofence.
 */
export async function getHomeLocation() {
  const stored = await AsyncStorage.getItem(GEOFENCE_KEY);
  return stored ? JSON.parse(stored) : null;
}

/**
 * Clear saved home location.
 */
export async function clearHomeLocation() {
  await AsyncStorage.removeItem(GEOFENCE_KEY);
  _lastArmedState = null;
}

/**
 * Distance between two GPS coords in meters (Haversine formula).
 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Check current position against home geofence.
 * Arms/disarms cameras automatically.
 */
async function checkGeofence() {
  try {
    const geofence = await getHomeLocation();
    if (!geofence) return;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const dist = distanceMeters(
      loc.coords.latitude, loc.coords.longitude,
      geofence.lat, geofence.lng
    );

    const isAtHome = dist <= geofence.radius;
    const shouldBeArmed = !isAtHome;
    const newState = shouldBeArmed ? 'armed' : 'disarmed';

    // Only act on state change
    if (newState === _lastArmedState) return;

    _lastArmedState = newState;
    console.log(`[GeoFence] State → ${newState} (${Math.round(dist)}m from home)`);

    // Arm/disarm all cameras in org
    await api.post('/api/cameras/arm-all', {
      armed: shouldBeArmed,
      reason: shouldBeArmed ? 'geofence_left' : 'geofence_returned',
      distance_meters: Math.round(dist),
    });

    _onStatusChange?.({
      state: newState,
      distanceMeters: Math.round(dist),
      message: shouldBeArmed
        ? `📍 Left home — cameras armed automatically`
        : `🏠 Arrived home — cameras disarmed`,
    });

  } catch (err) {
    console.warn('[GeoFence] Check error:', err.message);
  }
}

/**
 * Start geofence monitoring.
 * @param {function} onStatusChange - called when arm state changes
 * @returns {function} cleanup
 */
export async function startGeofenceMonitoring(onStatusChange) {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[GeoFence] Background location permission not granted');
    return () => {};
  }

  _onStatusChange = onStatusChange;

  // Check immediately, then on interval
  await checkGeofence();
  _pollInterval = setInterval(checkGeofence, POLL_INTERVAL_MS);

  return () => {
    if (_pollInterval) clearInterval(_pollInterval);
    _onStatusChange = null;
  };
}

export function stopGeofenceMonitoring() {
  if (_pollInterval) clearInterval(_pollInterval);
  _onStatusChange = null;
}
