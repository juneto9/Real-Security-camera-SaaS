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
  'Alarm.com','SkyBell','Hikvision','Dahua','Reolink','Amcrest','Foscam','TP-Link','TP-Link Tapo',
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
        // Exception: if the entry has a known manufacturer passed in (e.g. SkyBell) keep it
        const passedMfr = entry.manufacturer || entry.vendor || '';
        if (!mac && !brand && !passedMfr) continue;
        if (!brand && passedMfr) brand = passedMfr;

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
