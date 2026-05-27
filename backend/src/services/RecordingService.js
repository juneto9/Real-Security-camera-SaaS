// backend/services/RecordingService.js
const RecordingRepository = require('../repositories/RecordingRepository');
const logger = require('../utils/logger');
const AppError = require('../utils/errorHandler');
const AWS = require('aws-sdk');
const config = require('../config');

const s3 = new AWS.S3({
  accessKeyId: config.aws.accessKeyId,
  secretAccessKey: config.aws.secretAccessKey
});

class RecordingService {
  async createRecording(recordingData, organizationId) {
    try {
      const {
        device_id,
        duration,
        file_size,
        recording_type,
        start_time,
        end_time,
        s3_key,
        s3_url
      } = recordingData;

      // Validate recording data
      if (!device_id || !duration || !start_time || !end_time) {
        throw new AppError('Missing required recording data', 400);
      }

      const recordingId = await RecordingRepository.create({
        device_id,
        organization_id: organizationId,
        s3_key,
        s3_url,
        duration,
        file_size,
        recording_type: recording_type || 'continuous',
        start_time,
        end_time
      });

      logger.info(`Recording created: ${recordingId}`);
      return { id: recordingId, s3_url };
    } catch (error) {
      logger.error('Error creating recording:', error);
      throw error;
    }
  }

  async getRecordingById(recordingId, organizationId) {
    try {
      const recording = await RecordingRepository.findById(recordingId);
      if (!recording) {
        throw new AppError('Recording not found', 404);
      }

      if (recording.organization_id !== organizationId) {
        throw new AppError('Unauthorized access to recording', 403);
      }

      return recording;
    } catch (error) {
      logger.error('Error getting recording:', error);
      throw error;
    }
  }

  async getDeviceRecordings(deviceId, organizationId, limit = 50, offset = 0) {
    try {
      const recordings = await RecordingRepository.findByDevice(deviceId, limit, offset);
      const total = await RecordingRepository.countByDevice(deviceId);

      return {
        recordings,
        total,
        limit,
        offset
      };
    } catch (error) {
      logger.error('Error getting device recordings:', error);
      throw error;
    }
  }

  async getOrganizationRecordings(organizationId, limit = 100, offset = 0) {
    try {
      const recordings = await RecordingRepository.findByOrganization(
        organizationId,
        limit,
        offset
      );
      return recordings;
    } catch (error) {
      logger.error('Error getting organization recordings:', error);
      throw error;
    }
  }

  async getRecordingsByDateRange(deviceId, startDate, endDate, organizationId) {
    try {
      // Validate dates
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start > end) {
        throw new AppError('Start date must be before end date', 400);
      }

      const recordings = await RecordingRepository.findByDateRange(deviceId, start, end);
      return recordings;
    } catch (error) {
      logger.error('Error getting recordings by date range:', error);
      throw error;
    }
  }

  async getRecordingsByType(deviceId, recordingType, organizationId) {
    try {
      const validTypes = ['continuous', 'motion', 'manual'];
      if (!validTypes.includes(recordingType)) {
        throw new AppError('Invalid recording type', 400);
      }

      const recordings = await RecordingRepository.findByType(deviceId, recordingType);
      return recordings;
    } catch (error) {
      logger.error('Error getting recordings by type:', error);
      throw error;
    }
  }

  async deleteRecording(recordingId, organizationId) {
    try {
      const recording = await RecordingRepository.findById(recordingId);
      if (!recording) {
        throw new AppError('Recording not found', 404);
      }

      if (recording.organization_id !== organizationId) {
        throw new AppError('Unauthorized access to recording', 403);
      }

      // Delete from S3
      if (recording.s3_key) {
        await this.deleteFromS3(recording.s3_key);
      }

      await RecordingRepository.delete(recordingId);
      logger.info(`Recording deleted: ${recordingId}`);
      return { message: 'Recording deleted successfully' };
    } catch (error) {
      logger.error('Error deleting recording:', error);
      throw error;
    }
  }

  async getRecordingUrl(recordingId, organizationId, expiresIn = 3600) {
    try {
      const recording = await this.getRecordingById(recordingId, organizationId);

      if (!recording.s3_key) {
        throw new AppError('Recording file not found', 404);
      }

      // Generate presigned URL
      const url = s3.getSignedUrl('getObject', {
        Bucket: config.aws.s3Bucket,
        Key: recording.s3_key,
        Expires: expiresIn
      });

      return { url, expiresIn };
    } catch (error) {
      logger.error('Error getting recording URL:', error);
      throw error;
    }
  }

  async deleteFromS3(s3Key) {
    try {
      await s3.deleteObject({
        Bucket: config.aws.s3Bucket,
        Key: s3Key
      }).promise();
      logger.info(`File deleted from S3: ${s3Key}`);
    } catch (error) {
      logger.error('Error deleting from S3:', error);
      throw error;
    }
  }

  async cleanupOldRecordings(organizationId, daysOld = 30) {
    try {
      await RecordingRepository.deleteOldRecordings(organizationId, daysOld);
      logger.info(`Old recordings cleaned up for organization: ${organizationId}`);
      return { message: `Recordings older than ${daysOld} days deleted` };
    } catch (error) {
      logger.error('Error cleaning up old recordings:', error);
      throw error;
    }
  }

  async getRecordingStats(organizationId) {
    try {
      // TODO: Implement stats calculation
      return {
        totalRecordings: 0,
        totalStorageUsed: 0,
        averageRecordingDuration: 0
      };
    } catch (error) {
      logger.error('Error getting recording stats:', error);
      throw error;
    }
  }
}

module.exports = new RecordingService();