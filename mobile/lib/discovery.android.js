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

// ── OUI table (first 3 octets of MAC → manufacturer) ──────────────────────────
const OUI = {
  '08:ed:ed':'Dahua','14:a7:8b':'Dahua','3c:ef:8c':'Dahua','4c:11:bf':'Dahua',
  '00:23:63':'Hikvision','4c:bd:8f':'Hikvision','54:c4:15':'Hikvision','94:e1:ac':'Hikvision',
  'bc:ad:28':'Hikvision','00:40:8c':'Axis','ac:cc:8e':'Axis',
  'c8:d5:fe':'Reolink','ec:71:db':'Reolink','dc:44:27':'Reolink',
  'b0:c5:ca':'Wyze','2c:aa:8e':'Wyze','d0:3f:27':'Wyze',
  'b0:be:76':'Eufy','5c:aa:fd':'Eufy','c0:49:ef':'Eufy',
  '70:56:81':'Ring','fc:a6:67':'Ring','b0:09:da':'Ring',
  '1c:61:b4':'Arlo','6c:e8:c6':'Arlo',
  'f4:f2:6d':'Amcrest','e8:ad:a6':'Amcrest',
  '9c:8e:cd':'TP-Link Tapo','50:c7:bf':'TP-Link Tapo',
  '00:09:18':'Hanwha','e4:30:22':'Hanwha',
  'b8:3a:9d':'Alarm.com','68:f0:d0':'Alarm.com','00:18:b9':'Alarm.com',
  '9c:f4:8d':'Apple','ac:bc:32':'Apple','bc:f1:71':'Apple','68:5b:35':'Apple',
  'f8:4d:89':'Apple','a8:51:5b':'Apple','70:ec:e4':'Apple',
  '8c:f5:a3':'Samsung','a4:23:05':'Samsung','c0:bd:d1':'Samsung',
  '3c:28:6d':'Google','54:60:09':'Google','f4:f5:d8':'Google',
  'f0:27:2d':'Amazon','74:c2:46':'Amazon',
  'b8:27:eb':'Raspberry Pi','dc:a6:32':'Raspberry Pi',
};

const CAMERA_BRANDS = new Set([
  'Hikvision','Dahua','Reolink','Wyze','Amcrest','Foscam','TP-Link Tapo','Arlo','Ring',
  'Axis','Hanwha','Eufy','Alarm.com','SkyBell','Vivotek','Mobotix','Bosch','Pelco',
  'Uniview','Tiandy','Avigilon','Zmodo','Swann','Lorex','Annke','Zosi','Ezviz',
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
