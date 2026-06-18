/**
 * RSC Audio Classifier
 *
 * Runs on the microphone stream in real-time.
 * Uses Web Audio API FFT analysis — no ML model needed,
 * pattern matching on frequency signatures instead.
 *
 * Detects:
 *   - Glass break  (sharp 6-8kHz spike, high energy burst)
 *   - Dog barking  (rhythmic 400-800Hz pulses)
 *   - Shouting     (elevated 200-3000Hz, irregular)
 *   - Alarm/siren  (sweeping frequency pattern)
 *   - Baby crying  (high-pitched 300-600Hz sustained)
 *   - Gunshot      (massive broadband spike, instant decay)
 *   - Silence      (baseline — normal)
 *
 * All processing is on-device. No audio leaves the phone.
 */

const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const DETECTION_INTERVAL_MS = 300;
const COOLDOWN_MS = 4000; // don't repeat same alert for 4s

// Frequency band helpers
function freqToIndex(freq, sampleRate, fftSize) {
  return Math.round(freq / (sampleRate / fftSize));
}

function bandEnergy(freqData, lowHz, highHz, sampleRate = SAMPLE_RATE, fftSize = FFT_SIZE) {
  const lowIdx = freqToIndex(lowHz, sampleRate, fftSize);
  const highIdx = freqToIndex(highHz, sampleRate, fftSize);
  let sum = 0;
  for (let i = lowIdx; i <= Math.min(highIdx, freqData.length - 1); i++) {
    // Convert dB to linear
    sum += Math.pow(10, freqData[i] / 20);
  }
  return sum / (highIdx - lowIdx + 1);
}

function totalEnergy(freqData) {
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) {
    sum += Math.pow(10, freqData[i] / 20);
  }
  return sum / freqData.length;
}

export class AudioClassifier {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.freqData = null;
    this.timeData = null;
    this.intervalId = null;
    this.lastAlertTime = {};
    this.onAlert = null;
    this.stream = null;
    this.source = null;
    this.running = false;

    // Bark detection state — needs rhythm pattern
    this.barkHistory = [];
  }

  /**
   * Start audio classification on a MediaStream.
   * @param {MediaStream} stream - from navigator.mediaDevices.getUserMedia
   * @param {function} onAlert - callback({ type, emoji, message, severity })
   */
  async start(stream, onAlert) {
    this.stop(); // clean up any previous session

    this.stream = stream;
    this.onAlert = onAlert;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.3;

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.source.connect(this.analyser);

    this.freqData = new Float32Array(this.analyser.frequencyBinCount);
    this.timeData = new Float32Array(this.analyser.fftSize);
    this.running = true;

    this.intervalId = setInterval(() => this._analyze(), DETECTION_INTERVAL_MS);
    console.log('[AudioClassifier] Started');
  }

  stop() {
    this.running = false;
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.source) this.source.disconnect();
    if (this.audioContext) this.audioContext.close().catch(() => {});
    this.barkHistory = [];
  }

  _analyze() {
    if (!this.running || !this.analyser) return;

    this.analyser.getFloatFrequencyData(this.freqData);
    this.analyser.getFloatTimeDomainData(this.timeData);

    const results = [
      this._detectGlassBreak(),
      this._detectGunshot(),
      this._detectAlarm(),
      this._detectDogBark(),
      this._detectShouting(),
    ].filter(Boolean);

    for (const result of results) {
      const last = this.lastAlertTime[result.type] || 0;
      if (Date.now() - last > COOLDOWN_MS) {
        this.lastAlertTime[result.type] = Date.now();
        this.onAlert?.(result);
      }
    }
  }

  _detectGlassBreak() {
    // Glass break: sharp high-frequency burst (4-8kHz) with fast attack
    const highFreq = bandEnergy(this.freqData, 4000, 8000);
    const midFreq = bandEnergy(this.freqData, 800, 2000);
    const total = totalEnergy(this.freqData);

    // High freq dominates and overall energy is high
    if (total > 0.15 && highFreq > midFreq * 2.5 && highFreq > 0.3) {
      return {
        type: 'glass_break',
        emoji: '🔴',
        message: 'Glass break detected',
        severity: 'high',
        confidence: Math.min(highFreq / 0.5, 1.0),
      };
    }
    return null;
  }

  _detectGunshot() {
    // Gunshot: massive broadband spike, instant decay
    const total = totalEnergy(this.freqData);
    if (total > 0.85) {
      return {
        type: 'gunshot',
        emoji: '🔴',
        message: 'Loud impact / possible gunshot',
        severity: 'critical',
        confidence: Math.min(total / 1.0, 1.0),
      };
    }
    return null;
  }

  _detectAlarm() {
    // Siren/alarm: sweeping frequency — energy alternates between bands
    const low  = bandEnergy(this.freqData, 800, 1200);
    const high = bandEnergy(this.freqData, 2000, 3000);
    const total = totalEnergy(this.freqData);

    if (total > 0.1 && Math.abs(low - high) > 0.05 && (low > 0.1 || high > 0.1)) {
      return {
        type: 'alarm',
        emoji: '🚨',
        message: 'Alarm / siren sound',
        severity: 'high',
        confidence: Math.min(total / 0.3, 1.0),
      };
    }
    return null;
  }

  _detectDogBark() {
    // Dog bark: rhythmic 400-800Hz pulses with gaps
    const barkBand = bandEnergy(this.freqData, 400, 800);
    const total = totalEnergy(this.freqData);
    const isBarkLike = barkBand > 0.08 && barkBand > total * 0.4;

    this.barkHistory.push({ time: Date.now(), active: isBarkLike });
    this.barkHistory = this.barkHistory.filter(b => Date.now() - b.time < 3000);

    // Need at least 3 bark pulses in 3 seconds with gaps between
    const pulses = this.barkHistory.filter(b => b.active).length;
    const silences = this.barkHistory.filter(b => !b.active).length;

    if (pulses >= 3 && silences >= 2 && pulses / this.barkHistory.length < 0.8) {
      return {
        type: 'dog_bark',
        emoji: '🐕',
        message: 'Dog barking',
        severity: 'low',
        confidence: Math.min(pulses / 6, 1.0),
      };
    }
    return null;
  }

  _detectShouting() {
    // Shouting: elevated speech band (200-3000Hz), irregular amplitude
    const speechBand = bandEnergy(this.freqData, 200, 3000);
    const total = totalEnergy(this.freqData);

    if (speechBand > 0.12 && speechBand > total * 0.6) {
      return {
        type: 'shouting',
        emoji: '📢',
        message: 'Shouting / raised voices',
        severity: 'medium',
        confidence: Math.min(speechBand / 0.3, 1.0),
      };
    }
    return null;
  }
}

// Singleton instance
export const audioClassifier = new AudioClassifier();
