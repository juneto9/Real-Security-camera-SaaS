import { Router } from 'express';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import http from 'http';
import net from 'net';
const router = Router();

const MFR = {
  SkyBell:[['admin','admin'],['admin',''],['root','root'],['root',''],['admin','skybell'],['admin','123456'],['admin','password']],
  'Alarm.com':[['admin','admin'],['admin',''],['root','root'],['root',''],['admin','password'],['admin','123456']],
  Hikvision:[['admin','12345'],['admin','admin'],['admin',''],['admin','Admin123']],
  Dahua:[['admin','admin'],['admin',''],['888888','888888']],
  Reolink:[['admin',''],['admin','admin'],['admin','123456']],
  Axis:[['root',''],['root','pass'],['root','root'],['admin','admin']],
};

const UNI = [['admin','admin'],['admin',''],['admin','12345'],['admin','123456'],['admin','password'],['admin','pass'],['admin','4321'],['admin','888888'],['admin','000000'],['admin','system'],['root','root'],['root',''],['root','pass'],['root','admin'],['root','vizxv'],['root','xc3511'],['root','juantech'],['root','ikwb'],['root','dreambox'],['user','user'],['guest','guest'],['ubnt','ubnt'],['888888','888888'],['666666','666666'],['admin','smcadmin'],['admin','meinsm'],['admin','hikvision'],['admin','dahua'],['admin','cctvdvr']];

const PATHS = ['/Streaming/Channels/101','/Streaming/Channels/1','/cam/realmonitor?channel=1&subtype=0','/h264Preview_01_main','/videoMain','/live','/live/ch00_0','/stream1','/stream','/video1','/video','/ch0_0.h264','/0','/1','/media/video1','/onvif1','/main','/sub','/doorbell','/h264','/rtsp','/11','/12'];
const HP = [80,8080,8081,8888,5000,81,8000];
const RP = [554,8554,5554];

function tcp(ip, port) {
  return new Promise(r => {
    const s = new net.Socket();
    const t = setTimeout(() => { s.destroy(); r(false); }, 3000);
    s.connect(port, ip, () => { clearTimeout(t); s.destroy(); r(true); });
    s.on('error', () => { clearTimeout(t); r(false); });
  });
}

function hprobe(ip, port, u, p, path) {
  return new Promise(r => {
    const auth = u ? 'Basic ' + Buffer.from(u + ':' + (p||'')).toString('base64') : null;
    const req = http.request({ hostname:ip, port, path:path||'/', method:'GET', timeout:4000, headers: auth ? {Authorization:auth} : {} }, res => {
      r({ ok: res.statusCode < 400, status: res.statusCode });
      res.resume();
    });
    req.on('timeout', () => { req.destroy(); r({ ok: false }); });
    req.on('error', () => r({ ok: false }));
    req.end();
  });
}

function onvif(ip, port, u, p, tok) {
  return new Promise(r => {
    const t = tok || 'MainStream';
    const soap = '<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema"><s:Body><trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>' + t + '</trt:ProfileToken></trt:GetStreamUri></s:Body></s:Envelope>';
    const auth = u ? 'Basic ' + Buffer.from(u + ':' + (p||'')).toString('base64') : null;
    const req = http.request({ hostname:ip, port, path:'/onvif/device_service', method:'POST', timeout:4000,
      headers: { 'Content-Type':'application/soap+xml', 'Content-Length':Buffer.byteLength(soap), ...(auth ? {Authorization:auth} : {}) }
    }, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { const m = b.match(/rtsp:\/\/[^\s<"']+/i); r(m ? m[0] : null); });
    });
    req.on('timeout', () => { req.destroy(); r(null); });
    req.on('error', () => r(null));
    req.write(soap); req.end();
  });
}

async function lg(id, org, msg) {
  try { await query('UPDATE liberation_jobs SET notes=$3,updated_at=NOW() WHERE id=$1 AND org_id=$2', [id, org, '[' + new Date().toISOString() + '] ' + msg]); } catch(e) {}
  console.log('[Liberation] ' + msg);
}

async function fin(id, org, ok, url, method, n, cands) {
  const st = ok ? 'success' : (method === 'C' ? 'escalated' : 'failed');
  const [j] = await query('UPDATE liberation_jobs SET status=$3,rtsp_url_extracted=$4,current_method=$5,rtsp_candidates=$6,attempts=$7,completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND org_id=$2 RETURNING *',
    [id, org, st, url||'', method, JSON.stringify(cands.slice(0,50)), n]);
  if (ok && j.camera_id && url) {
    await query('UPDATE cameras SET rtsp_url=$3,is_liberated=true,liberation_method=$4,updated_at=NOW() WHERE id=$1 AND org_id=$2', [j.camera_id, org, url, method]);
  }
  return j;
}




async function runLib(id, org, ip, mfr) {
  await query('UPDATE liberation_jobs SET status=$3,started_at=NOW() WHERE id=$1 AND org_id=$2', [id, org, 'running']);
  const seen = new Set();
  const creds = [...(MFR[mfr]||[]), ...UNI].filter(([u,p]) => { const k=u+':'+p; if(seen.has(k))return false; seen.add(k); return true; });
  let n = 0;
  await lg(id, org, 'Server-side probe on ' + ip + ' — ' + creds.length + ' credentials (no browser CORS/HTTPS restrictions)');

  const lp = [];
  for (const port of HP) { if (await tcp(ip,port)) { lp.push(port); await lg(id, org, 'Port ' + port + ' OPEN'); } }
  const lr = [];
  for (const port of RP) { if (await tcp(ip,port)) { lr.push(port); await lg(id, org, 'RTSP ' + port + ' OPEN'); } }

  await lg(id, org, 'Phase 2: ONVIF discovery...');
  for (const port of [...lp, 8899, 2020]) {
    for (const [u,p] of [['',''], ...creds.slice(0,12)]) {
      for (const tok of ['MainStream','Profile_1','profile_1','token0','1','000']) {
        n++;
        const rtsp = await onvif(ip, port, u, p, tok);
        if (rtsp) { await lg(id, org, 'ONVIF SUCCESS: ' + rtsp); return fin(id, org, true, rtsp, 'B', n, [rtsp]); }
      }
    }
  }

  await lg(id, org, 'Phase 3: HTTP API authentication...');
  const apis = ['/ISAPI/Streaming/channels/101','/System/deviceInfo','/cgi-bin/magicBox.cgi?action=getProductType','/snapshot.cgi','/cgi-bin/snapshot.cgi'];
  for (const port of lp) {
    for (const [u,p] of creds) {
      n++;
      if (n % 30 === 0) await lg(id, org, n + ' attempts — ' + u + ':' + (p||'(empty)'));
      for (const ap of apis) {
        const r = await hprobe(ip, port, u, p, ap);
        if (r.ok) {
          const rp = lr[0] || 554;
          const cands = PATHS.map(path => 'rtsp://' + encodeURIComponent(u) + ':' + encodeURIComponent(p||'') + '@' + ip + ':' + rp + path);
          await lg(id, org, 'AUTH CONFIRMED: ' + u + ':' + (p||'(empty)') + ' port ' + port + ' — ' + cands.length + ' RTSP candidates built');
          return fin(id, org, true, cands[0], 'A', n, cands);
        }
      }
    }
  }

  await lg(id, org, 'Phase 4: Raw HTTP sweep...');
  for (const port of lp) {
    for (const [u,p] of creds) {
      n++;
      const r = await hprobe(ip, port, u, p, '/');
      if (r.ok) {
        const rp = lr[0] || 554;
        const cands = PATHS.map(path => 'rtsp://' + encodeURIComponent(u) + ':' + encodeURIComponent(p||'') + '@' + ip + ':' + rp + path);
        await lg(id, org, 'HTTP responded: ' + u + ':' + (p||'(empty)') + ' port ' + port);
        return fin(id, org, true, cands[0], 'D', n, cands);
      }
    }
  }

  if (lr.length > 0) {
    await lg(id, org, 'Phase 5: RTSP ports open — building blind candidates...');
    const cands = [];
    for (const [u,p] of creds.slice(0,20)) {
      for (const rp of lr) {
        for (const path of PATHS) { cands.push('rtsp://' + encodeURIComponent(u) + ':' + encodeURIComponent(p||'') + '@' + ip + ':' + rp + path); }
      }
    }
    await lg(id, org, 'Generated ' + cands.length + ' candidates — test in VLC');
    return fin(id, org, false, cands[0], 'D', n, cands);
  }

  await lg(id, org, 'All ' + n + ' attempts exhausted. Camera appears cloud-only. Method C (UART) required.');
  return fin(id, org, false, null, 'C', n, []);
}

router.get('/', requireAuth, async (req,res) => {
  try { res.json(await query('SELECT * FROM liberation_jobs WHERE org_id=$1 ORDER BY created_at DESC', [req.orgId])); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/:id', requireAuth, async (req,res) => {
  try {
    const j = await queryOne('SELECT * FROM liberation_jobs WHERE id=$1 AND org_id=$2', [req.params.id, req.orgId]);
    if (!j) return res.status(404).json({ error: 'Not found' });
    res.json(j);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/', requireAuth, async (req,res) => {
  const { camera_id, camera_name, ip_address, mac_address, manufacturer, model, method='A' } = req.body;
  if (!ip_address) return res.status(400).json({ error: 'ip_address required' });
  try {
    const [job] = await query(
      'INSERT INTO liberation_jobs (org_id,camera_id,camera_name,ip_address,mac_address,manufacturer,model,current_method,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.orgId, camera_id, camera_name, ip_address, mac_address, manufacturer, model, method, 'pending']
    );
    // LAN IP check - VPS cannot reach private addresses
    const isLAN = /^(10|127|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\./.test(ip_address);
    if (isLAN) {
      const creds = [['admin','admin'],['admin',''],['admin','12345'],['root',''],['root','root']];
      const paths = ['/Streaming/Channels/101','/cam/realmonitor?channel=1&subtype=0','/h264Preview_01_main','/live','/stream1','/videoMain','/onvif1','/1'];
      const candidates = [];
      for (const [u,p] of creds) {
        for (const path of paths) {
          const auth = u ? encodeURIComponent(u)+':'+encodeURIComponent(p||'')+'@' : '';
          candidates.push('rtsp://'+auth+ip_address+':554'+path);
        }
      }
      await query(
        'UPDATE liberation_jobs SET status=$3,notes=$4,rtsp_candidates=$5,completed_at=NOW() WHERE id=$1 AND org_id=$2',
        [job.id, req.orgId, 'local_required',
         '['+new Date().toISOString()+'] LAN IP - VPS cannot reach '+ip_address+'. Test '+candidates.length+' RTSP candidates from your browser or RSC Mobile app.',
         JSON.stringify(candidates)]
      );
    } else {
      runLib(job.id, req.orgId, ip_address, manufacturer||'')
        .catch(err => query('UPDATE liberation_jobs SET status=$3,notes=$4 WHERE id=$1 AND org_id=$2', [job.id, req.orgId, 'failed', err.message]));
    }
    res.status(201).json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/:id/retry', requireAuth, async (req,res) => {
  try {
    const j = await queryOne('SELECT * FROM liberation_jobs WHERE id=$1 AND org_id=$2', [req.params.id, req.orgId]);
    if (!j) return res.status(404).json({ error: 'Not found' });
    await query('UPDATE liberation_jobs SET status=$3,notes=NULL,attempts=0 WHERE id=$1 AND org_id=$2', [j.id, req.orgId, 'pending']);
    runLib(j.id, req.orgId, j.ip_address, j.manufacturer||'').catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
