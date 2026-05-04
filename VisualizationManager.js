/**
 * visualization/VisualizationManager.js
 *
 * Renders:
 *  • Pooled ArrowHelper objects (field direction + strength)
 *  • Particle trail system (BufferGeometry, Points)
 *  • Optional magnetic field grid
 *  • Wave distortion ring (animated torus)
 *
 * Performance notes
 * ─────────────────
 * • ArrowHelper pool is pre-allocated; we recycle instead of creating new.
 * • Particle buffer is pre-allocated; we write into it each frame.
 * • Geometry/material disposal is called on clear().
 *
 * Colour encoding (HSL)
 * ─────────────────────
 *  strength   hue (°)   appearance
 *  0 µT       120°      green   (no anomaly)
 *  40 µT      60°       yellow  (moderate)
 *  80+ µT     0°        red     (strong)
 *
 *  H = clamp(0.33 − strength × 0.004, 0, 0.33)
 */
 
// ── Constants ──────────────────────────────────────────────────────
const ARROW_POOL_SIZE   = 60;
const MAX_PARTICLES     = 800;
const PARTICLE_LIFETIME = 90; // frames
const GRID_SIZE         = 9;  // 9×9 grid
const GRID_STEP         = 0.4; // metres between grid nodes
 
// ── Helper: strength → THREE.Color ─────────────────────────────────
function strengthToColor(strength, maxStrength = 80) {
  const t = Math.min(strength / maxStrength, 1); // 0=weak, 1=strong
  const h = (1 - t) * 0.33;                       // 0.33=green → 0=red
  return new THREE.Color().setHSL(h, 1, 0.55);
}
 
// ── Particle entry ──────────────────────────────────────────────────
class Particle {
  constructor() {
    this.pos      = new THREE.Vector3();
    this.vel      = new THREE.Vector3();
    this.life     = 0;   // 0 = dead
    this.maxLife  = PARTICLE_LIFETIME;
  }
}
 
// ── VisualizationManager ────────────────────────────────────────────
export class VisualizationManager {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene       = scene;
    this.fallback    = false;  // non-AR mode flag
 
    // ── Arrow pool ──────────────────────────────────────────────
    this._arrowPool   = [];
    this._activeArrows = [];
    this._arrowCursor  = 0;
    this._buildArrowPool();
 
    // ── Particle system ─────────────────────────────────────────
    this._particles     = Array.from({ length: MAX_PARTICLES }, () => new Particle());
    this._particlePositions = new Float32Array(MAX_PARTICLES * 3);
    this._particleColors    = new Float32Array(MAX_PARTICLES * 3);
    this._particleGeo   = new THREE.BufferGeometry();
    this._particleGeo.setAttribute('position', new THREE.BufferAttribute(this._particlePositions, 3));
    this._particleGeo.setAttribute('color',    new THREE.BufferAttribute(this._particleColors,    3));
    this._particleMat   = new THREE.PointsMaterial({
      size:           0.012,
      vertexColors:   true,
      transparent:    true,
      opacity:        0.75,
      sizeAttenuation: true,
      depthWrite:     false,
    });
    this._particleSystem = new THREE.Points(this._particleGeo, this._particleMat);
    this.scene.add(this._particleSystem);
 
    // ── Wave ring ────────────────────────────────────────────────
    this._waveRing     = null;
    this._waveActive   = false;
    this._waveTimer    = 0;
    this._buildWaveRing();
 
    // ── Grid ────────────────────────────────────────────────────
    this._gridGroup    = null;
    this._gridVisible  = false;
 
    // ── State ────────────────────────────────────────────────────
    this._frame        = 0;
    this._lastStrength = 0;
  }
 
  // ── Build arrow pool ────────────────────────────────────────────
  _buildArrowPool() {
    const dir    = new THREE.Vector3(0, 1, 0);
    const origin = new THREE.Vector3(0, 0, 0);
 
    for (let i = 0; i < ARROW_POOL_SIZE; i++) {
      const arrow = new THREE.ArrowHelper(dir, origin, 0.2, 0x00ff88, 0.08, 0.05);
      arrow.visible = false;
      this.scene.add(arrow);
      this._arrowPool.push(arrow);
    }
  }
 
  // ── Get next pooled arrow ────────────────────────────────────────
  _getArrow() {
    const arrow = this._arrowPool[this._arrowCursor];
    this._arrowCursor = (this._arrowCursor + 1) % ARROW_POOL_SIZE;
    return arrow;
  }
 
  // ── Build wave ring ──────────────────────────────────────────────
  _buildWaveRing() {
    const geo = new THREE.TorusGeometry(0.15, 0.005, 8, 64);
    const mat = new THREE.MeshBasicMaterial({
      color:       0x00c8ff,
      transparent: true,
      opacity:     0.0,
      depthWrite:  false,
    });
    this._waveRing = new THREE.Mesh(geo, mat);
    this.scene.add(this._waveRing);
  }
 
  // ── Build/destroy field grid ─────────────────────────────────────
  toggleGrid() {
    if (this._gridGroup) {
      this.scene.remove(this._gridGroup);
      this._gridGroup.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this._gridGroup = null;
      this._gridVisible = false;
      return;
    }
 
    this._gridGroup   = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x003344, transparent: true, opacity: 0.4 });
 
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const x = (i - GRID_SIZE / 2) * GRID_STEP;
        const z = (j - GRID_SIZE / 2) * GRID_STEP;
        const pts = [
          new THREE.Vector3(x, 0, z),
          new THREE.Vector3(x + GRID_STEP, 0, z),
          new THREE.Vector3(x + GRID_STEP, 0, z + GRID_STEP),
          new THREE.Vector3(x, 0, z + GRID_STEP),
          new THREE.Vector3(x, 0, z),
        ];
        const geo  = new THREE.BufferGeometry().setFromPoints(pts);
        this._gridGroup.add(new THREE.Line(geo, lineMat));
      }
    }
 
    this._gridGroup.position.y = -0.5;
    this.scene.add(this._gridGroup);
    this._gridVisible = true;
  }
 
  // ── Main update — called every sensor reading ─────────────────────
  /**
   * @param {THREE.Vector3} worldAnomaly  Anomaly in world space (µT)
   * @param {THREE.Vector3} cameraPos     Camera world position
   */
  update(worldAnomaly, cameraPos) {
    this._frame++;
    const strength = worldAnomaly.length();
    this._lastStrength = strength;
 
    // 1. Arrow
    if (strength > 0.5) {
      const arrow   = this._getArrow();
      const color   = strengthToColor(strength);
      const length  = Math.min(0.05 + strength * 0.006, 0.6);
      const dir     = worldAnomaly.clone().normalize();
 
      arrow.position.copy(cameraPos).addScaledVector(dir, 0.3);
      arrow.setDirection(dir);
      arrow.setLength(length, length * 0.3, length * 0.15);
      arrow.setColor(color);
      arrow.visible = true;
 
      // Auto-fade after N frames
      arrow._expireAt = this._frame + 40;
    }
 
    // Expire old arrows
    for (const arrow of this._arrowPool) {
      if (arrow.visible && arrow._expireAt !== undefined && this._frame > arrow._expireAt) {
        arrow.visible = false;
      }
    }
 
    // 2. Particles — spawn proportional to strength
    const spawnCount = Math.floor(strength * 0.3);
    for (let i = 0; i < spawnCount; i++) {
      this._spawnParticle(cameraPos, worldAnomaly);
    }
    this._updateParticles();
 
    // 3. Wave ring — pulse on strong field
    if (strength > 60) {
      this._pulseWave(cameraPos, strength);
    }
    this._animateWave();
  }
 
  // ── Particle helpers ─────────────────────────────────────────────
  _spawnParticle(origin, velocity) {
    // Find a dead particle
    for (const p of this._particles) {
      if (p.life <= 0) {
        p.pos.copy(origin).addScaledVector(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.1,
            (Math.random() - 0.5) * 0.1,
            (Math.random() - 0.5) * 0.1,
          ), 1,
        );
        p.vel.copy(velocity).normalize().multiplyScalar(0.002 + Math.random() * 0.003);
        p.life    = p.maxLife;
        return;
      }
    }
  }
 
  _updateParticles() {
    let writeIdx = 0;
    const pos = this._particlePositions;
    const col = this._particleColors;
 
    for (const p of this._particles) {
      if (p.life > 0) {
        p.life--;
        p.pos.add(p.vel);
 
        const t  = p.life / p.maxLife;   // 1=fresh → 0=dying
        const c  = strengthToColor(this._lastStrength);
 
        pos[writeIdx    ] = p.pos.x;
        pos[writeIdx + 1] = p.pos.y;
        pos[writeIdx + 2] = p.pos.z;
 
        col[writeIdx    ] = c.r * t;
        col[writeIdx + 1] = c.g * t;
        col[writeIdx + 2] = c.b * t;
      } else {
        // Hide dead particle at infinity
        pos[writeIdx    ] = 1e6;
        pos[writeIdx + 1] = 1e6;
        pos[writeIdx + 2] = 1e6;
      }
      writeIdx += 3;
    }
 
    this._particleGeo.attributes.position.needsUpdate = true;
    this._particleGeo.attributes.color.needsUpdate    = true;
  }
 
  // ── Wave ring pulse ──────────────────────────────────────────────
  _pulseWave(position, strength) {
    if (!this._waveActive) {
      this._waveRing.position.copy(position);
      this._waveTimer   = 0;
      this._waveActive  = true;
    }
  }
 
  _animateWave() {
    if (!this._waveActive) return;
    this._waveTimer++;
    const t = this._waveTimer / 60;
    const scale  = 1 + t * 4;
    const opacity = Math.max(0, 0.6 - t * 0.7);
    this._waveRing.scale.setScalar(scale);
    this._waveRing.material.opacity = opacity;
    if (opacity <= 0) this._waveActive = false;
  }
 
  // ── Clear all visuals ────────────────────────────────────────────
  clear() {
    for (const arrow of this._arrowPool) arrow.visible = false;
    for (const p of this._particles)     p.life = 0;
    this._waveActive = false;
    this._waveRing.material.opacity = 0;
    this._updateParticles();
  }
 
  setFallbackMode(v) { this.fallback = v; }
}
 
