import { broadcast } from '../server.js';
import { Router } from 'express';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
const router = Router();
router.get('/network-info', async (req, res) => {
  try {
    const result = await query(
      `SELECT ssid_name, ip_address FROM cameras WHERE ssid_name IS NOT NULL AND ssid_name != '' AND ssid_name NOT LIKE 'Network %' ORDER BY updated_at DESC LIMIT 1`
    );
    if (result.length > 0) res.json({ ssid: result[0].ssid_name, ip: result[0].ip_address });
    else res.json({ ssid: null, ip: null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/', requireAuth, async (req, res) => {
  try { res.json(await query('SELECT * FROM cameras WHERE org_id = $1 ORDER BY created_at DESC', [req.orgId])); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const cam = await queryOne('SELECT * FROM cameras WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
    if (!cam) return res.status(404).json({ error: 'Not found' });
    try { broadcast(req.orgId, { type: 'camera:update', id: cam.id, data: cam }); } catch {}
    res.json(cam);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/', requireAuth, async (req, res) => {
  const f = req.body;
  try {
    const [cam] = await query(
      'INSERT INTO cameras (org_id,name,ip_address,mac_address,rtsp_url,device_type,status,location,ssid_name,port,is_enrolled,manufacturer,model,cam_mode,clip_size,motion_sensitivity,sound_sensitivity,night_vision_pro,is_armed,cloud_upload,motion_enabled,sound_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *',
      [req.orgId,f.name,f.ip_address||null,f.mac_address||null,f.rtsp_url||null,f.device_type||'ip_camera',f.status||'offline',f.location||null,f.ssid_name||null,f.port||554,f.is_enrolled||false,f.manufacturer||null,f.model||null,f.cam_mode||'security',f.clip_size||15,f.motion_sensitivity||50,f.sound_sensitivity||50,f.night_vision_pro||false,f.is_armed||false,f.cloud_upload!==false,f.motion_enabled!==false,f.sound_enabled!==false]
    );
    res.status(201).json(cam);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.patch('/:id', requireAuth, async (req, res) => {
  const allowed = ['name','ip_address','mac_address','rtsp_url','hls_url','webrtc_url','relay_host','relay_last_seen','push_subscription','device_type','status','location','ssid_name','port','is_enrolled','is_armed','is_liberated','is_dismissed','liberation_method','manufacturer','model','chipset','cam_mode','motion_enabled','sound_enabled','night_vision','night_vision_pro','has_audio','two_way_audio','cloud_upload','loop_forever','loop_overwrite','loop_duration','clip_size','motion_sensitivity','night_sensitivity','sound_sensitivity','speaker_volume','ai_detection','detect_humans','detect_pets','detect_vehicles','agent_config_json'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'No valid fields' });
  const set = updates.map(([k],i) => k+'=$'+(i+3)).join(',');
  try {
    const [cam] = await query('UPDATE cameras SET '+set+',updated_at=NOW() WHERE id=$1 AND org_id=$2 RETURNING *', [req.params.id, req.orgId, ...updates.map(([,v])=>v)]);
    if (!cam) return res.status(404).json({ error: 'Not found' });
    try { broadcast(req.orgId, { type: 'camera:update', id: cam.id, data: cam }); } catch {}
    res.json(cam);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/:id', requireAuth, async (req, res) => {
  try { await query('DELETE FROM cameras WHERE id=$1 AND org_id=$2', [req.params.id, req.orgId]); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/:id/livekit-token', requireAuth, async (req, res) => {
  try {
    const r = await fetch('https://livekit.realsecuritycamera.com/livekit-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: req.params.id, identity: req.body.identity, canPublish: req.body.canPublish, canSubscribe: req.body.canSubscribe }),
    });
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Internal webhook route - update camera by room ID
router.patch('/by-room/:roomId', async (req, res) => {
  const secret = req.headers['x-internal'];
  if (secret !== 'livekit-webhook') return res.status(403).json({ error: 'Forbidden' });
  try {
    const [cam] = await query(
      'UPDATE cameras SET ip_address=$2, ssid_name=$3, updated_at=NOW() WHERE id=$1 RETURNING *',
      [req.params.roomId, req.body.ip_address, req.body.ssid_name]
    );
    if (cam) {
      console.log('[Webhook] Camera updated:', cam.name, cam.ip_address, cam.ssid_name);
      res.json(cam);
    } else {
      res.status(404).json({ error: 'Camera not found' });
    }
  } catch(err) { res.status(500).json({ error: err.message }); }
});


// ── Full intelligence presence endpoint ──────────────────────────────────────
// Implements the complete agentReport discovery logic from the original Base44 function

const KNOWN_OUI = {
  '00:1c:fa':'Alarm.com',  'b8:3a:9d':'Alarm.com',  '50:40:74':'Alarm.com',  '18:68:cb':'Hikvision',  '4c:bd:8f':'Hikvision',
  '94:e1:ac':'Hikvision',  'bc:ad:28':'Hikvision',  '14:a7:8b':'Dahua',  '4c:11:bf':'Dahua',  'e0:50:8b':'Dahua',
  '00:40:8c':'Axis',  '00:18:85':'Avigilon',  '00:01:31':'Bosch',  '00:10:17':'Bosch',  'e4:30:22':'Hanwha',
  '00:1b:d8':'FLIR',  '00:13:e2':'GeoVision',  '00:0a:13':'Honeywell',  '00:04:7d':'Pelco',  '00:03:c5':'Mobotix',
  '00:10:be':'March Networks',  '00:1c:27':'Sunell',  '00:02:d1':'Vivotek',  '48:ea:63':'Uniview',  '00:1a:07':'Arecont',
  '14:2f:fd':'LTS',  'ec:71:db':'Reolink',  'a0:07:a0':'Foscam',  'e8:ab:fa':'Foscam',  'bc:32:5f':'Amcrest',
  '00:27:22':'Ubiquiti',  '18:e8:29':'Ubiquiti',  '68:72:51':'Ubiquiti',  '80:2a:a8':'Ubiquiti',  'e0:63:da':'Ubiquiti',
  'a0:02:dc':'Ring',  'fc:a1:83':'Ring',  '2c:aa:8e':'Ring',  'b0:09:da':'Ring',  '18:b4:30':'Nest',
  'f4:f5:d8':'Nest',  '44:a5:6e':'Arlo',  '2c:aa:8e':'Wyze',  '84:e3:42':'Eufy',  '44:3a:3d':'Blink',
  '14:cc:20':'TP-Link',  '28:d9:8a':'TP-Link',  '50:3e:aa':'TP-Link',  '64:70:02':'TP-Link',  '78:a1:06':'TP-Link',
  'a0:f3:c1':'TP-Link',  'c0:a0:bb':'TP-Link',  'f4:f2:6d':'TP-Link',  '00:00:f0':'Samsung',  '00:12:fb':'Samsung',
  '00:15:b9':'Samsung',  '00:16:6c':'Samsung',  '00:17:d5':'Samsung',  '00:1b:98':'Samsung',  '00:1d:f6':'Samsung',
  '00:1e:e2':'Samsung',  '00:21:4c':'Samsung',  '00:23:39':'Samsung',  '00:23:d6':'Samsung',  '00:24:90':'Samsung',
  '00:25:66':'Samsung',  '00:26:5f':'Samsung',  '00:7c:2d':'Samsung',  '00:bf:61':'Samsung',  '00:e3:b2':'Samsung',
  '04:18:0f':'Samsung',  '04:b1:a1':'Samsung',  '04:ba:8d':'Samsung',  '04:fe:31':'Samsung',  '08:37:3d':'Samsung',
  '08:8c:2c':'Samsung',  '08:bf:a0':'Samsung',  '08:ec:a9':'Samsung',  '08:fd:0e':'Samsung',  '0c:2f:b0':'Samsung',
  '0c:8d:ca':'Samsung',  '0c:df:a4':'Samsung',  '10:1d:c0':'Samsung',  '10:30:47':'Samsung',  '10:77:b1':'Samsung',
  '10:92:66':'Samsung',  '10:e4:c2':'Samsung',  '14:1f:78':'Samsung',  '14:56:8e':'Samsung',  '14:a3:64':'Samsung',
  '14:f4:2a':'Samsung',  '18:1e:b0':'Samsung',  '18:26:54':'Samsung',  '18:3f:47':'Samsung',  '18:4e:cb':'Samsung',
  '18:67:b0':'Samsung',  '18:89:5b':'Samsung',  '1c:23:2c':'Samsung',  '1c:62:b8':'Samsung',  '1c:86:9a':'Samsung',
  '1c:e5:7f':'Samsung',  '20:13:e0':'Samsung',  '20:32:6c':'Samsung',  '20:64:32':'Samsung',  '20:d5:bf':'Samsung',
  '24:11:53':'Samsung',  '24:4b:81':'Samsung',  '24:92:0e':'Samsung',  '24:db:ed':'Samsung',  '24:fc:e5':'Samsung',
  '28:39:5e':'Samsung',  '28:98:7b':'Samsung',  '28:c2:1f':'Samsung',  '2c:15:bf':'Samsung',  '2c:99:75':'Samsung',
  '30:07:4d':'Samsung',  '30:74:67':'Samsung',  '30:c7:ae':'Samsung',  '30:d5:87':'Samsung',  '34:23:ba':'Samsung',
  '34:82:c5':'Samsung',  '34:be:00':'Samsung',  '38:01:95':'Samsung',  '38:16:d1':'Samsung',  '38:4a:80':'Samsung',
  '38:8a:06':'Samsung',  '38:9a:f6':'Samsung',  '38:ec:e4':'Samsung',  '3c:20:f6':'Samsung',  '3c:62:00':'Samsung',
  '3c:bb:fd':'Samsung',  '40:11:c3':'Samsung',  '40:5e:f6':'Samsung',  '44:16:fa':'Samsung',  '48:44:f7':'Samsung',
  '4c:a5:6d':'Samsung',  '50:85:69':'Samsung',  '50:f5:20':'Samsung',  '54:92:be':'Samsung',  '58:2f:40':'Samsung',
  '5c:49:7d':'Samsung',  '5c:f6:dc':'Samsung',  '60:a1:0a':'Samsung',  '64:b8:53':'Samsung',  '68:eb:ae':'Samsung',
  '70:28:8b':'Samsung',  '74:a0:2f':'Samsung',  '78:52:1a':'Samsung',  '7c:1c:4e':'Samsung',  '80:18:a7':'Samsung',
  '84:11:9e':'Samsung',  '84:a4:66':'Samsung',  '8c:1f:94':'Samsung',  '90:18:7c':'Samsung',  '94:63:d1':'Samsung',
  '98:52:b1':'Samsung',  'a0:07:98':'Samsung',  'a0:82:1f':'Samsung',  'a8:7d:12':'Samsung',  'b0:72:bf':'Samsung',
  'b4:3a:28':'Samsung',  'b8:5e:7b':'Samsung',  'bc:20:a4':'Samsung',  'bc:8c:cd':'Samsung',  'c0:bd:d1':'Samsung',
  'c4:57:6e':'Samsung',  'c8:21:58':'Samsung',  'cc:05:1b':'Samsung',  'd0:13:fd':'Samsung',  'd0:59:e4':'Samsung',
  'd4:88:90':'Samsung',  'dc:71:96':'Samsung',  'e4:40:e2':'Samsung',  'e8:03:9a':'Samsung',  'e8:9d:87':'Samsung',
  'f0:08:f1':'Samsung',  'f0:e7:7e':'Samsung',  'f4:9f:54':'Samsung',  'f8:d0:bd':'Samsung',  'fc:a1:3e':'Samsung',
  '00:03:93':'Apple',  '00:11:24':'Apple',  '00:17:f2':'Apple',  '00:1c:b3':'Apple',  '00:1e:c2':'Apple',
  '00:21:e9':'Apple',  '00:23:32':'Apple',  '00:24:36':'Apple',  '00:25:bc':'Apple',  '00:26:b9':'Apple',
  '04:0c:ce':'Apple',  '04:48:9a':'Apple',  '04:d3:cf':'Apple',  '08:6d:41':'Apple',  '0c:30:21':'Apple',
  '0c:74:c2':'Apple',  '10:40:f3':'Apple',  '10:dd:b1':'Apple',  '14:8f:c6':'Apple',  '18:34:51':'Apple',
  '18:af:61':'Apple',  '1c:91:48':'Apple',  '20:a2:e4':'Apple',  '28:37:37':'Apple',  '28:cf:da':'Apple',
  '2c:20:0b':'Apple',  '34:15:9e':'Apple',  '34:a3:95':'Apple',  '3c:07:54':'Apple',  '40:3c:fc':'Apple',
  '40:98:ad':'Apple',  '40:cb:c0':'Apple',  '44:2a:60':'Apple',  '48:43:7c':'Apple',  '4c:57:ca':'Apple',
  '50:32:75':'Apple',  '54:ea:a8':'Apple',  '60:03:08':'Apple',  '60:9a:c1':'Apple',  '60:f4:45':'Apple',
  '64:76:ba':'Apple',  '68:09:27':'Apple',  '68:96:7b':'Apple',  '6c:40:08':'Apple',  '6c:72:e7':'Apple',
  '6c:ab:31':'Apple',  '70:3e:ac':'Apple',  '70:cd:60':'Apple',  '74:1b:b2':'Apple',  '78:4f:43':'Apple',
  '7c:5c:f8':'Apple',  '7c:fa:df':'Apple',  '84:38:35':'Apple',  '84:b1:53':'Apple',  '88:53:2e':'Apple',
  '88:ae:07':'Apple',  '8c:2d:aa':'Apple',  '8c:85:90':'Apple',  '90:3c:92':'Apple',  '90:b0:ed':'Apple',
  '94:bf:2d':'Apple',  '98:01:a7':'Apple',  '9c:20:7b':'Apple',  'a0:99:9b':'Apple',  'a4:67:06':'Apple',
  'a4:d1:d2':'Apple',  'a8:60:b6':'Apple',  'a8:96:75':'Apple',  'ac:61:ea':'Apple',  'ac:cf:5c':'Apple',
  'b0:65:bd':'Apple',  'b4:f0:ab':'Apple',  'b8:41:a4':'Apple',  'b8:78:2e':'Apple',  'bc:3b:af':'Apple',
  'c0:84:7a':'Apple',  'c4:b3:01':'Apple',  'c8:33:4b':'Apple',  'c8:d0:83':'Apple',  'cc:29:f5':'Apple',
  'd0:23:db':'Apple',  'd0:81:7a':'Apple',  'd4:dc:cd':'Apple',  'd8:1d:72':'Apple',  'd8:96:95':'Apple',
  'dc:a9:04':'Apple',  'e0:c7:67':'Apple',  'e4:98:d6':'Apple',  'e8:04:62':'Apple',  'ec:35:86':'Apple',
  'f0:79:60':'Apple',  'f0:cb:a1':'Apple',  'f0:dc:e2':'Apple',  'f4:37:b7':'Apple',  'f8:1e:df':'Apple',
  'fc:25:3f':'Apple',  '3c:5a:b4':'Google',  'a4:77:33':'Google',  '00:17:e9':'Motorola',  '9c:4e:36':'Motorola',
  '8c:be:a9':'OnePlus',  'a4:4b:d5':'OPPO',  'b4:a9:fc':'OPPO',  '00:1a:ef':'OPPO',  '00:9e:c8':'Xiaomi',
  '28:6c:07':'Xiaomi',  '38:a4:ed':'Xiaomi',  '64:09:80':'Xiaomi',  '74:51:ba':'Xiaomi',  '9c:99:a0':'Xiaomi',
  'c4:6a:b7':'Xiaomi',  'fc:64:ba':'Xiaomi'
};

const CAMERA_BRANDS = new Set([
  'Alarm.com','Hikvision','Dahua','Reolink','Amcrest','Foscam','TP-Link','TP-Link Tapo',
  'Axis','Hanwha','Eufy','Ring','Nest','Arlo','Wyze','Blink','Avigilon','Bosch',
  'FLIR','GeoVision','Honeywell','Pelco','Mobotix','Sunell','Vivotek','Uniview',
  'Arecont','LTS','Ubiquiti','Swann','Lorex','Annke','Zosi','Ezviz','Xiaomi',
  'Tiandy','Zmodo','March Networks','Sony','Panasonic','Samsung','Apple','Google',
  'SkyBell','Digital Watchdog','ACTi','Speco','Milesight','Verkada','IDIS','HiLook',
  'CP Plus','Night Owl','Canary','Logitech','ZKTeco','Wisenet','LTS','Montavue',
]);
const NIC_CHIPS = ['realtek','intel','broadcom','ralink','atheros','qualcomm','mediatek'];
const CONSUMER_BRANDS = ['apple','samsung','google','amazon','oneplus','xiaomi','huawei','oppo','motorola'];
const GATEWAY_BRANDS = ['cisco','ubiquiti','netgear','arris','d-link','linksys','mikrotik','zyxel','technicolor'];

function knownOUI(mac) {
  if (!mac) return null;
  const p = mac.toLowerCase().replace(/-/g,':').split(':').slice(0,3).join(':');
  return KNOWN_OUI[p] || null;
}
function isNIC(b) { return b && NIC_CHIPS.some(v => b.toLowerCase().includes(v)); }
function isGateway(ip) { const l = (ip||'').split('.').pop(); return l==='1'||l==='254'; }
function isConsumer(b) { return b && CONSUMER_BRANDS.some(v => b.toLowerCase().includes(v)); }

function cleanBrand(raw) {
  if (!raw) return raw;
  const s = raw.toLowerCase();
  if (s.includes('hikvision')) return 'Hikvision';
  if (s.includes('dahua')) return 'Dahua';
  if (s.includes('alarm.com')) return 'Alarm.com';
  if (s.includes('reolink')) return 'Reolink';
  if (s.includes('wyze')) return 'Wyze';
  if (s.includes('amcrest')) return 'Amcrest';
  if (s.includes('foscam')) return 'Foscam';
  if (s.includes('eufy')||s.includes('anker')) return 'Eufy';
  if (s.includes('arlo')) return 'Arlo';
  if (s.includes('axis')) return 'Axis';
  if (s.includes('hanwha')||s.includes('samsung techwin')) return 'Hanwha';
  if (s.includes('ring')) return 'Ring';
  if (s.includes('apple')) return 'Apple';
  if (s.includes('samsung')) return 'Samsung';
  if (s.includes('google')) return 'Google';
  if (s.includes('amazon')) return 'Amazon';
  if (s.includes('tp-link')||s.includes('tp link')) return 'TP-Link';
  if (s.includes('netgear')) return 'Netgear';
  if (s.includes('raspberry')) return 'Raspberry Pi';
  if (s.includes('chongqing fugui')||s.includes('hewlett')) return 'HP';
  return raw.replace(/\b(inc\.?|corp\.?|ltd\.?|llc|technologies?|systems?|networks?)\b/gi,'').trim()||raw;
}

function inferType(brand, ports) {
  const b = (brand||'').toLowerCase();
  const p = Array.isArray(ports) ? ports : (ports ? [ports] : []);
  if (CAMERA_BRANDS.has(brand)) return 'ip_camera';
  if (p.some(x => [554,8554,34567,37777,9000].includes(x))) return 'ip_camera';
  if (CONSUMER_BRANDS.some(v => b.includes(v))) return 'phone';
  if (b.includes('amazon')) return 'phone';
  if (['lenovo','dell','hp','asus','acer','msi','toshiba'].some(v=>b.includes(v))) return 'laptop';
  if (isNIC(brand)) return 'laptop';
  return 'unknown';
}

function buildName(hostname, brand) {
  if (hostname && !hostname.match(/^[\d.]+$/) && hostname.toLowerCase()!=='localhost') {
    const clean = hostname.replace(/\.local$/i,'').replace(/\.lan$/i,'');
    if (!brand || clean.toLowerCase().includes(brand.toLowerCase())) return clean;
    return brand + ' – ' + clean;
  }
  return brand || null;
}

router.post('/presence', requireAuth, async (req, res) => {
  try {
    const { ips, ssid_name, subnet, is_self, source } = req.body;
    console.log(`[presence] source=${source||'direct'} ips=${JSON.stringify(ips?.slice(0,3))} subnet=${subnet}`);
    if (!Array.isArray(ips) || ips.length === 0) return res.json({ ok: true, updated: 0 });

    // MAC lookup shortcut — browser lost its IP, recover from DB by MAC
    if (source === 'mac_lookup' && ips[0] && ips[0].mac) {
      const byMac = await query('SELECT ip_address FROM cameras WHERE mac_address=$1 AND org_id=$2 AND ip_address IS NOT NULL LIMIT 1', [ips[0].mac, req.orgId]);
      if (byMac.length) return res.json({ ok: true, ip: byMac[0].ip_address });
      return res.json({ ok: true, ip: null });
    }

    const now = new Date().toISOString();
    let created = 0, updated = 0, enriched = 0;

    for (const entry of ips) {
      const { ip, port, hostname, mac } = entry;
      if (!ip) continue;
      if (isGateway(ip)) continue;

      // Resolve brand: KNOWN_OUI first, then VPS OUI lookup, then what was passed in
      const knownBrand = knownOUI(mac);
      let brand = knownBrand ? cleanBrand(knownBrand) : null;

      if (!brand && mac) {
        try {
          const ouiRes = await fetch('https://livekit.realsecuritycamera.com/oui-lookup', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({mac}), signal: AbortSignal.timeout(3000),
          });
          if (ouiRes.ok) { const od = await ouiRes.json(); if (od.vendor) brand = cleanBrand(od.vendor); }
        } catch(_) {}
      }

      if (isNIC(brand)) brand = null;
      const dtype = inferType(brand, port);
      const displayName = buildName(hostname, brand);

      // Lookup existing by MAC first (stable), then IP (DHCP can change)
      let existing = [];
      if (mac) {
        const byMac = await query('SELECT * FROM cameras WHERE mac_address=$1 AND org_id=$2 LIMIT 1', [mac, req.orgId]);
        if (byMac.length) existing = byMac;
      }
      if (!existing.length && ip) {
        const byIp = await query('SELECT * FROM cameras WHERE ip_address=$1 AND org_id=$2 LIMIT 1', [ip, req.orgId]);
        if (byIp.length) existing = byIp;
      }

      if (existing.length > 0) {
        const cam = existing[0];
        if (cam.is_dismissed) continue;
        // Skip re-surfacing no-identity unknown devices — they'll be cleaned up
        if (!mac && !brand && cam.device_type === 'unknown' && !cam.is_enrolled && !cam.manufacturer) continue;

        const upd = { status: 'online', updated_at: now };
        if (ip && cam.ip_address !== ip) upd.ip_address = ip; // heal DHCP drift
        if (ssid_name && !cam.ssid_name) upd.ssid_name = ssid_name;
        if (port && !cam.port) upd.port = port;
        if (brand && !cam.manufacturer) { upd.manufacturer = brand; enriched++; }
        if (dtype && dtype !== 'unknown' && cam.device_type === 'unknown') upd.device_type = dtype;

        const staleName = !cam.name || cam.name.startsWith('Device ') || cam.name.startsWith('PC/Laptop') || cam.name.startsWith('Phone/Tablet');
        if (staleName && displayName) upd.name = displayName;
        // Always save MAC when we get one — regardless of device type
        if (mac && !cam.mac_address) { upd.mac_address = mac; enriched++; }

        const setClauses = Object.entries(upd).map(([k],i) => k+'=$'+(i+3)).join(',');
        await query(`UPDATE cameras SET ${setClauses} WHERE id=$1 AND org_id=$2`, [cam.id, req.orgId, ...Object.values(upd)]);
        updated++;

      } else {
        // New device — only insert if we have a MAC or a known brand
        // Pure IP-only hits with no identity are noise, skip them
        if (!mac && !brand) continue;

        const name = displayName || (brand ? brand + ' – ' + ip : 'Device ' + ip);
        await query(
          `INSERT INTO cameras (org_id,name,ip_address,mac_address,port,manufacturer,device_type,status,is_enrolled,ssid_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'online',false,$8) ON CONFLICT DO NOTHING`,
          [req.orgId, name, ip, mac||null, port||80, brand||null, dtype, ssid_name||null]
        );
        created++;
      }
    }

    // Offline sweep — devices on same subnet that didn't report
    if (subnet && !is_self) {
      const subBase = subnet.split('.').slice(0,3).join('.');
      const foundIps = ips.map(x=>x.ip).filter(Boolean);
      await query(
        `UPDATE cameras SET status='offline', updated_at=NOW()
         WHERE org_id=$1 AND is_enrolled=false AND is_liberated=false
         AND status='online' AND ip_address LIKE $2
         AND ip_address != ALL($3::text[])`,
        [req.orgId, subBase+'.%', foundIps]
      ).catch(()=>{});
    }

    console.log(`[presence] created=${created} updated=${updated} enriched=${enriched}`);
    res.json({ ok: true, created, updated, enriched });
  } catch(e) {
    console.error('[presence]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Detection count endpoint
router.post('/:id/detection', requireAuth, async (req, res) => {
  try {
    const { type, identified } = req.body;
    if (type === 'person') {
      if (identified) {
        await query('UPDATE cameras SET person_detections=person_detections+1 WHERE id=$1 AND org_id=$2', [req.params.id, req.orgId]);
      } else {
        await query('UPDATE cameras SET unknown_detections=unknown_detections+1 WHERE id=$1 AND org_id=$2', [req.params.id, req.orgId]);
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Beacon endpoint — called by sendBeacon on page unload, no auth header needed
// Uses camera ID from URL + org lookup by token in body or just clears by ID
router.post('/:id/beacon', async (req, res) => {
  try {
    const { id } = req.params;
    await query(
      "UPDATE cameras SET status='offline', webrtc_url=NULL, is_armed=false, relay_last_seen=NULL WHERE id=$1",
      [id]
    );
    res.status(204).end();
  } catch(e) { res.status(500).end(); }
});

export default router;
