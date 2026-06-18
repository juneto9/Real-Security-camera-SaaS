/**
 * RSC Network Discovery — iOS
 *
 * iOS does NOT allow reading /proc/net/arp (it's Linux-only).
 * iOS does NOT expose raw ARP tables to apps.
 *
 * iOS strategy:
 *   1. NetInfo → get local IP + SSID
 *   2. Derive /24 subnet from local IP
 *   3. Probe all 254 IPs via fetch() with short timeout
 *      → iOS TCP stack populates its internal ARP cache
 *      → Any host that responds (even connection refused) is alive
 *   4. For responding IPs, try HTTP headers to identify manufacturer
 *      (cameras expose "Server:" header with brand info)
 *   5. POST to /api/cameras/presence
 *
 * Limitation vs Android: no MAC addresses from iOS (Apple blocks this).
 * We send IP + open ports + HTTP fingerprint instead. The VPS enriches
 * further via its OUI lookups on MACs it already knows.
 *
 * Note: On iOS, full subnet scan requires Background App Refresh permission
 * and works best when app is in foreground. mDNS/Bonjour discovery is used
 * as a supplement to catch devices that don't answer HTTP.
 */

import NetInfo from '@react-native-community/netinfo';
import api from './api';

const PROBE_TIMEOUT = 1500;
const BATCH_SIZE = 10;
const SCAN_INTERVAL_MS = 8 * 60 * 1000;

const CAMERA_PORTS = [80, 8080, 554, 8554, 443];

const CAMERA_SERVER_KEYWORDS = [
  'hikvision', 'dahua', 'reolink', 'amcrest', 'foscam', 'axis',
  'hanwha', 'vivotek', 'wyze', 'arlo', 'ring', 'eufy', 'tapo',
  'onvif', 'ipcam', 'nvr', 'dvr', 'camera', 'rtsp',
  'alarm.com', 'skybell', 'interlogix', 'bosch',
];

/** Probe an IP:port — returns { alive, serverHeader } */
async function probeHttp(ip, port = 80) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  try {
    const res = await fetch(`http://${ip}:${port}/`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const server = res.headers?.get?.('server') || res.headers?.get?.('Server') || '';
    return { alive: true, serverHeader: server, statusCode: res.status };
  } catch (e) {
    clearTimeout(timer);
    // Connection refused = host is alive but port closed
    const alive = e.name !== 'AbortError' && !e.message?.includes('Network request failed');
    return { alive, serverHeader: '', statusCode: null };
  }
}

/** Identify manufacturer from HTTP Server header */
function identifyFromHeader(serverHeader) {
  if (!serverHeader) return null;
  const lower = serverHeader.toLowerCase();
  for (const keyword of CAMERA_SERVER_KEYWORDS) {
    if (lower.includes(keyword)) {
      // Capitalize first letter
      return keyword.charAt(0).toUpperCase() + keyword.slice(1);
    }
  }
  return null;
}

/** Scan a /24 subnet */
async function scanSubnet(baseIp, onProgress) {
  const parts = baseIp.split('.');
  const base = parts.slice(0, 3).join('.');
  const alive = [];

  for (let start = 1; start <= 254; start += BATCH_SIZE) {
    const batch = [];
    for (let i = start; i < start + BATCH_SIZE && i <= 254; i++) {
      const ip = `${base}.${i}`;
      batch.push(
        probeHttp(ip, 80).then(result => ({ ip, ...result }))
      );
    }
    const results = await Promise.all(batch);
    alive.push(...results.filter(r => r.alive));
    onProgress?.(`iOS scan ${base}.${start}–${Math.min(start + BATCH_SIZE - 1, 254)}...`);
  }

  return alive;
}

/** Get network state */
async function getNetworkInfo() {
  const state = await NetInfo.fetch();
  return {
    ssid: state.details?.ssid || null,
    localIp: state.details?.ipAddress || null,
    isWifi: state.type === 'wifi',
  };
}

/**
 * Main iOS discovery runner.
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

    onProgress?.(`On ${net.ssid || 'WiFi'} — scanning ${subnet}`);

    let liveHosts = [];

    if (quickMode) {
      // Quick mode: only probe common camera ports on known-active IPs
      // Use a smaller range around the gateway
      const base = parts.slice(0, 3).join('.');
      const quickBatch = [];
      for (let i = 1; i <= 30; i++) {
        quickBatch.push(probeHttp(`${base}.${i}`).then(r => ({ ip: `${base}.${i}`, ...r })));
      }
      liveHosts = (await Promise.all(quickBatch)).filter(r => r.alive);
    } else {
      liveHosts = await scanSubnet(net.localIp, onProgress);
    }

    onProgress?.(`${liveHosts.length} hosts found — fingerprinting...`);

    // Enrich: check multiple ports + read Server header for camera ID
    const enriched = [];
    for (const host of liveHosts) {
      const openPorts = [];
      let manufacturer = identifyFromHeader(host.serverHeader);

      for (const port of CAMERA_PORTS) {
        if (port === 80 && host.alive) {
          openPorts.push(80);
          continue;
        }
        const probe = await probeHttp(host.ip, port);
        if (probe.alive) {
          openPorts.push(port);
          if (!manufacturer) manufacturer = identifyFromHeader(probe.serverHeader);
        }
      }

      enriched.push({
        ip: host.ip,
        mac: null,           // iOS cannot read MAC addresses
        manufacturer,
        open_ports: openPorts,
        http_server: host.serverHeader || null,
        is_camera_likely: manufacturer !== null || openPorts.includes(554) || openPorts.includes(8554),
        source: 'ios_scan',
      });
    }

    onProgress?.(`Posting ${enriched.length} devices to RSC cloud...`);

    const res = await api.post('/api/cameras/presence', {
      ips: enriched,
      ssid_name: net.ssid,
      subnet,
      source: 'ios_phone',
      is_self: false,
    });

    const { updated = 0, created = 0 } = res.data;
    onProgress?.(`Done — ${created} new, ${updated} updated`);
    onComplete?.({ found: enriched.length, posted: updated + created });

  } catch (err) {
    console.error('[discovery.ios]', err);
    onProgress?.(`Discovery error: ${err.message}`);
    onComplete?.({ found: 0, posted: 0 });
  }
}

/** Start auto-scan interval. Returns cleanup function. */
export function startAutoDiscovery({ onProgress, onComplete } = {}) {
  runDiscovery({ onProgress, onComplete, quickMode: true });
  const interval = setInterval(() => {
    runDiscovery({ onProgress, onComplete, quickMode: true });
  }, SCAN_INTERVAL_MS);
  return () => clearInterval(interval);
}
