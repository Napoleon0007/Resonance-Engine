// CameraDirector — slow orbital drift around a focus point that eases toward
// the most energetic body, trauma-based shake on kicks, punch-in, and DOF
// focus distance + screen-space impact point for the post stack.

import * as THREE from 'three';

// the cinematographer's shot vocabulary: scale radius/height/orbit speed,
// optionally add a vertical sweep. The director picks per musical intensity.
const SHOTS = {
  orbit: { rad: 1.1, h: 1.0, speed: 1.0, sweep: 0 },
  drift: { rad: 1.28, h: 1.1, speed: 0.35, sweep: 0 },
  dolly: { rad: 0.95, h: 0.9, speed: 0.5, sweep: 0 },   // pulled back: never crowds the subject
  crane: { rad: 1.15, h: 1.0, speed: 0.8, sweep: 1.0 },
  flyby: { rad: 0.9, h: 0.75, speed: 2.2, sweep: 0.3 }, // was a tight close-up; now a wide pass
};
const CALM_SHOTS = ['drift', 'orbit', 'dolly'];
const HOT_SHOTS = ['flyby', 'crane', 'dolly', 'orbit'];

export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.focus = new THREE.Vector3(0, 0, 0);
    this.smoothedFocus = new THREE.Vector3(0, 0, 0);
    this.orbitAngle = 0;
    this.baseRadius = 24;
    this.radius = 24;
    this.height = 7;
    this.punch = 0;
    this.trauma = 0;          // 0..1, shake amplitude = trauma^2
    this._shakeT = Math.PI;   // phase for pseudo-noise shake
    this._proj = new THREE.Vector3();
    this.shot = SHOTS.orbit;
    this._shotName = 'orbit';
    this._sweepT = 0;
    this._radScale = 1; this._hScale = 1; this._speedScale = 1;
  }

  // pick a new camera move to match the music's intensity
  changeShot(energy) {
    const pool = (energy > 0.32 ? HOT_SHOTS : CALM_SHOTS).filter(s => s !== this._shotName);
    this._shotName = pool[Math.floor(Math.random() * pool.length)];
    this.shot = SHOTS[this._shotName];
    this._sweepT = 0;
  }

  configure({ radius = 24, height = 7, spin = 1, angle = null } = {}) {
    this.baseRadius = radius;
    this.height = height;
    this.spinScale = spin;      // 0 locks the orbit (front-on scenes)
    if (angle !== null) this.orbitAngle = angle;
  }

  onKick(strength) {
    // gentle punch-in — was lurching the camera in too far on every hit
    this.punch = Math.min(1.0, this.punch + strength * 0.18);
    this.trauma = Math.min(0.7, this.trauma + strength * 0.18);
  }

  // distance from camera to current focus — feeds depth of field
  focusDistance() {
    return this.camera.position.distanceTo(this.smoothedFocus);
  }

  // where the action is on screen (0..1 uv) — feeds the shockwave center
  screenFocus() {
    this._proj.copy(this.smoothedFocus).project(this.camera);
    return new THREE.Vector2(
      THREE.MathUtils.clamp(this._proj.x * 0.5 + 0.5, 0.1, 0.9),
      THREE.MathUtils.clamp(this._proj.y * 0.5 + 0.5, 0.1, 0.9),
    );
  }

  update(dt, scene, audio) {
    const { point, energy } = scene.hottestPoint();
    // only chase genuinely hot action; otherwise drift back to centre
    const target = energy > 4 ? point : new THREE.Vector3(0, 0, 0);
    target.clampLength(0, 26); // never chase a runaway body out of the arena
    this.focus.lerp(target, 1 - Math.exp(-dt * 1.2));
    this.smoothedFocus.lerp(this.focus, 1 - Math.exp(-dt * 2.5));

    // ease toward the current shot's framing
    const k = 1 - Math.exp(-dt * 0.9);
    this._radScale += (this.shot.rad - this._radScale) * k;
    this._hScale += (this.shot.h - this._hScale) * k;
    this._speedScale += (this.shot.speed - this._speedScale) * k;
    this._sweepT += dt;

    this.orbitAngle += dt * (0.06 + audio.smoothEnergy * 0.18)
      * (this.spinScale ?? 1) * this._speedScale;
    this.punch = Math.max(0, this.punch - dt * 2.2);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    // groove: when the beat grid is locked, the frame breathes ON the beat —
    // a sharp dip at the hit easing out toward the next one
    const groove = audio.gridLocked
      ? Math.pow(Math.max(0, 1 - audio.beatPhase), 3) * this.baseRadius * 0.03
      : 0;
    const targetRadius = this.baseRadius * this._radScale - this.punch * 2.5 - groove;
    this.radius += (targetRadius - this.radius) * (1 - Math.exp(-dt * 4));

    // crane: a slow vertical sweep from high to low and back
    const sweep = this.shot.sweep
      ? Math.sin(this._sweepT * 0.35) * this.baseRadius * 0.45 * this.shot.sweep
      : 0;
    const bob = Math.sin(this.orbitAngle * 1.7) * 1.5;
    this.camera.position.set(
      this.smoothedFocus.x + Math.cos(this.orbitAngle) * this.radius,
      this.height * this._hScale + sweep + bob + this.smoothedFocus.y * 0.4,
      this.smoothedFocus.z + Math.sin(this.orbitAngle) * this.radius,
    );

    // trauma shake: layered incommensurate sines ≈ smooth noise, scales with
    // trauma² so small hits whisper and big hits genuinely rattle the frame
    if (this.trauma > 0.001) {
      this._shakeT += dt * 38;
      const a = this.trauma * this.trauma;
      this.camera.position.x += (Math.sin(this._shakeT * 1.07) + Math.sin(this._shakeT * 2.31) * 0.5) * 0.13 * a;
      this.camera.position.y += (Math.sin(this._shakeT * 1.31 + 1.7) + Math.sin(this._shakeT * 2.73) * 0.5) * 0.11 * a;
      this.camera.position.z += (Math.sin(this._shakeT * 0.91 + 3.1)) * 0.12 * a;
    }

    this.camera.lookAt(this.smoothedFocus);
    if (this.trauma > 0.001) {
      this.camera.rotation.z += Math.sin(this._shakeT * 1.53) * 0.007 * this.trauma * this.trauma;
    }
  }
}
