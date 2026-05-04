/**
 * app.js — Entry Point
 * Magnetic Field AR Visualizer
 *
 * Wires together:
 *  • ARSessionManager  (WebXR lifecycle)
 *  • SensorManager     (Magnetometer / device-orientation fallback)
 *  • Renderer3D        (Three.js scene & render loop)
 *  • VisualizationManager (arrows, particles, grid)
 *  • UIManager         (HUD, graphs, compass, status)
 *  • DataExporter      (JSON/CSV export + session storage)
 *
 * Physics quick-reference
 * ────────────────────────
 * Earth's field ≈ 25–65 µT.  Anomaly = raw − baseline.
 * We rotate the sensor vector (device frame → world frame)
 * using the camera's quaternion Q:  v_world = Q · v_sensor · Q*
 *
 * Coordinate frames:
 *  • Sensor  : +X right, +Y up, +Z toward user  (device)
 *  • WebXR   : +X right, +Y up, −Z forward      (right-hand)
 *
 * Arrow colour encoding:  H = 0.33 − strength×0.005  (green→red in HSL)
 */
 
import { ARSessionManager }     from './ar/ARSessionManager.js';
import { SensorManager }        from './sensors/SensorManager.js';
import { Renderer3D }           from './visualization/Renderer3D.js';
import { VisualizationManager } from './visualization/VisualizationManager.js';
import { UIManager }            from './ui/UIManager.js';
import { DataExporter }         from './utils/DataExporter.js';
import { checkCompatibility }   from './utils/CompatibilityChecker.js';
 
// ── Boot ──────────────────────────────────────────────────────────────
async function boot() {
  console.log('[MAG-AR] Booting…');
 
  // 1. Compatibility
  const compat = checkCompatibility();
  console.log('[MAG-AR] Compat:', compat);
 
  // 2. Core systems
  const ui      = new UIManager();
  const r3d     = new Renderer3D();
  const vis     = new VisualizationManager(r3d.scene);
  const sensor  = new SensorManager();
  const ar      = new ARSessionManager(r3d.renderer, r3d.camera);
  const exporter = new DataExporter();
 
  ui.setStatus(compat.webxr ? 'Ready — tap ENTER AR' : 'WebXR not found — limited mode');
 
  // 3. Sensor → Visualization pipeline
  sensor.onReading = (anomaly, rawMag, calibProgress) => {
    // anomaly  : THREE.Vector3 (µT, device frame)
    // rawMag   : THREE.Vector3 (µT, device frame, unfiltered)
    // calibProgress: 0–1
 
    ui.updateCalibration(calibProgress);
 
    if (calibProgress < 1) return; // still calibrating
 
    // Rotate anomaly into world space using camera quaternion
    const worldAnomaly = anomaly.clone().applyQuaternion(r3d.camera.quaternion);
 
    // Feed visualizer
    vis.update(worldAnomaly, r3d.camera.position);
 
    // HUD
    const strength = anomaly.length();
    ui.updateFieldStrength(strength);
    ui.pushGraphSample(strength);
    ui.updateCompass(rawMag);
 
    // Audio alert on strong field
    if (strength > 80) ui.triggerAlert();
 
    // Log for export
    exporter.record({ t: Date.now(), anomaly, raw: rawMag });
  };
 
  // 4. AR session lifecycle
  ar.onSessionStart = (session) => {
    sensor.start();
    ui.setARMode(true);
    ui.setStatus('Calibrating… hold device still');
    r3d.startRenderLoop(session);
    console.log('[MAG-AR] AR session started');
  };
 
  ar.onSessionEnd = () => {
    sensor.stop();
    sensor.reset();
    vis.clear();
    ui.setARMode(false);
    ui.setStatus('Session ended');
    ui.resetCalibration();
    r3d.stopRenderLoop();
    console.log('[MAG-AR] AR session ended');
  };
 
  // 5. Button handlers
  document.getElementById('btn-ar').addEventListener('click', () => {
    if (ar.isActive) {
      ar.end();
    } else {
      ar.start().catch(err => {
        console.warn('[MAG-AR] AR start failed:', err.message);
        // Fallback: run without AR (desktop / unsupported)
        sensor.start();
        vis.setFallbackMode(true);
        r3d.startFallbackLoop();
        ui.setStatus('Running in fallback (no AR)');
        ui.setARMode(true);
      });
    }
  });
 
  document.getElementById('btn-recal').addEventListener('click', () => {
    sensor.reset();
    vis.clear();
    ui.resetCalibration();
    ui.setStatus('Recalibrating…');
  });
 
  document.getElementById('btn-export').addEventListener('click', () => {
    exporter.exportCSV();
  });
 
  // 6. Render FPS display
  r3d.onFrame = (fps) => ui.updateFPS(fps);
 
  console.log('[MAG-AR] Boot complete');
}
 
boot();
 
