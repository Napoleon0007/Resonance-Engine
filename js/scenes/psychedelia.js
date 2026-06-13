// Psychedelia — flowing fractal dome (reference: Visualizer 2). The camera
// sits inside a sphere painted with domain-warped fbm in hot reds, teals and
// golds; the mids steer the warp, kicks slam a brightness/warp surge through
// it. Liquid blobs drift in the middle for the physics to chew on.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';
import { NOISE_GLSL, makeLiquidMaterial } from '../materials.js';

const BLOBS = 8;

export class PsychedeliaScene extends SceneBase {
  defaultGravity() { return { x: 0, y: 0, z: 0 }; }
  envKey() { return 'sunset'; }
  kaleido() { return 0.35; }
  cinema() { return { rays: 0.1, streak: 0.35 }; } // the dome IS the light
  stormCount() { return 0; } // inside a dome — storm would just clutter

  build() {
    const { scene } = this.three;
    scene.fog = null;
    scene.background = new THREE.Color(0x000000);

    const ambient = new THREE.AmbientLight(0x402010, 0.8);
    this.glow = new THREE.PointLight(0xff6622, 3, 70);
    scene.add(ambient, this.glow);
    this.lights.push(ambient, this.glow);

    // the dome: inside-out sphere, fully shader-painted
    this.domeUniforms = {
      uTime: { value: 0 },
      uWarp: { value: 1 },
      uKick: { value: 0 },
      uEnergy: { value: 0 },
      uBass: { value: 0 },
      uMode: { value: 0 }, // pattern morph target, advances on hard kicks
      tFreq: { value: this.shared.freqTex?.texture || null },
    };
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: this.domeUniforms,
      vertexShader: /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: NOISE_GLSL + /* glsl */`
uniform float uTime, uWarp, uKick, uEnergy, uBass, uMode;
uniform sampler2D tFreq;
varying vec3 vDir;

vec3 palette(float t){
  return vec3(0.45, 0.22, 0.25)
       + vec3(0.45, 0.38, 0.4) * cos(6.28318 * (t + vec3(0.0, 0.21, 0.55)));
}

void main(){
  // polar screen of the dome: ang around the view axis, rad = how far off-axis
  vec3 v = normalize(vDir);
  float ang = atan(v.y, v.x);
  float rad = acos(clamp(v.z, -1.0, 1.0)) / 3.14159; // 0 centre -> 1 behind

  // gentle organic wobble so the geometry never looks computer-stiff
  float wob = fbm(v * 2.0 + uTime * 0.08) * 0.35 * uWarp;

  // PATTERN 1 — spectrum tunnel: concentric rings flying inward,
  // each ring lit by its own frequency band
  float flow = rad * 9.0 - uTime * (0.7 + uBass * 2.0);
  float ringIdx = fract(flow + wob);
  float bandT = fract(rad * 2.0 + uTime * 0.02);
  float fT = texture2D(tFreq, vec2(bandT * 0.85 + 0.05, 0.5)).r;
  float tunnel = pow(0.5 + 0.5 * cos(ringIdx * 6.28318), 3.0) * (0.25 + fT * 2.2);

  // PATTERN 2 — kaleidoscopic petals: angular folds locked to the mids
  float seg = 8.0;
  float folded = abs(fract(ang / 6.28318 * seg + uTime * 0.03) * 2.0 - 1.0);
  float fA = texture2D(tFreq, vec2(folded * 0.6 + 0.2, 0.5)).r;
  float petals = pow(0.5 + 0.5 * cos((folded + wob) * 12.0 + rad * 18.0 - uTime), 4.0)
               * (0.3 + fA * 2.0);

  // PATTERN 3 — lattice cells: hex-ish honeycomb breathing with the bass
  vec2 cellUv = vec2(ang * 3.0, rad * 14.0 - uTime * 0.9);
  float cells = pow(abs(sin(cellUv.x + sin(cellUv.y))) * abs(sin(cellUv.y * 0.8 + wob * 4.0)), 2.0)
              * (0.3 + uBass * 2.4);

  // morph between the three patterns; hard kicks rotate uMode
  float m = mod(uMode, 3.0);
  float p1 = max(0.0, 1.0 - abs(m - 0.0)) + max(0.0, 1.0 - abs(m - 3.0));
  float p2 = max(0.0, 1.0 - abs(m - 1.0));
  float p3 = max(0.0, 1.0 - abs(m - 2.0));
  float pat = tunnel * p1 + petals * p2 + cells * p3;

  // colour: hue spirals along the pattern flow, kicks flash it hot
  vec3 col = palette(rad * 1.5 + ang * 0.16 + uTime * 0.03 + pat * 0.22);
  col *= 0.04 + pat * 0.95;
  col += palette(pat + 0.45) * pow(min(pat, 1.2), 3.0) * 0.45;  // hot ridges
  col *= 1.0 + uKick * 0.45 + uEnergy * 0.3;
  gl_FragColor = vec4(col, 1.0);
}`,
    });
    const domeGeo = new THREE.SphereGeometry(55, 48, 32);
    const dome = new THREE.Mesh(domeGeo, domeMat);
    this.group.add(dome);
    this.disposable(domeGeo, domeMat);

    // liquid blobs drifting through the middle, trailing soft light
    this.blobMats = [];
    for (let i = 0; i < BLOBS; i++) {
      const hue = [0.02, 0.08, 0.46, 0.38, 0.05, 0.5, 0.1, 0.42][i];
      const color = new THREE.Color().setHSL(hue, 0.9, 0.5);
      const mat = makeLiquidMaterial(color, { transmission: i < 3 ? 0.9 : 0, wobbleScale: 2.0 });
      this.blobMats.push(mat);
      this.disposable(mat);
      const o = this.addBall(0.5 + Math.random() * 0.5, {
        x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 14,
      }, { density: 1, restitution: 0.9, damping: 0.3, material: mat });
      o.body.applyImpulse({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 }, true);
      this.addRibbon(o, color, 60, 0.5);
    }
    this._t = 0;
    this._kick = 0;
  }

  onOnset(audio) {
    this._kick = Math.min(1.5, this._kick + audio.onsetStrength * 0.18 * this.params.master);
  }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    this._kick = Math.min(1.5, this._kick + k * 0.5);
    // hard hits morph to the next pattern (tunnel -> petals -> cells -> ...)
    if (audio.kickStrength > 1.45) this._modeTarget = (this._modeTarget || 0) + 1;
    for (const o of this.objects) {
      o.body.applyImpulse({
        x: (Math.random() - 0.5) * 2.4 * k,
        y: (Math.random() - 0.5) * 2.4 * k,
        z: (Math.random() - 0.5) * 2.4 * k,
      }, true);
    }
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;
    this._kick = Math.max(0, this._kick - dt * 2.8);

    const u = this.domeUniforms;
    u.uTime.value = this._t;
    u.uWarp.value = 0.8 + audio.mid * 2.2 * p.treble * p.master;
    u.uKick.value = this._kick;
    u.uEnergy.value = audio.smoothEnergy * p.light * p.master;
    u.uBass.value = audio.bass * p.gravity * p.master;
    // ease toward the kicked pattern mode (smooth morph, not a hard cut)
    u.uMode.value += ((this._modeTarget || 0) - u.uMode.value) * dt * 2.5;

    // blobs: gentle centre tether so they never wander off
    const pull = (1.5 + audio.smoothBass * 6 * p.gravity) * p.master;
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y, t.z) || 1;
      o.body.resetForces(true);
      o.body.addForce({ x: -t.x / d * pull * 0.3, y: -t.y / d * pull * 0.3, z: -t.z / d * pull * 0.3 }, true);
    }
    const wobble = 0.05 + (audio.smoothBass * 0.4 + audio.mid * 0.3) * 0.6 * p.master;
    for (const m of this.blobMats) {
      m.userData.uTime.value = this._t;
      m.userData.uWobble.value = wobble;
      m.emissiveIntensity = 0.18 + audio.energy * 0.9 * p.light;
      m.envMapIntensity = 0.7;
    }
    this.glow.intensity = 1.5 + audio.smoothEnergy * 8 * p.light * p.master;
  }
}
