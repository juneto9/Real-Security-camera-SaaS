const db = require('../utils/database');
const bcrypt = require('bcrypt');
const config = require('../config');
const logger = require('../utils/logger');

class User {
  static async create(email, password, firstName, lastName) {
    try {
      const hashedPassword = await bcrypt.hash(password, config.SECURITY.bcryptRounds);

      const result = await db.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW(), NOW())
         RETURNING id, email, first_name, last_name, is_active, created_at`,
        [email, hashedPassword, firstName, lastName]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating user', { error: error.message, email });
      throw error;
    }
  }

  static async findById(userId) {
    try {
      const result = await db.query(
        'SELECT id, email, first_name, last_name, is_active, created_at, updated_at FROM users WHERE id = $1',
        [userId]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding user by ID', { error: error.message, userId });
      throw error;
    }
  }

  static async findByEmail(email) {
    try {
      const result = await db.query(
        'SELECT id, email, password_hash, first_name, last_name, is_active, created_at FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding user by email', { error: error.message, email });
      throw error;
    }
  }

  static async verifyPassword(plainPassword, hashedPassword) {
    try {
      return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (error) {
      logger.error('Error verifying password', { error: error.message });
      throw error;
    }
  }

  static async update(userId, updates) {
    try {
      const allowedFields = ['first_name', 'last_name', 'is_active'];
      const fields = [];
      const values = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          fields.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      }

      if (fields.length === 0) {
        return await this.findById(userId);
      }

      values.push(userId);
      const query = `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING id, email, first_name, last_name, is_active, updated_at`;

      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating user', { error: error.message, userId });
      throw error;
    }
  }

  static async delete(userId) {
    try {
      const result = await db.query(
        'DELETE FROM users WHERE id = $1 RETURNING id',
        [userId]
      );

      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting user', { error: error.message, userId });
      throw error;
    }
  }

  static async getAll(limit = 50, offset = 0) {
    try {
      const result = await db.query(
        `SELECT id, email, first_name, last_name, is_active, created_at
         FROM users
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const countResult = await db.query('SELECT COUNT(*) FROM users');
      const total = parseInt(countResult.rows[0].count, 10);

      return {
        data: result.rows,
        total,
        limit,
        offset,
      };
    } catch (error) {
      logger.error('Error getting all users', { error: error.message });
      throw error;
    }
  }
}

module.exports = User;