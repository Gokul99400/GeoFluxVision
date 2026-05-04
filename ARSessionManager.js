/**
 * ar/ARSessionManager.js
 *
 * Manages the WebXR immersive-ar session lifecycle.
 * Requests hit-testing, dom-overlay, and plane-detection features.
 *
 * Usage:
 *   const ar = new ARSessionManager(renderer, camera);
 *   ar.onSessionStart = (session) => { ... };
 *   ar.onSessionEnd   = ()        => { ... };
 *   await ar.start();
 */
 
export class ARSessionManager {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera   = camera;
    this.session  = null;
    this.isActive = false;
 
    // Callbacks — set by consumer
    this.onSessionStart = null;
    this.onSessionEnd   = null;
    this.onHitTest      = null;   // (hitTestResults) => {}
 
    this._hitTestSource = null;
    this._referenceSpace = null;
 
    this._checkSupport();
  }
 
  // ── Internal: probe WebXR support ────────────────────────────────
  async _checkSupport() {
    if (!navigator.xr) {
      console.warn('[ARSessionManager] WebXR API not present');
      return;
    }
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    console.log('[ARSessionManager] immersive-ar supported:', supported);
  }
 
  // ── Public: start AR session ──────────────────────────────────────
  async start() {
    if (!navigator.xr) throw new Error('WebXR not available');
 
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported)  throw new Error('immersive-ar not supported');
 
    // Feature request list — graceful degradation for unsupported features
    const sessionInit = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: [
        'dom-overlay',
        'hit-test',
        'plane-detection',
        'depth-sensing',
      ],
      domOverlay: { root: document.getElementById('ar-overlay') },
    };
 
    this.session = await navigator.xr.requestSession('immersive-ar', sessionInit);
 
    // Reference space
    this._referenceSpace = await this.session.requestReferenceSpace('local-floor')
      .catch(() => this.session.requestReferenceSpace('local'));
 
    // Wire renderer
    await this.renderer.xr.setSession(this.session);
 
    this.isActive = true;
 
    // Hit-test source (optional)
    if (this.session.requestHitTestSource) {
      try {
        const viewerSpace = await this.session.requestReferenceSpace('viewer');
        this._hitTestSource = await this.session.requestHitTestSource({ space: viewerSpace });
      } catch (e) {
        console.warn('[ARSessionManager] Hit-test not available:', e.message);
      }
    }
 
    // Session end hook
    this.session.addEventListener('end', () => {
      this.isActive = false;
      this._hitTestSource = null;
      this._referenceSpace = null;
      this.session = null;
      if (this.onSessionEnd) this.onSessionEnd();
    });
 
    if (this.onSessionStart) this.onSessionStart(this.session);
  }
 
  // ── Public: end AR session ────────────────────────────────────────
  end() {
    if (this.session) {
      this.session.end();
    }
  }
 
  /**
   * Called each XR frame to process hit-test results.
   * @param {XRFrame} frame
   */
  processFrame(frame) {
    if (!this._hitTestSource || !this._referenceSpace) return;
    const hitResults = frame.getHitTestResults(this._hitTestSource);
    if (this.onHitTest && hitResults.length > 0) {
      this.onHitTest(hitResults, this._referenceSpace);
    }
  }
 
  // ── Utility: reference space accessor ────────────────────────────
  get referenceSpace() { return this._referenceSpace; }
}
