/**
 * Real Security Camera — Local Discovery Agent
 * ─────────────────────────────────────────────
 * Runs on any device on your home network.
 * Scans for cameras/phones and reports to the backend.
 *
 * Install: npm install axios node-arp
 * Run:     node discovery-agent.js
 */

const os      = require('os');
const axios   = require('axios');
const { exec } = require('child_process');
const dns     = require('dns').promises;

// ─── Config ───────────────────────────────────────────────────────
const API_URL   = 'https://whale-app-hxokg.ondigitalocean.app';
const SCAN_INTERVAL = 60000; // scan every 60 seconds
let ACCESS_TOKEN = process.env.RSC_TOKEN || '';

// ─── MAC OUI Database ─────────────────────────────────────────────
const OUI = {
  // Apple (iOS)
  '00:03:93':'iOS','00:0A:95':'iOS','00:1C:B3':'iOS','00:21:E9':'iOS',
  '04:0C:CE':'iOS','04:26:65':'iOS','04:52:F3':'iOS','04:54:53':'iOS',
  '04:69:F8':'iOS','04:D3:CF':'iOS','08:66:98':'iOS','0C:3E:9F':'iOS',
  '10:41:7F':'iOS','10:93:E9':'iOS','14:5A:05':'iOS','18:AF:61':'iOS',
  '1C:AB:A7':'iOS','20:78:F0':'iOS','24:AB:81':'iOS','28:6A:B8':'iOS',
  // Samsung (Android)
  '00:07:AB':'Android','00:12:47':'Android','00:15:99':'Android',
  '00:17:D5':'Android','00:1A:8A':'Android','00:1D:25':'Android',
  '04:18:0F':'Android','08:08:C2':'Android','0C:14:20':'Android',
  '10:D5:42':'Android','14:49:E0':'Android','18:3A:2D':'Android',
  // Google Pixel (Android)
  'F4:F5:D8':'Android','3C:5A:B4':'Android','A4:77:33':'Android',
  // OnePlus (Android)
  '04:4E:AF':'Android','08:F4:AB':'Android',
  // Xiaomi (Android)
  '00:9E:C8':'Android','08:7A:4C':'Android','10:2A:B3':'Android',
  // Hikvision IP Camera
  '00:12:17':'IPCamera','44:19:B6':'IPCamera','4C:BD:8F':'IPCamera',
  'BC:AD:28':'IPCamera','C0:56:E3':'IPCamera','54:C4:15':'IPCamera',
  // Dahua IP Camera
  '00:12:45':'IPCamera','28:57:BE':'IPCamera','34:E1:D0':'IPCamera',
  'E0:50:8B':'IPCamera','90:02:A9':'IPCamera',
  // Reolink
  'B4:A3:82':'IPCamera','EC:71:DB':'IPCamera','00:62:6E':'IPCamera',
  // Axis
  '00:40:8C':'IPCamera','AC:CC:8E':'IPCamera','B8:A4:4F':'IPCamera',
  // Amcrest / Foscam
  '9C:8E:CD':'IPCamera','00:0C:E5':'IPCamera',
  // TP-Link cameras
  '50:C7:BF':'IPCamera','B0:4E:26':'IPCamera',
};

function identifyByMAC(mac) {
  if (!mac || mac === '00:00:00:00:00:00') return null;
  const prefix = mac.substring(0,8).toUpperCase();
  return OUI[prefix] || null;
}

// ─── Get local network interfaces ────────────────────────────────
function getLocalSubnets() {
  const subnets = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        subnets.push({
          subnet: parts.slice(0,3).join('.'),
          myIP: addr.address,
          interface: name,
        });
      }
    }
  }
  return subnets;
}

// ─── Read ARP table (Windows + Linux/Mac) ────────────────────────
function readARPTable() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'arp -a' : 'arp -a';

    exec(cmd, (err, stdout) => {
      if (err) { resolve([]); return; }
      const entries = [];

      if (isWin) {
        // Windows: "  10.0.0.1         00-50-56-c0-00-01     dynamic"
        const lines = stdout.split('\n');
        for (const line of lines) {
          const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F-]+)\s+(dynamic|static)/i);
          if (match) {
            const ip  = match[1];
            const mac = match[2].replace(/-/g, ':').toUpperCase();
            if (ip !== '255.255.255.255' && !ip.startsWith('224.')) {
              entries.push({ ip, mac });
            }
          }
        }
      } else {
        // Linux/Mac: "? (10.0.0.1) at 00:50:56:c0:00:01 [ether]"
        const lines = stdout.split('\n');
        for (const line of lines) {
          const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\) at ([\da-fA-F:]+)/);
          if (match) {
            entries.push({ ip: match[1], mac: match[2].toUpperCase() });
          }
        }
      }
      resolve(entries);
    });
  });
}

// ─── Ping sweep to populate ARP table ────────────────────────────
function pingSweep(subnet) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const pings = [];

    for (let i = 1; i <= 254; i++) {
      const ip = `${subnet}.${i}`;
      const cmd = isWin
        ? `ping -n 1 -w 200 ${ip}`
        : `ping -c 1 -W 1 ${ip}`;
      pings.push(new Promise(res => exec(cmd, () => res())));
    }

    // Run 30 pings at a time
    const runBatch = async () => {
      for (let i = 0; i < pings.length; i += 30) {
        await Promise.all(pings.slice(i, i + 30));
      }
      resolve();
    };
    runBatch();
  });
}

// ─── Check common camera ports ───────────────────────────────────
function checkPort(ip, port) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, ip);
  });
}

async function probeIPCamera(ip) {
  const cameraPorts = [554, 80, 8080, 8554, 37777];
  for (const port of cameraPorts) {
    if (await checkPort(ip, port)) {
      return port;
    }
  }
  return null;
}

// ─── Auth with backend ────────────────────────────────────────────
async function authenticate(email, password) {
  try {
    const res = await axios.post(`${API_URL}/api/auth/login`, { email, password });
    ACCESS_TOKEN = res.data.data.accessToken;
    console.log('✅ Authenticated with backend');
    return true;
  } catch(e) {
    console.error('❌ Auth failed:', e.response?.data?.message || e.message);
    return false;
  }
}

// ─── Report discovered devices to backend ────────────────────────
async function reportDevices(devices) {
  if (!ACCESS_TOKEN) { console.log('⚠️  No token — skipping report'); return; }
  if (devices.length === 0) { console.log('📡 No new devices to report'); return; }

  try {
    await axios.post(
      `${API_URL}/api/discovery/report`,
      { orgId: process.env.RSC_ORG_ID || `bb0f1376-6364-42db-ae88-5af3ca643d6e`, devices, count: devices.length },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    console.log(`📡 Reported ${devices.length} device(s) to backend`);
  } catch(e) {
    console.error('❌ Report failed:', e.response?.data?.message || e.message);
  }
}

// ─── Main scan loop ───────────────────────────────────────────────
async function scan() {
  console.log('\n🔍 Starting network scan...');
  const subnets = getLocalSubnets();

  if (subnets.length === 0) {
    console.log('⚠️  No network interfaces found');
    return;
  }

  console.log(`📡 My IP: ${subnets[0].myIP} | Subnet: ${subnets[0].subnet}.0/24`);

  // Step 1: Ping sweep to populate ARP cache
  console.log('⏳ Pinging subnet (this takes ~30s)...');
  for (const { subnet } of subnets) {
    await pingSweep(subnet);
  }

  // Step 2: Read ARP table
  const arpEntries = await readARPTable();
  console.log(`📋 ARP table: ${arpEntries.length} entries`);

  // Step 3: Identify devices
  const identified = [];
  for (const { ip, mac } of arpEntries) {
    const type = identifyByMAC(mac);

    if (type === 'iOS' || type === 'Android') {
      identified.push({ ip, mac, type, name: `${type} Phone (${ip})`, source: 'arp' });
      console.log(`  📱 ${type} phone: ${ip} (${mac})`);
    } else if (type === 'IPCamera') {
      identified.push({ ip, mac, type, name: `IP Camera (${ip})`, source: 'arp' });
      console.log(`  📹 IP Camera: ${ip} (${mac})`);
    } else {
      // Unknown device — check camera ports
      const port = await probeIPCamera(ip);
      if (port) {
        identified.push({
          ip, mac: mac||'unknown', type: 'IPCamera',
          name: `Camera Device (${ip}:${port})`,
          source: 'port_scan', port,
        });
        console.log(`  📹 Camera port found: ${ip}:${port}`);
      }
    }
  }

  console.log(`✅ Found ${identified.length} camera/phone device(s)`);
  await reportDevices(identified);
}

// ─── Setup & Start ────────────────────────────────────────────────
async function start() {
  console.log('🔒 Real Security Camera — Local Discovery Agent');
  console.log('═══════════════════════════════════════════════');
  console.log(`Backend: ${API_URL}`);
  console.log(`Scan interval: ${SCAN_INTERVAL/1000}s`);
  console.log('');

  // Prompt for credentials if no token
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

    const ok = await authenticate(email, password);
    if (!ok) process.exit(1);
  }

  // Initial scan
  await scan();

  // Repeat every SCAN_INTERVAL
  setInterval(scan, SCAN_INTERVAL);
}

start().catch(console.error);
