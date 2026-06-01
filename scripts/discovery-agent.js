/**
 * Real Security Camera — Local Discovery Agent v2
 * ─────────────────────────────────────────────────
 * Scans your network, identifies cameras by MAC/port,
 * probes default credentials, and reports working streams
 * to the backend automatically.
 *
 * Install: npm install axios
 * Run:     node discovery-agent.js
 */

const os       = require('os');
const axios    = require('axios');
const { exec } = require('child_process');
const net      = require('net');

const API_URL       = 'https://whale-app-hxokg.ondigitalocean.app';
const SCAN_INTERVAL = 60000;

let ACCESS_TOKEN = process.env.RSC_TOKEN    || '';
let ORG_ID       = process.env.RSC_ORG_ID   || '';
const EMAIL      = process.env.RSC_EMAIL    || 'newtest@example.com';
const PASSWORD   = process.env.RSC_PASSWORD || 'TestPassword123!';

// ── MAC OUI → Brand mapping ───────────────────────────────────────
const OUI = {
  '00:03:93':'iOS','00:0A:95':'iOS','00:1C:B3':'iOS','00:21:E9':'iOS',
  '04:0C:CE':'iOS','04:26:65':'iOS','04:52:F3':'iOS','04:54:53':'iOS',
  '04:69:F8':'iOS','04:D3:CF':'iOS','08:66:98':'iOS','0C:3E:9F':'iOS',
  '10:41:7F':'iOS','10:93:E9':'iOS','14:5A:05':'iOS','18:AF:61':'iOS',
  '1C:AB:A7':'iOS','20:78:F0':'iOS','24:AB:81':'iOS','28:6A:B8':'iOS',
  '00:07:AB':'Android','00:12:47':'Android','00:15:99':'Android',
  '00:17:D5':'Android','00:1A:8A':'Android','00:1D:25':'Android',
  '04:18:0F':'Android','08:08:C2':'Android','0C:14:20':'Android',
  '10:D5:42':'Android','14:49:E0':'Android','18:3A:2D':'Android',
  'F4:F5:D8':'Android','3C:5A:B4':'Android','A4:77:33':'Android',
  '04:4E:AF':'Android','08:F4:AB':'Android',
  '00:9E:C8':'Android','08:7A:4C':'Android','10:2A:B3':'Android',
  // IP Camera brands
  'B8:3A:9D':'Zmodo','54:C4:15':'Zmodo',
  '00:12:17':'Hikvision','44:19:B6':'Hikvision','4C:BD:8F':'Hikvision',
  'BC:AD:28':'Hikvision','C0:56:E3':'Hikvision',
  '00:12:45':'Dahua','28:57:BE':'Dahua','34:E1:D0':'Dahua',
  'E0:50:8B':'Dahua','90:02:A9':'Dahua',
  'B4:A3:82':'Reolink','EC:71:DB':'Reolink','00:62:6E':'Reolink',
  '00:40:8C':'Axis','AC:CC:8E':'Axis','B8:A4:4F':'Axis',
  '9C:8E:CD':'Amcrest','00:0C:E5':'Amcrest',
  '50:C7:BF':'TP-Link','B0:4E:26':'TP-Link',
  'C4:D9:87':'Foscam','00:00:C0':'Foscam',
  '2C:AA:8E':'Wyze','D0:3F:27':'Wyze',
};

// ── Default credentials to try per brand ─────────────────────────
const DEFAULT_CREDS = {
  'Hikvision': [
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '12345' },
    { user: 'admin', pass: '' },
  ],
  'Dahua': [
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '' },
    { user: 'admin', pass: '123456' },
  ],
  'Reolink': [
    { user: 'admin', pass: '' },
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '12345' },
  ],
  'Zmodo': [
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '123456' },
    { user: 'admin', pass: '888888' },
    { user: 'admin', pass: '' },
  ],
  'Amcrest': [
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '' },
    { user: 'admin', pass: '12345' },
  ],
  'TP-Link': [
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '123456' },
    { user: 'admin', pass: '' },
  ],
  'Foscam': [
    { user: 'admin', pass: '' },
    { user: 'admin', pass: 'admin' },
    { user: 'foscam', pass: 'foscam' },
  ],
  'Wyze': [
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '12345' },
  ],
  'default': [
    { user: 'admin', pass: '' },
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '12345' },
    { user: 'admin', pass: '123456' },
    { user: 'admin', pass: '1234' },
    { user: 'root',  pass: '' },
    { user: 'root',  pass: 'root' },
    { user: 'root',  pass: 'admin' },
    { user: 'admin', pass: '888888' },
    { user: 'admin', pass: 'password' },
  ],
};

// ── RTSP URL templates per brand ─────────────────────────────────
const RTSP_TEMPLATES = {
  'Hikvision': (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/Streaming/Channels/101`,
  'Dahua':     (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/cam/realmonitor?channel=1&subtype=0`,
  'Reolink':   (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/h264Preview_01_main`,
  'Zmodo':     (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/live/main`,
  'Amcrest':   (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/cam/realmonitor?channel=1`,
  'TP-Link':   (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/stream1`,
  'Foscam':    (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/videoMain`,
  'Wyze':      (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/live`,
  'default':   (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/stream`,
};

const FALLBACK_PATHS = [
  '/stream', '/live/main', '/live/ch00_0', '/h264Preview_01_main',
  '/cam/realmonitor?channel=1', '/Streaming/Channels/101', '/videoMain',
  '/video1', '/live', '/stream1', '/av_stream/ch0',
];

function identifyByMAC(mac) {
  if (!mac || mac === '00:00:00:00:00:00') return null;
  return OUI[mac.substring(0, 8).toUpperCase()] || null;
}

function getLocalSubnets() {
  const subnets = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        subnets.push({ subnet: addr.address.split('.').slice(0,3).join('.'), myIP: addr.address });
      }
    }
  }
  return subnets;
}

function readARPTable() {
  return new Promise((resolve) => {
    exec('arp -a', (err, stdout) => {
      if (err) { resolve([]); return; }
      const entries = [];
      const isWin = process.platform === 'win32';
      for (const line of stdout.split('\n')) {
        if (isWin) {
          const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F-]+)\s+(dynamic|static)/i);
          if (m) {
            const ip = m[1], mac = m[2].replace(/-/g,':').toUpperCase();
            if (!ip.startsWith('224.') && ip !== '255.255.255.255') entries.push({ ip, mac });
          }
        } else {
          const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\) at ([\da-fA-F:]+)/);
          if (m) entries.push({ ip: m[1], mac: m[2].toUpperCase() });
        }
      }
      resolve(entries);
    });
  });
}

function pingSweep(subnet) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const pings = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${subnet}.${i}`;
      const cmd = isWin ? `ping -n 1 -w 200 ${ip}` : `ping -c 1 -W 1 ${ip}`;
      pings.push(new Promise(r => exec(cmd, () => r())));
    }
    const run = async () => {
      for (let i = 0; i < pings.length; i += 30) await Promise.all(pings.slice(i, i+30));
      resolve();
    };
    run();
  });
}

function checkPort(ip, port) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(800);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error',   () => { s.destroy(); resolve(false); });
    s.connect(port, ip);
  });
}

async function probeIPCamera(ip) {
  for (const port of [554, 80, 8080, 8554, 37777]) {
    if (await checkPort(ip, port)) return port;
  }
  return null;
}

// ── Test RTSP stream by connecting to port and checking response ──
function testRTSPStream(rtspUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL(rtspUrl);
      const socket = new net.Socket();
      socket.setTimeout(3000);
      socket.on('connect', () => {
        // Send RTSP OPTIONS request
        socket.write(
          `OPTIONS ${rtspUrl} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: RealSecurityCamera\r\n\r\n`
        );
      });
      socket.on('data', (data) => {
        const response = data.toString();
        socket.destroy();
        // RTSP/1.0 200 OK = success
        // RTSP/1.0 401 = auth required (camera exists but creds wrong)
        if (response.includes('RTSP/1.0 200') || response.includes('RTSP/1.0 401')) {
          resolve({ connected: true, auth401: response.includes('401') });
        } else {
          resolve({ connected: false });
        }
      });
      socket.on('timeout', () => { socket.destroy(); resolve({ connected: false }); });
      socket.on('error',   () => { socket.destroy(); resolve({ connected: false }); });
      socket.connect(parseInt(url.port) || 554, url.hostname);
    } catch (e) {
      resolve({ connected: false });
    }
  });
}

// ── Probe camera credentials ──────────────────────────────────────
async function probeCredentials(ip, mac, port) {
  const brand = identifyByMAC(mac) || 'default';
  const creds = DEFAULT_CREDS[brand] || DEFAULT_CREDS['default'];
  const template = RTSP_TEMPLATES[brand] || RTSP_TEMPLATES['default'];

  console.log(`  🔑 Probing ${brand} camera at ${ip} with ${creds.length} credential sets...`);

  for (const { user, pass } of creds) {
    const rtspUrl = template(ip, user, pass);
    const result = await testRTSPStream(rtspUrl);

    if (result.connected && !result.auth401) {
      console.log(`  ✅ Connected! User: ${user} Pass: ${pass || '(blank)'}`);
      return { success: true, user, pass, rtspUrl, brand };
    } else if (result.auth401) {
      // Camera responded but creds wrong — try next
      continue;
    }
  }

  // Try fallback paths with first credential set
  console.log(`  🔄 Trying fallback RTSP paths...`);
  const { user, pass } = creds[0];
  for (const path of FALLBACK_PATHS) {
    const rtspUrl = `rtsp://${user}:${pass}@${ip}:${port}${path}`;
    const result = await testRTSPStream(rtspUrl);
    if (result.connected && !result.auth401) {
      console.log(`  ✅ Connected via fallback path: ${path}`);
      return { success: true, user, pass, rtspUrl, brand };
    }
  }

  console.log(`  ⚠️  Could not authenticate — camera may need manual password reset`);
  // Still return the best-guess RTSP URL so user can enter password manually
  const bestGuess = template(ip, 'admin', 'YOUR_PASSWORD');
  return { success: false, brand, rtspUrl: bestGuess };
}

// ── Auth ──────────────────────────────────────────────────────────
async function authenticate() {
  try {
    const res = await axios.post(`${API_URL}/api/auth/login`, { email: EMAIL, password: PASSWORD });
    ACCESS_TOKEN = res.data.data.accessToken;
    ORG_ID = res.data.data.user.organization_id || res.data.data.user.org_id || '';
    console.log('✅ Authenticated | orgId: ' + ORG_ID);
    return true;
  } catch (e) {
    console.error('❌ Auth failed:', e.response?.data?.message || e.message);
    return false;
  }
}

// ── Report to backend ─────────────────────────────────────────────
async function reportDevices(devices) {
  if (!ORG_ID) { await authenticate(); }
  if (!ORG_ID || devices.length === 0) return;
  try {
    await axios.post(`${API_URL}/api/discovery/report`, {
      orgId: ORG_ID,
      devices,
      count: devices.length,
      agentIP: getLocalSubnets()[0]?.myIP || '',
    });
    console.log(`📡 Reported ${devices.length} device(s) to backend`);
  } catch (e) {
    console.error('❌ Report failed:', e.response?.data?.message || e.message);
  }
}

// ── Update device RTSP URL in backend ────────────────────────────
async function updateDeviceRTSP(deviceId, rtspUrl, brand) {
  if (!ACCESS_TOKEN || !deviceId) return;
  try {
    await axios.put(
      `${API_URL}/api/devices/${deviceId}`,
      { rtsp_url: rtspUrl, name: brand ? `${brand} Camera` : undefined },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    console.log(`  📝 Updated device ${deviceId} with RTSP URL`);
  } catch (e) {
    console.error('  ❌ Failed to update device:', e.response?.data?.message || e.message);
  }
}

// ── Main scan ─────────────────────────────────────────────────────
async function scanNetwork() {
  console.log('\n🔍 Starting network scan...');
  const subnets = getLocalSubnets();
  if (!subnets.length) { console.log('⚠️  No network interfaces'); return; }

  console.log(`📡 My IP: ${subnets[0].myIP} | Subnet: ${subnets[0].subnet}.0/24`);
  console.log('⏳ Pinging subnet (this takes ~30s)...');
  for (const { subnet } of subnets) await pingSweep(subnet);

  const arpEntries = await readARPTable();
  console.log(`📋 ARP table: ${arpEntries.length} entries`);

  const identified = [];

  for (const { ip, mac } of arpEntries) {
    const type = identifyByMAC(mac);

    if (type === 'iOS' || type === 'Android') {
      identified.push({ ip, mac, type, name: `${type} Phone (${ip})`, source: 'arp' });
      console.log(`  📱 ${type} phone: ${ip} (${mac})`);
    } else if (type && type !== 'iOS' && type !== 'Android') {
      // Known IP camera brand — probe credentials
      console.log(`  📹 ${type} camera detected: ${ip} (${mac})`);
      const port = await probeIPCamera(ip);
      if (port) {
        const probe = await probeCredentials(ip, mac, port);
        identified.push({
          ip, mac, type: 'IPCamera', brand: probe.brand,
          name: probe.success
            ? `${probe.brand} Camera (${ip})`
            : `${probe.brand} Camera (${ip}) — needs password`,
          source: 'arp', port,
          rtsp_url: probe.rtspUrl,
          rtsp_working: probe.success,
          rtsp_user: probe.success ? probe.user : null,
          rtsp_pass: probe.success ? probe.pass : null,
        });
      }
    } else {
      // Unknown MAC — check camera ports
      const port = await probeIPCamera(ip);
      if (port) {
        console.log(`  📹 Unknown device with camera port: ${ip}:${port}`);
        const probe = await probeCredentials(ip, mac, port);
        identified.push({
          ip, mac: mac||'unknown', type: 'IPCamera', brand: probe.brand,
          name: probe.success
            ? `Camera Device (${ip}:${port})`
            : `Camera Device (${ip}:${port}) — needs password`,
          source: 'port_scan', port,
          rtsp_url: probe.rtspUrl,
          rtsp_working: probe.success,
          rtsp_user: probe.success ? probe.user : null,
        });
      }
    }
  }

  console.log(`✅ Found ${identified.length} camera/phone device(s)`);

  // Report working RTSP cameras
  const working = identified.filter(d => d.rtsp_working);
  if (working.length > 0) {
    console.log(`\n🎥 ${working.length} camera(s) with verified RTSP streams:`);
    working.forEach(d => console.log(`  ✅ ${d.name} → ${d.rtsp_url}`));
  }

  const needsPassword = identified.filter(d => d.type === 'IPCamera' && !d.rtsp_working);
  if (needsPassword.length > 0) {
    console.log(`\n🔑 ${needsPassword.length} camera(s) need password reset:`);
    needsPassword.forEach(d => console.log(`  ⚠️  ${d.name}`));
    console.log('  → Hold the reset button on the camera for 10 seconds, then re-run this agent');
  }

  await reportDevices(identified);
}

// ── Start ─────────────────────────────────────────────────────────
async function start() {
  console.log('🔒 Real Security Camera — Local Discovery Agent v2');
  console.log('════════════════════════════════════════════════════');
  console.log('  Scans network + probes camera default credentials');
  console.log(`  Backend: ${API_URL}`);
  console.log(`  Scan interval: ${SCAN_INTERVAL/1000}s`);
  console.log('');

  if (!ACCESS_TOKEN) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const email    = await new Promise(r => rl.question('Email: ', r));
    const password = await new Promise(r => {
      process.stdout.write('Password: ');
      process.stdin.resume();
      process.stdin.setRawMode?.(true);
      let pass = '';
      process.stdin.on('data', function handler(ch) {
        ch = ch.toString();
        if (ch === '\n' || ch === '\r') {
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener('data', handler);
          process.stdout.write('\n');
          r(pass);
        } else if (ch === '\u0003') {
          process.exit();
        } else {
          pass += ch;
          process.stdout.write('*');
        }
      });
    });
    rl.close();
    const ok = await authenticate();
    if (!ok) process.exit(1);
    // Override with actual creds for re-auth
    EMAIL_OVERRIDE = email;
    PASSWORD_OVERRIDE = password;
  }

  await scanNetwork();
  setInterval(scanNetwork, SCAN_INTERVAL);
}

start().catch(console.error);
