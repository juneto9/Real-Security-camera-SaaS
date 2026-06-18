import express from 'express';
import { readFileSync } from 'fs';

const router = express.Router();

const DO_SPACES = 'https://real-security-camera-recordings.nyc3.digitaloceanspaces.com';

// ── GET /api/mobile/latest ────────────────────────────────────────────────────
// Returns latest build info + download URLs.
// Used by the web dashboard "Download App" button and by GitHub Actions
// to check the current version.
router.get('/latest', (req, res) => {
  try {
    const info = JSON.parse(readFileSync('/opt/rsc-api/mobile-release.json', 'utf8'));
    res.json({
      ...info,
      download: {
        android: `${DO_SPACES}/releases/android/RSC-Real-Security-Cam-latest.apk`,
        ios: `${DO_SPACES}/releases/ios/RSC-Real-Security-Cam-latest.ipa`,
      },
      install_instructions: {
        android: 'Download APK, enable Unknown Sources in Android Settings, open and install.',
        ios: 'Requires TestFlight or enterprise certificate. Contact your admin.',
      },
    });
  } catch (e) {
    // No build info yet — return defaults
    res.json({
      version: 'not-yet-built',
      build_date: null,
      download: {
        android: `${DO_SPACES}/releases/android/RSC-Real-Security-Cam-latest.apk`,
        ios: `${DO_SPACES}/releases/ios/RSC-Real-Security-Cam-latest.ipa`,
      },
    });
  }
});

// ── GET /api/mobile/download/android ─────────────────────────────────────────
// Direct redirect to the latest Android APK on DO Spaces.
// Share this URL — it always points to the latest build.
router.get('/download/android', (req, res) => {
  res.redirect(302, `${DO_SPACES}/releases/android/RSC-Real-Security-Cam-latest.apk`);
});

// ── GET /api/mobile/download/ios ──────────────────────────────────────────────
router.get('/download/ios', (req, res) => {
  res.redirect(302, `${DO_SPACES}/releases/ios/RSC-Real-Security-Cam-latest.ipa`);
});

export default router;
