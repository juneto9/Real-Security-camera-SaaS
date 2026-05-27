// In your controllers or services
const UserRepository = require('../repositories/UserRepository');
const DeviceRepository = require('../repositories/DeviceRepository');
const RecordingRepository = require('../repositories/RecordingRepository');

// Find user
const user = await UserRepository.findByEmail('user@example.com');

// Create device
const deviceId = await DeviceRepository.create({
  name: 'Front Door Camera',
  serial_number: 'ABC123',
  organization_id: 1,
  stream_url: 'rtsp://camera.local/stream'
});

// Get recordings for device
const recordings = await RecordingRepository.findByDevice(deviceId, 50, 0);