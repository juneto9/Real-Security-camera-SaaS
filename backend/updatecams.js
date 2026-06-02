const { Client } = require('pg');
const client = new Client({ host: 'real-security-camera-do-user-37844161-0.k.db.ondigitalocean.com', port: 25060, database: 'defaultdb', user: 'doadmin', password: process.env.AIVEN_PASSWORD, ssl: { rejectUnauthorized: false } });
client.connect()
  .then(() => Promise.all([
    client.query("UPDATE devices SET rtsp_url='rtsp://root:adcvideo@10.0.0.6:554/live/main' WHERE location='10.0.0.6'"),
    client.query("UPDATE devices SET rtsp_url='rtsp://root:adcvideo@10.0.0.7:554/live/main' WHERE location='10.0.0.7'"),
    client.query("UPDATE devices SET rtsp_url='rtsp://root:adcvideo@10.0.0.9:554/live/main' WHERE location='10.0.0.9'"),
  ]))
  .then(() => { console.log('✅ All 3 cameras updated with root:adcvideo'); client.end(); })
  .catch(e => { console.error(e.message); client.end(); });
