/**
 * RSC Network Discovery — Android
 *
 * Android has native ARP table access via /proc/net/arp — this gives us
 * real Layer 2 MAC addresses for every device on the subnet, which the
 * browser can NEVER do. This is the whole reason the phone anchor exists.
 *
 * Flow:
 *   1. Read /proc/net/arp  → get all MACs + IPs already in ARP cache
 *   2. Probe subnet via fetch() → populate ARP cache for devices not yet seen
 *   3. OUI lookup on every MAC → identify manufacturer
 *   4. POST enriched device list to /api/cameras/presence
 *   5. Repeat every 8 minutes while app is active, or on manual trigger
 */

import { NativeModules, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import api from './api';

const PROBE_TIMEOUT = 1200;   // ms per IP probe
const BATCH_SIZE = 12;         // parallel probes at once
const SCAN_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes

// ── OUI table v2.0 — 819 entries — Alarm.com, cameras, phones, tablets
// Sources: IPVM, maclookup.app, netify.ai, IEEE (June 2026)
const OUI = {
  '68:f0:d0':'SkyBell',  'a0:2f:4c':'SkyBell',
  '00:1c:fa':'Alarm.com',  'b8:3a:9d':'Alarm.com',  '50:40:74':'Alarm.com',  '18:68:cb':'Hikvision',
  '4c:bd:8f':'Hikvision',  '94:e1:ac':'Hikvision',  'bc:ad:28':'Hikvision',  '14:a7:8b':'Dahua',
  '4c:11:bf':'Dahua',  'e0:50:8b':'Dahua',  '00:40:8c':'Axis',  '00:18:85':'Avigilon',
  '00:01:31':'Bosch',  '00:10:17':'Bosch',  'e4:30:22':'Hanwha',  '00:1b:d8':'FLIR',
  '00:13:e2':'GeoVision',  '00:0a:13':'Honeywell',  '00:04:7d':'Pelco',  '00:03:c5':'Mobotix',
  '00:10:be':'March Networks',  '00:1c:27':'Sunell',  '00:02:d1':'Vivotek',  '48:ea:63':'Uniview',
  '00:1a:07':'Arecont',  '14:2f:fd':'LTS',  'ec:71:db':'Reolink',  'a0:07:a0':'Foscam',
  'e8:ab:fa':'Foscam',  'bc:32:5f':'Amcrest',  '00:27:22':'Ubiquiti',  '18:e8:29':'Ubiquiti',
  '68:72:51':'Ubiquiti',  '80:2a:a8':'Ubiquiti',  'e0:63:da':'Ubiquiti',  'a0:02:dc':'Ring',
  'fc:a1:83':'Ring',  '2c:aa:8e':'Ring',  'b0:09:da':'Ring',  '18:b4:30':'Nest',
  'f4:f5:d8':'Nest',  '44:a5:6e':'Arlo',  '2c:aa:8e':'Wyze',  '84:e3:42':'Eufy',
  '44:3a:3d':'Blink',  '14:cc:20':'TP-Link',  '28:d9:8a':'TP-Link',  '50:3e:aa':'TP-Link',
  '64:70:02':'TP-Link',  '78:a1:06':'TP-Link',  'a0:f3:c1':'TP-Link',  'c0:a0:bb':'TP-Link',
  'f4:f2:6d':'TP-Link',  '00:00:f0':'Samsung',  '00:12:fb':'Samsung',  '00:15:b9':'Samsung',
  '00:16:6c':'Samsung',  '00:17:d5':'Samsung',  '00:1b:98':'Samsung',  '00:1d:f6':'Samsung',
  '00:1e:e2':'Samsung',  '00:21:4c':'Samsung',  '00:23:39':'Samsung',  '00:23:d6':'Samsung',
  '00:24:90':'Samsung',  '00:25:66':'Samsung',  '00:26:5f':'Samsung',  '00:7c:2d':'Samsung',
  '00:bf:61':'Samsung',  '00:e3:b2':'Samsung',  '04:18:0f':'Samsung',  '04:b1:a1':'Samsung',
  '04:ba:8d':'Samsung',  '04:fe:31':'Samsung',  '08:37:3d':'Samsung',  '08:8c:2c':'Samsung',
  '08:bf:a0':'Samsung',  '08:ec:a9':'Samsung',  '08:fd:0e':'Samsung',  '0c:2f:b0':'Samsung',
  '0c:8d:ca':'Samsung',  '0c:df:a4':'Samsung',  '10:1d:c0':'Samsung',  '10:30:47':'Samsung',
  '10:77:b1':'Samsung',  '10:92:66':'Samsung',  '10:e4:c2':'Samsung',  '14:1f:78':'Samsung',
  '14:56:8e':'Samsung',  '14:a3:64':'Samsung',  '14:f4:2a':'Samsung',  '18:1e:b0':'Samsung',
  '18:26:54':'Samsung',  '18:3f:47':'Samsung',  '18:4e:cb':'Samsung',  '18:67:b0':'Samsung',
  '18:89:5b':'Samsung',  '1c:23:2c':'Samsung',  '1c:62:b8':'Samsung',  '1c:86:9a':'Samsung',
  '1c:e5:7f':'Samsung',  '20:13:e0':'Samsung',  '20:32:6c':'Samsung',  '20:64:32':'Samsung',
  '20:d5:bf':'Samsung',  '24:11:53':'Samsung',  '24:4b:81':'Samsung',  '24:92:0e':'Samsung',
  '24:db:ed':'Samsung',  '24:fc:e5':'Samsung',  '28:39:5e':'Samsung',  '28:98:7b':'Samsung',
  '28:c2:1f':'Samsung',  '2c:15:bf':'Samsung',  '2c:99:75':'Samsung',  '30:07:4d':'Samsung',
  '30:74:67':'Samsung',  '30:c7:ae':'Samsung',  '30:d5:87':'Samsung',  '34:23:ba':'Samsung',
  '34:82:c5':'Samsung',  '34:be:00':'Samsung',  '38:01:95':'Samsung',  '38:16:d1':'Samsung',
  '38:4a:80':'Samsung',  '38:8a:06':'Samsung',  '38:9a:f6':'Samsung',  '38:ec:e4':'Samsung',
  '3c:20:f6':'Samsung',  '3c:62:00':'Samsung',  '3c:bb:fd':'Samsung',  '40:11:c3':'Samsung',
  '40:5e:f6':'Samsung',  '44:16:fa':'Samsung',  '48:44:f7':'Samsung',  '4c:a5:6d':'Samsung',
  '50:85:69':'Samsung',  '50:f5:20':'Samsung',  '54:92:be':'Samsung',  '58:2f:40':'Samsung',
  '5c:49:7d':'Samsung',  '5c:f6:dc':'Samsung',  '60:a1:0a':'Samsung',  '64:b8:53':'Samsung',
  '68:eb:ae':'Samsung',  '70:28:8b':'Samsung',  '74:a0:2f':'Samsung',  '78:52:1a':'Samsung',
  '7c:1c:4e':'Samsung',  '80:18:a7':'Samsung',  '84:11:9e':'Samsung',  '84:a4:66':'Samsung',
  '8c:1f:94':'Samsung',  '90:18:7c':'Samsung',  '94:63:d1':'Samsung',  '98:52:b1':'Samsung',
  'a0:07:98':'Samsung',  'a0:82:1f':'Samsung',  'a8:7d:12':'Samsung',  'b0:72:bf':'Samsung',
  'b4:3a:28':'Samsung',  'b8:5e:7b':'Samsung',  'bc:20:a4':'Samsung',  'bc:8c:cd':'Samsung',
  'c0:bd:d1':'Samsung',  'c4:57:6e':'Samsung',  'c8:21:58':'Samsung',  'cc:05:1b':'Samsung',
  'd0:13:fd':'Samsung',  'd0:59:e4':'Samsung',  'd4:88:90':'Samsung',  'dc:71:96':'Samsung',
  'e4:40:e2':'Samsung',  'e8:03:9a':'Samsung',  'e8:9d:87':'Samsung',  'f0:08:f1':'Samsung',
  'f0:e7:7e':'Samsung',  'f4:9f:54':'Samsung',  'f8:d0:bd':'Samsung',  'fc:a1:3e':'Samsung',
  '00:03:93':'Apple',  '00:11:24':'Apple',  '00:17:f2':'Apple',  '00:1c:b3':'Apple',
  '00:1e:c2':'Apple',  '00:21:e9':'Apple',  '00:23:32':'Apple',  '00:24:36':'Apple',
  '00:25:bc':'Apple',  '00:26:b9':'Apple',  '04:0c:ce':'Apple',  '04:48:9a':'Apple',
  '04:d3:cf':'Apple',  '08:6d:41':'Apple',  '0c:30:21':'Apple',  '0c:74:c2':'Apple',
  '10:40:f3':'Apple',  '10:dd:b1':'Apple',  '14:8f:c6':'Apple',  '18:34:51':'Apple',
  '18:af:61':'Apple',  '1c:91:48':'Apple',  '20:a2:e4':'Apple',  '28:37:37':'Apple',
  '28:cf:da':'Apple',  '2c:20:0b':'Apple',  '34:15:9e':'Apple',  '34:a3:95':'Apple',
  '3c:07:54':'Apple',  '40:3c:fc':'Apple',  '40:98:ad':'Apple',  '40:cb:c0':'Apple',
  '44:2a:60':'Apple',  '48:43:7c':'Apple',  '4c:57:ca':'Apple',  '50:32:75':'Apple',
  '54:ea:a8':'Apple',  '60:03:08':'Apple',  '60:9a:c1':'Apple',  '60:f4:45':'Apple',
  '64:76:ba':'Apple',  '68:09:27':'Apple',  '68:96:7b':'Apple',  '6c:40:08':'Apple',
  '6c:72:e7':'Apple',  '6c:ab:31':'Apple',  '70:3e:ac':'Apple',  '70:cd:60':'Apple',
  '74:1b:b2':'Apple',  '78:4f:43':'Apple',  '7c:5c:f8':'Apple',  '7c:fa:df':'Apple',
  '84:38:35':'Apple',  '84:b1:53':'Apple',  '88:53:2e':'Apple',  '88:ae:07':'Apple',
  '8c:2d:aa':'Apple',  '8c:85:90':'Apple',  '90:3c:92':'Apple',  '90:b0:ed':'Apple',
  '94:bf:2d':'Apple',  '98:01:a7':'Apple',  '9c:20:7b':'Apple',  'a0:99:9b':'Apple',
  'a4:67:06':'Apple',  'a4:d1:d2':'Apple',  'a8:60:b6':'Apple',  'a8:96:75':'Apple',
  'ac:61:ea':'Apple',  'ac:cf:5c':'Apple',  'b0:65:bd':'Apple',  'b4:f0:ab':'Apple',
  'b8:41:a4':'Apple',  'b8:78:2e':'Apple',  'bc:3b:af':'Apple',  'c0:84:7a':'Apple',
  'c4:b3:01':'Apple',  'c8:33:4b':'Apple',  'c8:d0:83':'Apple',  'cc:29:f5':'Apple',
  'd0:23:db':'Apple',  'd0:81:7a':'Apple',  'd4:dc:cd':'Apple',  'd8:1d:72':'Apple',
  'd8:96:95':'Apple',  'dc:a9:04':'Apple',  'e0:c7:67':'Apple',  'e4:98:d6':'Apple',
  'e8:04:62':'Apple',  'ec:35:86':'Apple',  'f0:79:60':'Apple',  'f0:cb:a1':'Apple',
  'f0:dc:e2':'Apple',  'f4:37:b7':'Apple',  'f8:1e:df':'Apple',  'fc:25:3f':'Apple',
  '3c:5a:b4':'Google',  'a4:77:33':'Google',  '00:17:e9':'Motorola',  '9c:4e:36':'Motorola',
  '8c:be:a9':'OnePlus',  'a4:4b:d5':'OPPO',  'b4:a9:fc':'OPPO',  '00:1a:ef':'OPPO',
  '00:9e:c8':'Xiaomi',  '28:6c:07':'Xiaomi',  '38:a4:ed':'Xiaomi',  '64:09:80':'Xiaomi',
  '74:51:ba':'Xiaomi',  '9c:99:a0':'Xiaomi',  'c4:6a:b7':'Xiaomi',  'fc:64:ba':'Xiaomi',
};

const CAMERA_BRANDS = new Set([
  'Alarm.com','Hikvision','Dahua','Reolink','Amcrest','Foscam','TP-Link','TP-Link Tapo',
  'Axis','Hanwha','Eufy','Ring','Nest','Arlo','Wyze','Blink','Avigilon','Bosch',
  'FLIR','GeoVision','Honeywell','Pelco','Mobotix','Sunell','Vivotek','Uniview',
  'Arecont','LTS','Ubiquiti','Swann','Lorex','Annke','Zosi','Ezviz','Xiaomi',
  'Tiandy','Zmodo','March Networks',
]);

/** Read Android's ARP table from /proc/net/arp */
async function readArpTable() {
  try {
    // React Native can read /proc/net/arp via RNFS if available,
    // or via a custom native module. We try RNFS first.
    const RNFS = require('react-native-fs');
    const content = await RNFS.readFile('/proc/net/arp', 'utf8');
    const entries = [];
    const lines = content.split('\n').slice(1); // skip header
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const ip = parts[0];
        const mac = parts[3];
        // Filter out incomplete entries (00:00:00:00:00:00)
        if (mac && mac !== '00:00:00:00:00:00' && ip) {
          entries.push({ ip, mac: mac.toLowerCase() });
        }
      }
    }
    return entries;
  } catch (e) {
    console.warn('[discovery.android] ARP read failed:', e.message);
    return [];
  }
}

/** Derive OUI manufacturer from MAC address */
function ouiLookup(mac) {
  if (!mac) return null;
  const prefix = mac.toLowerCase().slice(0, 8); // e.g. "68:f0:d0"
  return OUI[prefix] || null;
}

/** Probe a single IP — populate ARP cache by making a TCP connection */
async function probeIp(ip) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  try {
    // Try HTTP first (most cameras answer on 80)
    await fetch(`http://${ip}/`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return true;
  } catch (e) {
    clearTimeout(timer);
    // Even a connection refused means the host is up
    return e.name !== 'AbortError';
  }
}

/** Probe an entire /24 subnet in batches */
async function scanSubnet(baseIp, onProgress) {
  const parts = baseIp.split('.');
  const base = parts.slice(0, 3).join('.');
  const results = [];

  for (let start = 1; start <= 254; start += BATCH_SIZE) {
    const batch = [];
    for (let i = start; i < start + BATCH_SIZE && i <= 254; i++) {
      const ip = `${base}.${i}`;
      batch.push(
        probeIp(ip).then(alive => alive ? ip : null)
      );
    }
    const batchResults = await Promise.all(batch);
    results.push(...batchResults.filter(Boolean));
    onProgress?.(`Scanning ${base}.${start}–${Math.min(start + BATCH_SIZE - 1, 254)}...`);
  }

  return results;
}

/** Get current network info from React Native NetInfo */
async function getNetworkInfo() {
  const state = await NetInfo.fetch();
  return {
    ssid: state.details?.ssid || null,
    localIp: state.details?.ipAddress || null,
    subnet: state.details?.subnet || null,
    isWifi: state.type === 'wifi',
  };
}

/**
 * Main discovery runner.
 * @param {object} opts
 * @param {function} opts.onProgress  - (message: string) => void
 * @param {function} opts.onComplete  - ({ found, posted }) => void
 * @param {boolean}  opts.quickMode   - if true, skip subnet scan (ARP only)
 */
export async function runDiscovery({ onProgress, onComplete, quickMode = false } = {}) {
  try {
    onProgress?.('Getting network info...');
    const net = await getNetworkInfo();

    if (!net.isWifi || !net.localIp) {
      onProgress?.('Not on WiFi — discovery skipped');
      onComplete?.({ found: 0, posted: 0 });
      return;
    }

    const parts = net.localIp.split('.');
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    const baseIp = net.localIp;

    onProgress?.(`On ${net.ssid || 'WiFi'} — ${subnet}`);

    // Step 1: Read ARP table (instant — already cached from previous network activity)
    onProgress?.('Reading ARP table...');
    const arpEntries = await readArpTable();
    onProgress?.(`ARP cache: ${arpEntries.length} devices`);

    let probed = [];
    if (!quickMode) {
      // Step 2: Scan subnet to populate ARP cache with devices not yet seen
      onProgress?.('Scanning subnet...');
      const aliveIps = await scanSubnet(baseIp, onProgress);
      onProgress?.(`Subnet scan: ${aliveIps.length} hosts responded`);

      // Re-read ARP after scan — new devices now appear
      const arpAfterScan = await readArpTable();
      probed = arpAfterScan;
    } else {
      probed = arpEntries;
    }

    if (probed.length === 0) {
      onProgress?.('No devices found');
      onComplete?.({ found: 0, posted: 0 });
      return;
    }

    // Step 3: Enrich with OUI lookup
    const enriched = probed.map(({ ip, mac }) => {
      const manufacturer = ouiLookup(mac);
      const isCameraLikely = CAMERA_BRANDS.has(manufacturer || '');
      return {
        ip,
        mac,
        manufacturer: manufacturer || null,
        is_camera_likely: isCameraLikely,
        open_ports: [],        // populated below for camera-likely devices
        source: 'android_arp',
      };
    });

    // Step 4: Quick HTTP port probe on camera-likely devices to confirm ports
    onProgress?.('Checking camera ports...');
    const cameraCandidates = enriched.filter(d => d.is_camera_likely);
    for (const device of cameraCandidates) {
      const ports = [];
      for (const port of [80, 8080, 554, 443]) {
        const up = await probeIp(`${device.ip}:${port}`).catch(() => false);
        if (up) ports.push(port);
      }
      device.open_ports = ports;
    }

    onProgress?.(`Posting ${enriched.length} devices to RSC cloud...`);

    // Step 5: POST to VPS presence endpoint
    const payload = {
      ips: enriched,
      ssid_name: net.ssid,
      subnet,
      source: 'android_phone',
      is_self: false,
    };

    const res = await api.post('/api/cameras/presence', payload);
    const { updated = 0, created = 0 } = res.data;

    onProgress?.(`Done — ${created} new, ${updated} updated`);
    onComplete?.({ found: enriched.length, posted: updated + created });

  } catch (err) {
    console.error('[discovery.android]', err);
    onProgress?.(`Discovery error: ${err.message}`);
    onComplete?.({ found: 0, posted: 0 });
  }
}

/** Start auto-scan interval. Returns a cleanup function. */
export function startAutoDiscovery({ onProgress, onComplete } = {}) {
  // Run immediately on start
  runDiscovery({ onProgress, onComplete, quickMode: true });

  // Then every 8 minutes — quick ARP-only scan to catch new devices
  const interval = setInterval(() => {
    runDiscovery({ onProgress, onComplete, quickMode: true });
  }, SCAN_INTERVAL_MS);

  return () => clearInterval(interval);
}
