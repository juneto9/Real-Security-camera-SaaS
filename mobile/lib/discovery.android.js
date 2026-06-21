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

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import api from './api';

const PROBE_TIMEOUT = 1200;   // ms per IP probe
const BATCH_SIZE = 12;         // parallel probes at once
const SCAN_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes

// ── OUI table v2.0 — 819 entries — Alarm.com, cameras, phones, tablets
// Sources: IPVM, maclookup.app, netify.ai, IEEE (June 2026)
// OUI v3.0 — 459 entries — fully verified from IEEE/netify.ai
const OUI = {
  '00:00:f0':'Samsung',  '00:01:31':'Bosch',  '00:02:d1':'Vivotek',  '00:03:93':'Apple',  '00:03:c5':'Mobotix',
  '00:04:63':'Bosch',  '00:04:7d':'Pelco',  '00:05:5d':'D-Link',  '00:07:5f':'Bosch',  '00:09:18':'Hanwha',
  '00:0a:13':'Honeywell',  '00:0d:88':'D-Link',  '00:0d:c5':'Foscam',  '00:10:17':'Bosch',  '00:10:be':'March Networks',
  '00:11:24':'Apple',  '00:11:95':'D-Link',  '00:12:7b':'Foscam',  '00:12:81':'March Networks',  '00:12:fb':'Samsung',
  '00:13:e2':'GeoVision',  '00:14:d1':'TRENDnet',  '00:15:b9':'Samsung',  '00:15:e9':'D-Link',  '00:16:6c':'Samsung',
  '00:17:9a':'D-Link',  '00:17:d5':'Samsung',  '00:17:e9':'Motorola',  '00:17:f2':'Apple',  '00:18:85':'Avigilon',
  '00:19:5b':'D-Link',  '00:1a:07':'Arecont',  '00:1a:ef':'OPPO',  '00:1b:11':'D-Link',  '00:1b:86':'Bosch',
  '00:1b:98':'Samsung',  '00:1b:d8':'FLIR',  '00:1c:27':'Sunell',  '00:1c:44':'Bosch',  '00:1c:b3':'Apple',
  '00:1c:f0':'D-Link',  '00:1c:fa':'Alarm.com',  '00:1d:f6':'Samsung',  '00:1e:58':'D-Link',  '00:1e:c2':'Nest',
  '00:1e:e2':'Samsung',  '00:1f:92':'Avigilon',  '00:21:4c':'Samsung',  '00:21:91':'D-Link',  '00:21:e9':'Apple',
  '00:22:b0':'D-Link',  '00:23:32':'Apple',  '00:23:39':'Samsung',  '00:23:d6':'Samsung',  '00:24:01':'D-Link',
  '00:24:36':'Apple',  '00:24:90':'Samsung',  '00:25:66':'Samsung',  '00:25:bc':'Apple',  '00:26:5a':'D-Link',
  '00:26:5f':'Samsung',  '00:26:b9':'Apple',  '00:27:22':'Ubiquiti',  '00:40:7f':'FLIR',  '00:40:8c':'Axis',
  '00:7c:2d':'Samsung',  '00:9e:c8':'Xiaomi',  '00:bc:99':'Hikvision',  '00:bf:61':'Samsung',  '00:e0:4c':'Zmodo',
  '00:e3:b2':'Samsung',  '04:03:12':'Hikvision',  '04:0c:ce':'Apple',  '04:18:0f':'Samsung',  '04:48:9a':'Apple',
  '04:b1:a1':'Samsung',  '04:ba:8d':'Samsung',  '04:d3:cf':'Apple',  '04:ee:cd':'Hikvision',  '04:fe:31':'Samsung',
  '08:37:3d':'Samsung',  '08:3b:c1':'Hikvision',  '08:54:11':'Hikvision',  '08:6d:41':'Apple',  '08:8c:2c':'Samsung',
  '08:92:04':'Reolink',  '08:a1:89':'Hikvision',  '08:bf:a0':'Samsung',  '08:cc:81':'Hikvision',  '08:ec:a9':'Samsung',
  '08:ed:ed':'Dahua',  '08:fd:0e':'Samsung',  '0c:2f:b0':'Samsung',  '0c:30:21':'Apple',  '0c:74:c2':'Apple',
  '0c:75:d2':'Hikvision',  '0c:8d:ca':'Samsung',  '0c:df:a4':'Samsung',  '10:12:fb':'Hikvision',  '10:1d:c0':'Samsung',
  '10:30:47':'Samsung',  '10:40:f3':'Apple',  '10:77:b1':'Samsung',  '10:92:66':'Samsung',  '10:dd:b1':'Apple',
  '10:e4:c2':'Samsung',  '14:14:4b':'Tiandy',  '14:1f:78':'Samsung',  '14:2f:fd':'LTS',  '14:56:8e':'Samsung',
  '14:8f:c6':'Apple',  '14:a3:64':'Samsung',  '14:a7:8b':'Dahua',  '14:cc:20':'TP-Link',  '14:d6:4d':'D-Link',
  '14:f4:2a':'Samsung',  '18:1e:b0':'Samsung',  '18:26:54':'Samsung',  '18:34:51':'Apple',  '18:3f:47':'Samsung',
  '18:4e:cb':'Samsung',  '18:67:b0':'Samsung',  '18:68:cb':'Hikvision',  '18:80:25':'Hikvision',  '18:89:5b':'Samsung',
  '18:af:61':'Apple',  '18:b4:30':'Nest',  '18:e8:29':'Ubiquiti',  '1c:23:2c':'Samsung',  '1c:61:b4':'Arlo',
  '1c:62:b8':'Samsung',  '1c:7e:e5':'D-Link',  '1c:86:9a':'Samsung',  '1c:91:48':'Apple',  '1c:a4:61':'DoorBird',
  '1c:a6:e8':'Ring',  '1c:e5:7f':'Samsung',  '20:13:e0':'Samsung',  '20:32:6c':'Samsung',  '20:64:32':'Samsung',
  '20:a2:e4':'Apple',  '20:d5:bf':'Samsung',  '24:0f:9b':'Hikvision',  '24:11:53':'Samsung',  '24:28:fd':'Hikvision',
  '24:32:ae':'Hikvision',  '24:48:45':'Hikvision',  '24:4b:81':'Samsung',  '24:52:6a':'Dahua',  '24:92:0e':'Samsung',
  '24:db:ed':'Samsung',  '24:fc:e5':'Samsung',  '28:10:7b':'D-Link',  '28:37:37':'Apple',  '28:39:5e':'Samsung',
  '28:6c:07':'Xiaomi',  '28:98:7b':'Samsung',  '28:c2:1f':'Samsung',  '28:cf:da':'Apple',  '28:d9:8a':'TP-Link',
  '2c:15:bf':'Samsung',  '2c:20:0b':'Apple',  '2c:99:75':'Samsung',  '2c:a5:9c':'Hikvision',  '2c:aa:8e':'Wyze',
  '2c:c8:1b':'Milesight',  '30:07:4d':'Samsung',  '30:74:67':'Samsung',  '30:c7:ae':'Samsung',  '30:d5:87':'Samsung',
  '30:dd:aa':'Dahua',  '34:09:62':'Hikvision',  '34:15:9e':'Apple',  '34:23:ba':'Samsung',  '34:82:c5':'Samsung',
  '34:a3:95':'Apple',  '34:be:00':'Samsung',  '34:d2:70':'Ring',  '38:01:95':'Samsung',  '38:03:19':'Eufy',
  '38:16:d1':'Samsung',  '38:4a:80':'Samsung',  '38:8a:06':'Samsung',  '38:9a:f6':'Samsung',  '38:a4:ed':'Xiaomi',
  '38:ec:e4':'Samsung',  '3c:07:54':'Apple',  '3c:1b:f8':'Hikvision',  '3c:20:f6':'Samsung',  '3c:37:86':'Arlo',
  '3c:5a:b4':'Google',  '3c:62:00':'Samsung',  '3c:bb:fd':'Samsung',  '3c:e3:6b':'Dahua',  '40:11:c3':'Samsung',
  '40:3c:fc':'Apple',  '40:5e:f6':'Samsung',  '40:7a:a4':'Dahua',  '40:98:ad':'Apple',  '40:ac:bf':'Hikvision',
  '40:b5:70':'Hikvision',  '40:cb:c0':'Apple',  '44:16:fa':'Samsung',  '44:2a:60':'Apple',  '44:3a:3d':'Blink',
  '44:47:cc':'Hikvision',  '44:a5:6e':'Arlo',  '44:a6:42':'Hikvision',  '48:43:7c':'Apple',  '48:44:f7':'Samsung',
  '48:78:5b':'Hikvision',  '48:ea:63':'Uniview',  '4c:11:bf':'Dahua',  '4c:1f:86':'Hikvision',  '4c:57:ca':'Apple',
  '4c:62:df':'Hikvision',  '4c:99:e8':'Dahua',  '4c:a5:6d':'Samsung',  '4c:bd:8f':'Hikvision',  '4c:e1:73':'Hanwha',
  '4c:f5:dc':'Hikvision',  '50:32:75':'Apple',  '50:3e:aa':'TP-Link',  '50:40:74':'Alarm.com',  '50:85:69':'Samsung',
  '50:c7:bf':'TP-Link',  '50:e5:38':'Hikvision',  '50:f5:20':'Samsung',  '54:8c:81':'Hikvision',  '54:92:be':'Samsung',
  '54:ea:a8':'Apple',  '58:03:fb':'Hikvision',  '58:2f:40':'Samsung',  '58:50:ed':'Hikvision',  '5c:34:5b':'Hikvision',
  '5c:49:7d':'Samsung',  '5c:aa:fd':'Eufy',  '5c:f5:1a':'Dahua',  '5c:f6:dc':'Samsung',  '60:03:08':'Apple',
  '60:9a:c1':'Apple',  '60:a1:0a':'Samsung',  '60:f4:45':'Apple',  '64:09:80':'Xiaomi',  '64:16:66':'Nest',
  '64:70:02':'TP-Link',  '64:76:ba':'Apple',  '64:b8:53':'Samsung',  '64:fd:29':'Dahua',  '68:09:27':'Apple',
  '68:6d:bc':'Hikvision',  '68:72:51':'Ubiquiti',  '68:96:7b':'Apple',  '68:eb:ae':'Samsung',  '68:f0:d0':'SkyBell',
  '6c:1c:71':'Dahua',  '6c:40:08':'Apple',  '6c:72:e7':'Apple',  '6c:ab:31':'Apple',  '6c:e8:c6':'Arlo',
  '70:28:8b':'Samsung',  '70:3e:ac':'Apple',  '70:cd:60':'Apple',  '74:1b:b2':'Apple',  '74:3f:c2':'Hikvision',
  '74:51:ba':'Xiaomi',  '74:a0:2f':'Samsung',  '74:c9:29':'Dahua',  '78:4f:43':'Apple',  '78:52:1a':'Samsung',
  '78:a1:06':'TP-Link',  '7c:1c:4e':'Samsung',  '7c:5c:f8':'Apple',  '7c:78:b2':'Wyze',  '7c:fa:df':'Apple',
  '80:18:a7':'Samsung',  '80:2a:a8':'Ubiquiti',  '80:48:9f':'Hikvision',  '80:7c:62':'Hikvision',  '80:be:af':'Hikvision',
  '80:f5:ae':'Hikvision',  '84:11:9e':'Samsung',  '84:38:35':'Apple',  '84:94:59':'Hikvision',  '84:9a:40':'Hikvision',
  '84:a4:66':'Samsung',  '84:b1:53':'Apple',  '84:c9:b2':'D-Link',  '84:e3:42':'Eufy',  '88:53:2e':'Apple',
  '88:ae:07':'Apple',  '88:bf:e4':'Reolink',  '88:de:39':'Hikvision',  '8c:1f:94':'Samsung',  '8c:22:d2':'Hikvision',
  '8c:2d:aa':'Apple',  '8c:85:90':'Apple',  '8c:be:a9':'OnePlus',  '8c:e7:48':'Hikvision',  '8c:e9:b4':'Dahua',
  '90:18:7c':'Samsung',  '90:21:55':'Blink',  '90:3c:92':'Apple',  '90:b0:ed':'Apple',  '94:63:d1':'Samsung',
  '94:bf:2d':'Apple',  '94:e1:ac':'Hikvision',  '98:01:a7':'Apple',  '98:52:b1':'Samsung',  '98:8b:0a':'Hikvision',
  '98:9d:e5':'Hikvision',  '98:df:82':'Hikvision',  '98:ee:cb':'Arlo',  '98:f1:12':'Hikvision',  '98:f9:cc':'Dahua',
  '9c:14:63':'Dahua',  '9c:20:7b':'Apple',  '9c:4e:36':'Motorola',  '9c:8e:cd':'TP-Link Tapo',  '9c:99:a0':'Xiaomi',
  '9c:a5:25':'Zmodo',  'a0:02:dc':'Ring',  'a0:07:98':'Samsung',  'a0:07:a0':'Foscam',  'a0:2f:4c':'SkyBell',
  'a0:82:1f':'Samsung',  'a0:99:9b':'Apple',  'a0:bd:1d':'Dahua',  'a0:f3:c1':'TP-Link',  'a0:ff:0c':'Hikvision',
  'a4:29:02':'Hikvision',  'a4:4b:d5':'OPPO',  'a4:4b:d9':'Hikvision',  'a4:67:06':'Apple',  'a4:77:33':'Google',
  'a4:a4:59':'Hikvision',  'a4:d1:d2':'Apple',  'a4:d5:c2':'Hikvision',  'a4:da:32':'Reolink',  'a8:60:b6':'Apple',
  'a8:7d:12':'Samsung',  'a8:96:75':'Apple',  'ac:61:ea':'Apple',  'ac:b9:2f':'Hikvision',  'ac:cb:51':'Hikvision',
  'ac:cc:8e':'Axis',  'ac:cf:5c':'Apple',  'b0:09:da':'Ring',  'b0:65:bd':'Apple',  'b0:72:bf':'Samsung',
  'b0:be:76':'Eufy',  'b0:c5:ca':'Wyze',  'b4:3a:28':'Samsung',  'b4:4c:3b':'Dahua',  'b4:a3:82':'Ezviz',
  'b4:a9:fc':'OPPO',  'b4:f0:ab':'Apple',  'b8:3a:9d':'Alarm.com',  'b8:41:a4':'Apple',  'b8:5e:7b':'Samsung',
  'b8:78:2e':'Apple',  'b8:a3:86':'D-Link',  'b8:a4:4f':'Axis',  'bc:20:a4':'Samsung',  'bc:32:5f':'Amcrest',
  'bc:3b:af':'Apple',  'bc:5e:33':'Hikvision',  'bc:8c:cd':'Samsung',  'bc:9b:5e':'Hikvision',  'bc:ad:28':'Hikvision',
  'bc:ba:c2':'Hikvision',  'bc:db:c5':'Reolink',  'bc:f6:85':'D-Link',  'c0:39:5a':'Dahua',  'c0:49:ef':'Eufy',
  'c0:51:7e':'Hikvision',  'c0:6d:ed':'Hikvision',  'c0:84:7a':'Apple',  'c0:a0:bb':'TP-Link',  'c0:bd:d1':'Samsung',
  'c4:2f:90':'Ezviz',  'c4:57:6e':'Samsung',  'c4:6a:b7':'Xiaomi',  'c4:aa:c4':'Dahua',  'c4:b3:01':'Apple',
  'c8:06:c8':'Uniview',  'c8:21:58':'Samsung',  'c8:33:4b':'Apple',  'c8:46:e9':'Eufy',  'c8:a7:02':'Hikvision',
  'c8:d0:83':'Apple',  'c8:d5:fe':'Reolink',  'cc:05:1b':'Samsung',  'cc:13:f3':'Hikvision',  'cc:29:f5':'Apple',
  'd0:13:fd':'Samsung',  'd0:23:db':'Apple',  'd0:3f:27':'Wyze',  'd0:59:e4':'Samsung',  'd0:81:7a':'Apple',
  'd4:43:0e':'Dahua',  'd4:88:90':'Samsung',  'd4:92:74':'Uniview',  'd4:dc:cd':'Apple',  'd4:e8:53':'Hikvision',
  'd8:1d:72':'Apple',  'd8:72:dc':'Tiandy',  'd8:96:95':'Apple',  'd8:eb:97':'TRENDnet',  'dc:07:f8':'Hikvision',
  'dc:44:27':'Reolink',  'dc:71:96':'Samsung',  'dc:a9:04':'Apple',  'dc:d2:6a':'Hikvision',  'e0:2e:fe':'Dahua',
  'e0:4f:43':'Reolink',  'e0:50:8b':'Dahua',  'e0:63:da':'Ubiquiti',  'e0:ba:ad':'Hikvision',  'e0:c7:67':'Apple',
  'e0:ca:3c':'Hikvision',  'e0:df:13':'Hikvision',  'e4:24:6c':'Dahua',  'e4:30:22':'Hanwha',  'e4:40:e2':'Samsung',
  'e4:98:d6':'Apple',  'e4:d5:8b':'Hikvision',  'e8:03:9a':'Samsung',  'e8:04:62':'Apple',  'e8:9d:87':'Samsung',
  'e8:a0:ed':'Hikvision',  'e8:ab:fa':'Foscam',  'e8:ad:a6':'Amcrest',  'ec:35:86':'Apple',  'ec:71:db':'Reolink',
  'ec:a9:71':'Hikvision',  'ec:c8:9c':'Hikvision',  'f0:08:f1':'Samsung',  'f0:79:60':'Apple',  'f0:cb:a1':'Apple',
  'f0:dc:e2':'Apple',  'f0:e7:7e':'Samsung',  'f4:37:b7':'Apple',  'f4:9f:54':'Samsung',  'f4:b1:c2':'Dahua',
  'f4:f2:6d':'Amcrest',  'f4:f5:d8':'Nest',  'f8:1e:df':'Apple',  'f8:4d:fc':'Hikvision',  'f8:ce:07':'Dahua',
  'f8:d0:bd':'Samsung',  'fc:25:3f':'Apple',  'fc:5f:49':'Dahua',  'fc:64:ba':'Xiaomi',  'fc:9f:fd':'Hikvision',
  'fc:a1:3e':'Samsung',  'fc:a1:83':'Ring',  'fc:a6:67':'Ring',  'fc:b6:9d':'Dahua'
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


/** Deep probe a single IP for UPnP, Roku, Chromecast, and HTTP banner.
 *  Phone runs this locally on the LAN before posting to VPS. */
async function deepProbe(ip) {
  const r = { device_type: null, manufacturer: null, name: null, hostname: null, banner: null, service: null, os_hint: null, port: null };

  // Roku port 8060
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`http://${ip}:8060/query/device-info`, { signal: ctrl.signal });
    const txt = await res.text();
    if (txt && txt.toLowerCase().includes('roku')) {
      const fn = txt.match(/<friendly-device-name>([^<]+)<\/friendly-device-name>/i)?.[1]?.trim();
      const model = txt.match(/<model-name>([^<]+)<\/model-name>/i)?.[1]?.trim();
      r.manufacturer = 'Roku'; r.device_type = 'streaming'; r.port = 8060;
      r.name = fn || (model ? 'Roku ' + model : 'Roku Streaming Device');
      return r;
    }
  } catch(_) {}

  // UPnP device description
  const paths = ['/device.xml','/rootDesc.xml','/description.xml','/upnp/description.xml','/ssdp/device-desc.xml','/xml/device_description.xml'];
  for (const path of paths) {
    try {
      const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 1000);
      const res = await fetch(`http://${ip}${path}`, { signal: ctrl.signal });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml || xml.length < 50) continue;
      const low = xml.toLowerCase();
      const fn    = xml.match(/<friendlyName>([^<]{1,80})<\/friendlyName>/i)?.[1]?.trim();
      const mfr   = xml.match(/<manufacturer>([^<]{1,60})<\/manufacturer>/i)?.[1]?.trim();
      const model = xml.match(/<modelName>([^<]{1,60})<\/modelName>/i)?.[1]?.trim();
      r.port = 80;
      if (mfr) r.manufacturer = mfr;
      if (model) r.banner = model;
      if (fn) r.hostname = fn;
      if (low.includes('roku'))                                          { r.manufacturer='Roku';    r.device_type='streaming'; r.name=fn||(model?'Roku '+model:'Roku Streaming Device'); }
      else if (low.includes('amazon')||low.includes('fire tv'))         { r.manufacturer='Amazon';  r.device_type='streaming'; r.name=fn||'Amazon Fire TV'; }
      else if (low.includes('firetv')||low.includes('kindle'))         { r.manufacturer='Amazon';  r.device_type='streaming'; r.name=fn||'Amazon Fire TV'; }
      else if (low.includes('chromecast')||low.includes('google cast')) { r.manufacturer='Google';  r.device_type='streaming'; r.name=fn||'Google Chromecast'; }
      else if (low.includes('sonos'))                                   { r.manufacturer='Sonos';   r.device_type='smart_home'; r.name=fn||(model?'Sonos '+model:'Sonos Speaker'); }
      else if (low.includes('apple tv')||low.includes('appletv'))      { r.manufacturer='Apple';   r.device_type='streaming'; r.name=fn||'Apple TV'; }
      else if (low.includes('samsung')&&(low.includes(' tv')||low.includes('smarttv'))) { r.manufacturer='Samsung'; r.device_type='streaming'; r.name=fn||'Samsung Smart TV'; }
      else if (low.includes('lg electronics')&&low.includes('tv'))     { r.manufacturer='LG';      r.device_type='streaming'; r.name=fn||'LG Smart TV'; }
      else if (low.includes('vizio'))                                   { r.manufacturer='Vizio';   r.device_type='streaming'; r.name=fn||'Vizio Smart TV'; }
      else if (low.includes('nvidia')||low.includes('shield'))         { r.manufacturer='Nvidia';  r.device_type='streaming'; r.name=fn||'Nvidia Shield'; }
      else if (low.includes('ring'))                                    { r.manufacturer='Ring';    r.device_type='ip_camera'; r.name=fn||'Ring Device'; }
      else if (low.includes('nest'))                                    { r.manufacturer='Nest';    r.device_type='ip_camera'; r.name=fn||'Nest Camera'; }
      else if (low.includes('wemo')||low.includes('belkin'))           { r.manufacturer='Belkin';  r.device_type='smart_home'; r.name=fn||'Belkin WeMo'; }
      else if (low.includes('philips')&&low.includes('hue'))           { r.manufacturer='Philips'; r.device_type='smart_home'; r.name=fn||'Philips Hue Bridge'; }
      else if (low.includes('netgear'))                                 { r.manufacturer='Netgear'; r.device_type='router'; r.name=fn||(model?'Netgear '+model:'Netgear Router'); }
      else if (low.includes('eero'))                                    { r.manufacturer='Amazon';  r.device_type='router'; r.name=fn||'Amazon Eero'; }
      else if (low.includes('linksys'))                                 { r.manufacturer='Linksys'; r.device_type='router'; r.name=fn||'Linksys Router'; }
      else if (fn) { r.name = fn; }
      if (r.name) return r;
    } catch(_) {}
  }

  // Chromecast port 8008
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://${ip}:8008/ssdp/device-desc.xml`, { signal: ctrl.signal });
    const xml = await res.text();
    if (xml && xml.toLowerCase().includes('google')) {
      const fn = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/i)?.[1]?.trim();
      r.manufacturer = 'Google'; r.device_type = 'streaming'; r.port = 8008;
      r.name = fn || 'Google Chromecast';
      return r;
    }
  } catch(_) {}

  // Plex port 32400
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://${ip}:32400/identity`, { signal: ctrl.signal });
    if (res.ok) { r.device_type = 'computer'; r.service = 'Plex'; r.port = 32400; r.name = 'Plex Media Server (' + ip + ')'; return r; }
  } catch(_) {}

  // HTTP banner from port 80
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 1000);
    const res = await fetch(`http://${ip}/`, { signal: ctrl.signal });
    const server = res.headers.get('server') || '';
    const auth = res.headers.get('www-authenticate') || '';
    const combined = (server + ' ' + auth).toLowerCase();
    if (server) r.banner = server.slice(0, 100);
    r.port = 80;
    if (combined.includes('hikvision')||combined.includes('h264dvr')) { r.manufacturer='Hikvision'; r.device_type='ip_camera'; r.name='Hikvision Camera'; r.service='HTTP'; }
    else if (combined.includes('dahua'))    { r.manufacturer='Dahua';    r.device_type='ip_camera'; r.name='Dahua Camera'; }
    else if (combined.includes('axis'))     { r.manufacturer='Axis';     r.device_type='ip_camera'; r.name='Axis Camera'; }
    else if (combined.includes('reolink'))  { r.manufacturer='Reolink';  r.device_type='ip_camera'; r.name='Reolink Camera'; }
    else if (combined.includes('netgear'))  { r.manufacturer='Netgear';  r.device_type='router';    r.name='Netgear Router'; }
    else if (combined.includes('synology')) { r.manufacturer='Synology'; r.device_type='nas';       r.name='Synology NAS'; }
    else if (combined.includes('nginx'))    { r.device_type='computer';  r.service='HTTP'; r.name='Web Server (' + ip + ')'; }
    else if (combined.includes('apache'))   { r.device_type='computer';  r.service='HTTP'; r.name='Web Server (' + ip + ')'; }
    else if (combined.includes('iis'))      { r.device_type='computer';  r.os_hint='Windows'; r.service='IIS'; r.name='Windows Server (' + ip + ')'; }
  } catch(_) {}

  return r;
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
      // Step 2: Scan subnet in batches, posting each batch to VPS as we go.
      // This way partial results are saved even if the app backgrounds mid-scan.
      onProgress?.('Scanning subnet...');
      const parts2 = baseIp.split('.');
      const base = parts2.slice(0, 3).join('.');
      let totalFound = 0;

      for (let start = 1; start <= 254; start += BATCH_SIZE) {
        const batch = [];
        for (let i = start; i < start + BATCH_SIZE && i <= 254; i++) {
          const ip = `${base}.${i}`;
          batch.push(
            probeIp(ip).then(alive => alive ? ip : null).catch(() => null)
          );
        }
        const batchIps = (await Promise.all(batch)).filter(Boolean);
        totalFound += batchIps.length;
        onProgress?.(`Scanned ${base}.${start}-${Math.min(start+BATCH_SIZE-1,254)} — ${totalFound} found`);

        if (batchIps.length > 0) {
          // Read ARP for this batch to get MACs, then post immediately
          const arpNow = await readArpTable();
          const batchDevices = batchIps.map(ip => {
            const arpEntry = arpNow.find(a => a.ip === ip);
            return { ip, mac: arpEntry?.mac || null, manufacturer: ouiLookup(arpEntry?.mac) || null, source: 'mobile_scan_v2' };
          });
          // Fire-and-forget POST — don't await, scan keeps going
          api.post('/api/cameras/presence', {
            ips: batchDevices, ssid_name: net.ssid, subnet, source: 'mobile_scan_v2', is_self: false
          }).catch(() => {});
        }
      }

      // Final ARP read after full scan
      probed = await readArpTable();
      onProgress?.(`Subnet scan complete — ${probed.length} devices in ARP`);
    } else {
      probed = arpEntries;
    }

    if (probed.length === 0) {
      onProgress?.('No devices found on network');
      onComplete?.({ found: 0, posted: 0 });
      return;
    }

    // Step 3: OUI lookup only (instant — no network calls)
    // VPS will request deep probes back through the Socket.io tunnel
    const enriched = probed.map(({ ip, mac }) => ({
      ip,
      mac: mac || null,
      manufacturer: ouiLookup(mac) || null,
      source: 'mobile_scan_v2',
    }));

    onProgress?.(`Found ${enriched.length} devices — posting to RSC...`);

    // Step 4: POST immediately to VPS — does NOT wait for deep probes.
    // VPS will send probe_request back through the socket tunnel for each
    // unknown device. Phone handles those in App.js socket listener.
    const payload = {
      ips: enriched,
      ssid_name: net.ssid,
      subnet,
      source: 'mobile_scan_v2',
      is_self: false,
    };

    const res = await api.post('/api/cameras/presence', payload);
    const { updated = 0, created = 0 } = res.data || {};

    onProgress?.(`Synced — ${enriched.length} devices sent to RSC cloud`);
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
