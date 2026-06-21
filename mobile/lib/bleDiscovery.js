/**
 * RSC BLE Discovery — bleDiscovery.js
 *
 * Triggers BLE scan via native BleDiscoveryModule, collects results,
 * posts to VPS /api/cameras/ble-discovered for enrichment + confidence boost.
 *
 * Runs alongside ARP/IP scan in the same foreground service session.
 * Results are purely additive — never removes or replaces IP-discovered devices.
 *
 * VPS fallback: if scan fails or phone goes offline, caller can fetch
 * /api/cameras/ble-status to get last-known BLE table with stale indicator.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import api from './api';

const { BleDiscoveryModule } = NativeModules;

const BLE_POST_BATCH = 20;  // send devices to VPS in batches

/**
 * runBleScan()
 * Starts BLE scan, collects advertisements for 12 seconds, posts to VPS.
 * Returns { scanned, posted, error } summary.
 */
export async function runBleScan() {
  if (Platform.OS !== 'android') {
    return { scanned: 0, posted: 0, error: 'ios_not_supported_yet' };
  }

  if (!BleDiscoveryModule) {
    return { scanned: 0, posted: 0, error: 'native_module_not_found' };
  }

  const collected = [];

  // Listen for individual device events during scan
  const emitter = new NativeEventEmitter(BleDiscoveryModule);
  const deviceSub = emitter.addListener('bleDeviceFound', (device) => {
    collected.push(device);
  });

  try {
    const result = await BleDiscoveryModule.startBleScan();

    deviceSub.remove();

    if (!collected.length) {
      return { scanned: 0, posted: 0, result };
    }

    // Post to VPS in batches
    let posted = 0;
    for (let i = 0; i < collected.length; i += BLE_POST_BATCH) {
      const batch = collected.slice(i, i + BLE_POST_BATCH);
      try {
        await api.post('/api/cameras/ble-discovered', batch);
        posted += batch.length;
      } catch (e) {
        console.warn('[ble] batch post failed:', e.message);
      }
    }

    return { scanned: collected.length, posted, result };

  } catch (e) {
    deviceSub.remove();
    console.warn('[ble] scan error:', e.message);
    return { scanned: 0, posted: 0, error: e.message };
  }
}

/**
 * getBleStatus()
 * Fetches last-known BLE scan summary from VPS.
 * Used by Discover tab to show cached BLE devices when phone offline.
 */
export async function getBleStatus() {
  try {
    const { data } = await api.get('/api/cameras/ble-status');
    return data;
  } catch (e) {
    return { ok: false, ble_devices: [], stale: true, error: e.message };
  }
}
