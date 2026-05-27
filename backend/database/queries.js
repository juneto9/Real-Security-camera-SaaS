Copy// db/queries.js
const pool = require('./pool');
const logger = require('../utils/logger');

const query = async (sql, values = []) => {
  try {
    const [results] = await pool.execute(sql, values);
    return results;
  } catch (error) {
    logger.error('Query error:', error);
    throw error;
  }
};

const queryOne = async (sql, values = []) => {
  const results = await query(sql, values);
  return results[0] || null;
};

const insert = async (table, data) => {
  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = columns.map(() => '?').join(', ');
  
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
  const result = await query(sql, values);
  return result.insertId;
};

const update = async (table, data, where) => {
  const columns = Object.keys(data);
  const values = Object.values(data);
  const whereColumns = Object.keys(where);
  const whereValues = Object.values(where);
  
  const setClause = columns.map(col => `${col} = ?`).join(', ');
  const whereClause = whereColumns.map(col => `${col} = ?`).join(' AND ');
  
  const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
  return query(sql, [...values, ...whereValues]);
};

const remove = async (table, where) => {
  const columns = Object.keys(where);
  const values = Object.values(where);
  const whereClause = columns.map(col => `${col} = ?`).join(' AND ');
  
  const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
  return query(sql, values);
};

module.exports = { query, queryOne, insert, update, remove };