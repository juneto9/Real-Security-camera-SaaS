import crypto from 'crypto';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input));
  return buf.toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

export function generateToken({ identity, room, canPublish = false, canSubscribe = true }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: API_KEY,
    sub: identity,
    iat: now,
    exp: now + 3600,
    nbf: now,
    video: {
      roomJoin: true,
      room,
      canPublish,
      canSubscribe,
      canPublishData: canPublish,
    },
  };
  const data = base64url(header) + '.' + base64url(payload);
  const sig = crypto.createHmac('sha256', API_SECRET).update(data).digest();
  return data + '.' + base64url(sig);
}
