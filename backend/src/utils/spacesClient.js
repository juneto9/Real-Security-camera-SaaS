const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');
const logger = require('../utils/logger');

const s3Client = new S3Client({
  endpoint: config.STORAGE.endpoint,
  region: config.STORAGE.region,
  credentials: {
    accessKeyId: config.STORAGE.accessKeyId,
    secretAccessKey: config.STORAGE.secretAccessKey,
  },
  forcePathStyle: false,
});

// Upload a file buffer
const uploadFile = async (buffer, key, contentType = 'video/mp4') => {
  try {
    const command = new PutObjectCommand({
      Bucket: config.STORAGE.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'private',
    });
    await s3Client.send(command);
    const url = `${config.STORAGE.endpoint}/${config.STORAGE.bucket}/${key}`;
    logger.info('File uploaded to Spaces', { key, url });
    return url;
  } catch (err) {
    logger.error('Error uploading to Spaces', { error: err.message, key });
    throw err;
  }
};

// Generate a presigned URL for secure playback (expires in 1 hour)
const getPresignedUrl = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: config.STORAGE.bucket,
      Key: key,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (err) {
    logger.error('Error generating presigned URL', { error: err.message, key });
    throw err;
  }
};

// Delete a file
const deleteFile = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: config.STORAGE.bucket,
      Key: key,
    });
    await s3Client.send(command);
    logger.info('File deleted from Spaces', { key });
    return true;
  } catch (err) {
    logger.error('Error deleting from Spaces', { error: err.message, key });
    throw err;
  }
};

// Generate a storage key for a recording
const getRecordingKey = (organizationId, deviceId, recordingId) => {
  const date = new Date().toISOString().split('T')[0];
  return `recordings/${organizationId}/${deviceId}/${date}/${recordingId}.mp4`;
};

// Generate a storage key for a motion snapshot
const getSnapshotKey = (organizationId, deviceId, eventId) => {
  const date = new Date().toISOString().split('T')[0];
  return `snapshots/${organizationId}/${deviceId}/${date}/${eventId}.jpg`;
};

// Test the connection
const testConnection = async () => {
  try {
    const { ListBucketsCommand } = require('@aws-sdk/client-s3');
    await s3Client.send(new ListBucketsCommand({}));
    logger.info('Spaces connection successful');
    return true;
  } catch (err) {
    logger.error('Spaces connection failed', { error: err.message });
    return false;
  }
};

module.exports = {
  s3Client,
  uploadFile,
  getPresignedUrl,
  deleteFile,
  getRecordingKey,
  getSnapshotKey,
  testConnection,
};
