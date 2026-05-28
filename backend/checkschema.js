require('dotenv').config({path:'.env'});
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  // Check organizations table structure
  const cols = await pool.query(
    "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'organizations' ORDER BY ordinal_position"
  );
  console.log('Organizations columns:', JSON.stringify(cols.rows, null, 2));

  const ucols = await pool.query(
    "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position"
  );
  console.log('Users columns:', JSON.stringify(ucols.rows, null, 2));
  pool.end();
}
run().catch(e => { console.log('Error:', e.message); pool.end(); });
