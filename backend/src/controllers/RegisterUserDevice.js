// In your controllers
const UserService = require('../services/UserService');
const DeviceService = require('../services/DeviceService');
const RecordingService = require('../services/RecordingService');

// Register user
const user = await UserService.registerUser({
  email: 'user@example.com',
  name: 'John Doe',
  password: 'securePassword',
  organization_id: 1
});

// Register device
const device = await DeviceService.registerDevice({
  name: 'Front Door',
  stream_url: 'rtsp://camera.local/stream',
  location: 'Main Entrance'
}, organizationId);

// Get recordings
const recordings = await RecordingService.getDeviceRecordings(
  deviceId,
  organizationId,
  50,
  0
);