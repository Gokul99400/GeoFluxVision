/**
 * sensors/SensorManager.js
 *
 * Abstracts raw magnetometer access with:
 *  • Generic Sensor API (Magnetometer) — primary
 *  • DeviceOrientationEvent absolute fallback
 *  • Moving-average smoother (window = 8 samples)
 *  • 1D Kalman filter per axis for stabilisation
 *  • Calibration: average of first N samples → baseline
 *
 * ── Kalman Filter (scalar, 1-D) ──────────────────────────────────
 *  State estimate:  x̂_k = x̂_{k-1} + K_k · (z_k − x̂_{k-1})
 *  Kalman gain:     K_k  = P_{k-1} / (P_{k-1} + R)
 *  Covariance update: P_k = (1 − K_k) · P_{k-1} + Q
 *  Q = process noise (how fast we expect the true value to change)
 *  R = measurement noise (sensor variance)
 *
 * ── Moving Average ───────────────────────────────────────────────
 *  Simple FIR: ȳ = (1/N) Σ y_{i}
 */
 
// ── Scalar Kalman Filter ──────────────────────────────────────────
class KalmanFilter1D {
  constructor(Q = 0.5, R = 10) {
    this.Q = Q;   // process noise
    this.R = R;   // measurement noise
    this.P = 1;   // error covariance
    this.x = 0;   // state estimate
  }
 
  update(z) {
    // Predict
    this.P += this.Q;
    // Update
    const K = this.P / (this.P + this.R);
    this.x  = this.x + K * (z - this.x);
    this.P  = (1 - K) * this.P;
    return this.x;
  }
 
  reset() { this.P = 1; this.x = 0; }
}
 
// ── Moving Average Ring Buffer ────────────────────────────────────
class MovingAverage {
  constructor(size = 8) {
    this.size   = size;
    this.buffer = [];
    this.sum    = 0;
  }
 
  push(v) {
    this.buffer.push(v);
    this.sum += v;
    if (this.buffer.length > this.size) {
      this.sum -= this.buffer.shift();
    }
    return this.sum / this.buffer.length;
  }
 
  reset() { this.buffer = []; this.sum = 0; }
}
 
// ── SensorManager ────────────────────────────────────────────────
export class SensorManager {
  static CALIBRATION_SAMPLES = 60;
  static NOISE_THRESHOLD      = 1.5;  // µT — ignore sub-noise anomalies
 
  constructor() {
    // Kalman filters per axis
    this._kx = new KalmanFilter1D();
    this._ky = new KalmanFilter1D();
    this._kz = new KalmanFilter1D();
 
    // Moving averages per axis
    this._mx = new MovingAverage(8);
    this._my = new MovingAverage(8);
    this._mz = new MovingAverage(8);
 
    this._sensor    = null;         // Magnetometer instance
    this._usingFallback = false;
    this._fallbackHandler = null;
 
    this._calibSamples  = [];
    this._baseline      = new THREE.Vector3(); // Earth's background field
    this._isCalibrated  = false;
 
    this._lastAnomaly   = new THREE.Vector3();
    this._lastRaw       = new THREE.Vector3();
 
    /** Callback: (anomaly:Vector3, raw:Vector3, calibProgress:number) */
    this.onReading = null;
  }
 
  // ── Start ───────────────────────────────────────────────────────
  async start() {
    if ('Magnetometer' in window) {
      await this._startGenericSensor();
    } else {
      console.warn('[SensorManager] Magnetometer API not found — using orientation fallback');
      this._startOrientationFallback();
    }
  }
 
  // ── Stop ────────────────────────────────────────────────────────
  stop() {
    if (this._sensor) {
      try { this._sensor.stop(); } catch (_) {}
    }
    if (this._fallbackHandler) {
      window.removeEventListener('deviceorientationabsolute', this._fallbackHandler);
      window.removeEventListener('deviceorientation', this._fallbackHandler);
      this._fallbackHandler = null;
    }
  }
 
  // ── Reset calibration ───────────────────────────────────────────
  reset() {
    this._calibSamples  = [];
    this._isCalibrated  = false;
    this._baseline.set(0, 0, 0);
    this._kx.reset(); this._ky.reset(); this._kz.reset();
    this._mx.reset(); this._my.reset(); this._mz.reset();
    console.log('[SensorManager] Calibration reset');
  }
 
  // ── Generic Sensor API ──────────────────────────────────────────
  async _startGenericSensor() {
    // Check permissions (required by spec)
    try {
      const perm = await navigator.permissions.query({ name: 'magnetometer' });
      if (perm.state === 'denied') {
        throw new Error('Magnetometer permission denied');
      }
    } catch (e) {
      // Some browsers don't support permission query for sensors — proceed anyway
      console.warn('[SensorManager] Permission query failed:', e.message);
    }
 
    try {
      this._sensor = new Magnetometer({ frequency: 60 });
      this._sensor.addEventListener('reading',  () => this._onGenericReading());
      this._sensor.addEventListener('error',    (e)  => this._onSensorError(e));
      this._sensor.start();
      console.log('[SensorManager] Magnetometer started');
    } catch (err) {
      console.error('[SensorManager] Could not create Magnetometer:', err);
      this._startOrientationFallback();
    }
  }
 
  // ── Generic Sensor reading ─────────────────────────────────────
  _onGenericReading() {
    const raw = new THREE.Vector3(
      this._sensor.x ?? 0,
      this._sensor.y ?? 0,
      this._sensor.z ?? 0,
    );
    this._processReading(raw);
  }
 
  // ── Orientation-based fallback ────────────────────────────────
  // DeviceOrientationEvent doesn't expose raw magnetometer, so we synthesise
  // a pseudo-field vector from the alpha (compass heading) angle.
  // This is less accurate but provides a visual fallback.
  _startOrientationFallback() {
    this._usingFallback = true;
    const EARTH_FIELD_STRENGTH = 40; // µT approximate
 
    this._fallbackHandler = (e) => {
      const alpha = (e.webkitCompassHeading ?? e.alpha ?? 0) * Math.PI / 180;
      const raw = new THREE.Vector3(
        EARTH_FIELD_STRENGTH * Math.cos(alpha),
        EARTH_FIELD_STRENGTH * Math.sin(alpha),
        20,
      );
      this._processReading(raw);
    };
 
    const evtName = 'ondeviceorientationabsolute' in window
      ? 'deviceorientationabsolute'
      : 'deviceorientation';
 
    window.addEventListener(evtName, this._fallbackHandler, { passive: true });
    console.log('[SensorManager] Orientation fallback listening on', evtName);
  }
 
  // ── Core processing pipeline ──────────────────────────────────
  _processReading(raw) {
    // ── 1. Kalman filter ──────────────────────────────────────
    const kx = this._kx.update(raw.x);
    const ky = this._ky.update(raw.y);
    const kz = this._kz.update(raw.z);
 
    // ── 2. Moving average ─────────────────────────────────────
    const sx = this._mx.push(kx);
    const sy = this._my.push(ky);
    const sz = this._mz.push(kz);
 
    const smoothed = new THREE.Vector3(sx, sy, sz);
 
    // ── 3. Calibration ────────────────────────────────────────
    if (!this._isCalibrated) {
      this._calibSamples.push(smoothed.clone());
      const progress = this._calibSamples.length / SensorManager.CALIBRATION_SAMPLES;
 
      if (this._calibSamples.length >= SensorManager.CALIBRATION_SAMPLES) {
        // Average samples → baseline (Earth's background + environmental offset)
        const sum = new THREE.Vector3();
        this._calibSamples.forEach(v => sum.add(v));
        this._baseline.copy(sum).divideScalar(this._calibSamples.length);
        this._isCalibrated = true;
        console.log('[SensorManager] Calibrated. Baseline:', this._baseline);
      }
 
      if (this.onReading) this.onReading(new THREE.Vector3(), raw, Math.min(progress, 1));
      return;
    }
 
    // ── 4. Remove baseline (anomaly = local disturbance) ─────
    const anomaly = smoothed.clone().sub(this._baseline);
 
    // ── 5. Noise gate ─────────────────────────────────────────
    if (anomaly.length() < SensorManager.NOISE_THRESHOLD) {
      anomaly.set(0, 0, 0);
    }
 
    this._lastAnomaly.copy(anomaly);
    this._lastRaw.copy(raw);
 
    if (this.onReading) this.onReading(anomaly, raw, 1);
  }
 
  // ── Error handler ─────────────────────────────────────────────
  _onSensorError(event) {
    console.error('[SensorManager] Sensor error:', event.error?.name, event.error?.message);
    this._startOrientationFallback();
  }
 
  get isCalibrated()  { return this._isCalibrated; }
  get usingFallback() { return this._usingFallback; }
}
