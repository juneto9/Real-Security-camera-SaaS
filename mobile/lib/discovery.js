/**
 * RSC Network Discovery — Platform Router
 *
 * React Native automatically selects the platform-specific file:
 *   discovery.android.js  → used on Android
 *   discovery.ios.js      → used on iOS
 *
 * This file is the fallback for any other platform (web preview, etc.)
 * and also re-exports everything so imports stay clean:
 *
 *   import { runDiscovery, startAutoDiscovery } from '../lib/discovery';
 *
 * React Native resolves this at bundle time — zero runtime overhead.
 */

export async function runDiscovery({ onProgress, onComplete } = {}) {
  onProgress?.('Discovery not available on this platform');
  onComplete?.({ found: 0, posted: 0 });
}

export function startAutoDiscovery() {
  return () => {};
}
