#!/usr/bin/env node
/**
 * RSC AI Model Uploader
 * Downloads YOLOv8n, YOLOv8n-pose, BlazeFace TFLite models
 * and uploads them to DO Spaces for the GitHub Actions build.
 *
 * Run once:
 *   SPACES_KEY=xxx SPACES_SECRET=xxx node scripts/upload-models.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SPACES_ENDPOINT = 'nyc3.digitaloceanspaces.com';
const SPACES_BUCKET = 'real-security-camera-recordings';
const SPACES_KEY = process.env.SPACES_KEY;
const SPACES_SECRET = process.env.SPACES_SECRET;

if (!SPACES_KEY || !SPACES_SECRET) {
  console.error('Set SPACES_KEY and SPACES_SECRET env vars first');
  process.exit(1);
}

const MODELS = [
  {
    name: 'yolov8n.tflite',
    url: 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n_full_integer_quant.tflite',
    size: '~6MB',
  },
  {
    name: 'yolov8n_pose.tflite',
    url: 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n-pose_full_integer_quant.tflite',
    size: '~7MB',
  },
  {
    name: 'blazeface.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    size: '~0.7MB',
  },
];

function download(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return download(res.headers.location, dest, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { fs.unlinkSync(dest); reject(err); });
  });
}

// Simple HMAC-SHA256 signing for DO Spaces (AWS S3 compatible)
const crypto = require('crypto');

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSignedHeaders(method, bucket, key, contentType, bodyHash, date) {
  const region = 'nyc3';
  const service = 's3';
  const host = `${bucket}.${SPACES_ENDPOINT}`;
  const dateStr = date.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const dateTimeStr = date.toISOString().replace(/[:-]|\.\d{3}/g, '');

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${dateTimeStr}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, `/${key}`, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const credentialScope = `${dateStr}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', dateTimeStr, credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SPACES_SECRET}`, dateStr), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    'Authorization': `AWS4-HMAC-SHA256 Credential=${SPACES_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': dateTimeStr,
    'Host': host,
  };
}

function upload(localPath, spacesKey) {
  return new Promise((resolve, reject) => {
    const body = fs.readFileSync(localPath);
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const date = new Date();
    const headers = getSignedHeaders('PUT', SPACES_BUCKET, spacesKey, 'application/octet-stream', bodyHash, date);
    headers['Content-Length'] = body.length;
    headers['x-amz-acl'] = 'public-read';

    const req = https.request({
      hostname: `${SPACES_BUCKET}.${SPACES_ENDPOINT}`,
      path: `/${spacesKey}`,
      method: 'PUT',
      headers,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Upload failed: ${res.statusCode} ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const modelsDir = path.join(__dirname, '../assets/models');
  fs.mkdirSync(modelsDir, { recursive: true });

  for (const model of MODELS) {
    const localPath = path.join(modelsDir, model.name);
    const spacesKey = `ai-models/${model.name}`;

    console.log(`\n${model.name} (${model.size})`);
    console.log(`  Downloading...`);
    await download(model.url, localPath);
    const sizeMB = (fs.statSync(localPath).size / 1e6).toFixed(1);
    console.log(`  Downloaded (${sizeMB}MB)`);

    console.log(`  Uploading to DO Spaces...`);
    await upload(localPath, spacesKey);
    console.log(`  Done -> https://${SPACES_BUCKET}.${SPACES_ENDPOINT}/${spacesKey}`);
  }
  console.log('\nAll models ready. GitHub Actions builds will fetch them automatically.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
