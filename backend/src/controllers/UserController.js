// backend/controllers/UserController.js
const UserService = require('../services/UserService');
const { generateToken } = require('../utils/jwt');
const logger = require('../utils/logger');
const AppError = require('../utils/errorHandler');

class UserController {
  async register(req, res, next) {
    try {
      const { email, name, password, organization_id } = req.body;

      const user = await UserService.registerUser({
        email,
        name,
        password,
        organization_id
      });

      const token = generateToken(user.id, user.organization_id);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user,
          token
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const user = await UserService.loginUser(email, password);
      const token = generateToken(user.id, user.organization_id);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user,
          token
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async getProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const user = await UserService.getUserById(userId);

      res.status(200).json({
        success: true,
        data: user
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const { name, email } = req.body;

      const updatedUser = await UserService.updateUser(userId, { name, email });

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: updatedUser
      });
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req, res, next) {
    try {
      const userId = req.user.id;
      const { oldPassword, newPassword } = req.body;

      await UserService.changePassword(userId, oldPassword, newPassword);

      res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteAccount(req, res, next) {
    try {
      const userId = req.user.id;
      await UserService.deleteUser(userId);

      res.status(200).json({
        success: true,
        message: 'Account deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async getOrganizationUsers(req, res, next) {
    try {
      const organizationId = req.user.organization_id;
      const users = await UserService.getOrganizationUsers(organizationId);

      res.status(200).json({
        success: true,
        data: users
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();