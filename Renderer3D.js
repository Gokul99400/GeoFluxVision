erer3d · JS
Copy

/**
 * visualization/Renderer3D.js
 *
 * Sets up the Three.js WebGLRenderer, scene, camera, and lighting.
 * Drives the XR animation loop (renderer.setAnimationLoop).
 * Exposes an onFrame(fps) callback for HUD updates.
 */
 
export class Renderer3D {
  constructor() {
    // Scene
    this.scene  = new THREE.Scene();
 
    // Camera — WebXR overrides its pose each frame automatically
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      50,
    );
 
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias:   true,
      alpha:       true,    // transparent background for AR pass-through
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace ?? THREE.sRGBEncoding;
    this.renderer.domElement.className = 'threejs-canvas';
    document.body.insertBefore(this.renderer.domElement, document.body.firstChild);
 
    // Minimal ambient light (AR pass-through = real world is "lighting")
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);
 
    // FPS tracking
    this._lastTime = performance.now();
    this._frameCount = 0;
    this._fps = 60;
 
    this.onFrame = null; // (fps:number) callback
 
    window.addEventListener('resize', () => this._onResize());
  }
 
  // ── Start WebXR render loop ───────────────────────────────────
  startRenderLoop(session) {
    this.renderer.xr.setSession(session);
    this.renderer.setAnimationLoop((time, frame) => {
      this._tick(time, frame);
    });
    console.log('[Renderer3D] XR render loop started');
  }
 
  // ── Start fallback (non-XR) render loop ──────────────────────
  startFallbackLoop() {
    this.renderer.setAnimationLoop((time) => {
      this._tick(time, null);
    });
    console.log('[Renderer3D] Fallback render loop started');
  }
 
  // ── Stop loop ─────────────────────────────────────────────────
  stopRenderLoop() {
    this.renderer.setAnimationLoop(null);
    console.log('[Renderer3D] Render loop stopped');
  }
 
  // ── Per-frame tick ────────────────────────────────────────────
  _tick(time, _frame) {
    // FPS calculation
    this._frameCount++;
    const elapsed = time - this._lastTime;
    if (elapsed >= 500) {
      this._fps = Math.round((this._frameCount * 1000) / elapsed);
      this._frameCount = 0;
      this._lastTime   = time;
      if (this.onFrame) this.onFrame(this._fps);
    }
 
    this.renderer.render(this.scene, this.camera);
  }
 
  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
