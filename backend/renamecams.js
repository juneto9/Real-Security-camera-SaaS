const { Client } = require('pg');
const client = new Client({ host: 'real-security-camera-do-user-37844161-0.k.db.ondigitalocean.com', port: 25060, database: 'defaultdb', user: 'doadmin', password: process.env.AIVEN_PASSWORD, ssl: { rejectUnauthorized: false } });
client.connect()
  .then(() => Promise.all([
    client.query("UPDATE devices SET name = 'ADC-V724 Camera (10.0.0.6)' WHERE location = '10.0.0.6'"),
    client.query("UPDATE devices SET name = 'ADC-V724 Camera (10.0.0.7)' WHERE location = '10.0.0.7'"),
    client.query("UPDATE devices SET name = 'ADC-V724 Camera (10.0.0.9)' WHERE location = '10.0.0.9'"),
  ]))
  .then(() => { console.log('Updated camera names'); client.end(); })
  .catch(e => { console.error(e.message); client.end(); });
