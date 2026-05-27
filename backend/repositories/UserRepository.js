// backend/repositories/UserRepository.js
const { query, queryOne, insert, update, remove } = require('../database/queries');
const logger = require('../utils/logger');

class UserRepository {
  async findById(userId) {
    try {
      const sql = 'SELECT id, email, name, organization_id, role, created_at FROM users WHERE id = ?';
      return await queryOne(sql, [userId]);
    } catch (error) {
      logger.error('Error finding user by ID:', error);
      throw error;
    }
  }

  async findByEmail(email) {
    try {
      const sql = 'SELECT * FROM users WHERE email = ?';
      return await queryOne(sql, [email]);
    } catch (error) {
      logger.error('Error finding user by email:', error);
      throw error;
    }
  }

  async create(userData) {
    try {
      const { email, name, password_hash, organization_id, role } = userData;
      const data = {
        email,
        name,
        password_hash,
        organization_id,
        role: role || 'user',
        created_at: new Date()
      };
      return await insert('users', data);
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  async update(userId, userData) {
    try {
      const { name, email, role } = userData;
      const data = { name, email, role, updated_at: new Date() };
      await update('users', data, { id: userId });
      return await this.findById(userId);
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  async delete(userId) {
    try {
      return await remove('users', { id: userId });
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  async findByOrganization(organizationId) {
    try {
      const sql = 'SELECT id, email, name, role, created_at FROM users WHERE organization_id = ?';
      return await query(sql, [organizationId]);
    } catch (error) {
      logger.error('Error finding users by organization:', error);
      throw error;
    }
  }

  async updatePassword(userId, passwordHash) {
    try {
      await update('users', { password_hash: passwordHash, updated_at: new Date() }, { id: userId });
      return true;
    } catch (error) {
      logger.error('Error updating password:', error);
      throw error;
    }
  }
}

module.exports = new UserRepository();