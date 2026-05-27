require('dotenv').config({path:'.env'});
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});
pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
  .then(r => { console.log('Tables:', r.rows.map(r => r.table_name)); pool.end(); })
  .catch(e => { console.log('Error:', e.message); pool.end(); });
