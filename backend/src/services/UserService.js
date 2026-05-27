// backend/services/UserService.js
const UserRepository = require('../repositories/UserRepository');
const { hashPassword, comparePassword } = require('../utils/jwt');
const logger = require('../utils/logger');
const AppError = require('../utils/errorHandler');

class UserService {
  async registerUser(userData) {
    try {
      const { email, name, password, organization_id } = userData;

      // Check if user already exists
      const existingUser = await UserRepository.findByEmail(email);
      if (existingUser) {
        throw new AppError('User with this email already exists', 409);
      }

      // Hash password
      const password_hash = await hashPassword(password);

      // Create user
      const userId = await UserRepository.create({
        email,
        name,
        password_hash,
        organization_id,
        role: 'user'
      });

      logger.info(`User registered: ${email}`);
      return { id: userId, email, name };
    } catch (error) {
      logger.error('Error registering user:', error);
      throw error;
    }
  }

  async loginUser(email, password) {
    try {
      const user = await UserRepository.findByEmail(email);
      if (!user) {
        throw new AppError('Invalid email or password', 401);
      }

      const isPasswordValid = await comparePassword(password, user.password_hash);
      if (!isPasswordValid) {
        throw new AppError('Invalid email or password', 401);
      }

      logger.info(`User logged in: ${email}`);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        organization_id: user.organization_id,
        role: user.role
      };
    } catch (error) {
      logger.error('Error logging in user:', error);
      throw error;
    }
  }

  async getUserById(userId) {
    try {
      const user = await UserRepository.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }
      return user;
    } catch (error) {
      logger.error('Error getting user:', error);
      throw error;
    }
  }

  async updateUser(userId, userData) {
    try {
      const user = await UserRepository.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const updatedUser = await UserRepository.update(userId, userData);
      logger.info(`User updated: ${userId}`);
      return updatedUser;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  async changePassword(userId, oldPassword, newPassword) {
    try {
      const user = await UserRepository.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const isPasswordValid = await comparePassword(oldPassword, user.password_hash);
      if (!isPasswordValid) {
        throw new AppError('Current password is incorrect', 401);
      }

      const newPasswordHash = await hashPassword(newPassword);
      await UserRepository.updatePassword(userId, newPasswordHash);

      logger.info(`Password changed for user: ${userId}`);
      return { message: 'Password changed successfully' };
    } catch (error) {
      logger.error('Error changing password:', error);
      throw error;
    }
  }

  async deleteUser(userId) {
    try {
      const user = await UserRepository.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      await UserRepository.delete(userId);
      logger.info(`User deleted: ${userId}`);
      return { message: 'User deleted successfully' };
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  async getOrganizationUsers(organizationId) {
    try {
      const users = await UserRepository.findByOrganization(organizationId);
      return users;
    } catch (error) {
      logger.error('Error getting organization users:', error);
      throw error;
    }
  }
}

module.exports = new UserService();