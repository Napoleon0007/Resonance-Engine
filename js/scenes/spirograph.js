// Spirograph — long-exposure neon light rings (reference: Visualizer 1).
// Concentric circular waveforms, each ring riding its own slice of the
// spectrum, counter-rotating and tilting on kicks. Comet bodies thread
// glowing trails through the rings.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';

const RINGS = [
  { radius: 3.2, color: 0x00f0ff, band: 0.04, speed: 0.30 },  // bass ring
  { radius: 4.4, color: 0x39ff88, band: 0.10, speed: -0.26 },
  { radius: 5.6, color: 0xffe14d, band: 0.17, speed: 0.22 },
  { radius: 6.8, color: 0xff2bd6, band: 0.25, speed: -0.18 },
  { radius: 8.0, color: 0xb14cff, band: 0.34, speed: 0.15 },
  { radius: 9.2, color: 0x00f0ff, band: 0.44, speed: -0.12 },
  { radius: 10.4, color: 0xffe14d, band: 0.55, speed: 0.10 },
  { radius: 11.6, color: 0x39ff88, band: 0.67, speed: -0.08 },
  { radius: 12.8, color: 0xff2bd6, band: 0.79, speed: 0.07 },
  { radius: 14.0, color: 0x00f0ff, band: 0.9, speed: -0.06 }, // treble ring
];
const COMETS = 7;
const SEGMENTS = 240;

export class SpirographScene extends SceneBase {
  defaultGravity() { return { x: 0, y: 0, z: 0 }; }
  envKey() { return 'night'; }
  wantsDOF() { return false; } // 1px neon lines need to stay razor-sharp
  trails() { return 0.72; } // light-painting ribbons
  cinema() { return { rays: 0.12, streak: 0.4 }; }

  build() {
    const { scene } = this.three;
    scene.fog = null;
    scene.background = new THREE.Color(0x000002);

    const ambient = new THREE.AmbientLight(0x101025, 0.6);
    this.glow = new THREE.PointLight(0x8888ff, 2, 60);
    scene.add(ambient, this.glow);
    this.lights.push(ambient, this.glow);

    // each ring: a LineLoop whose vertices ride the live spectrum
    this.rings = [];
    for (const def of RINGS) {
      const angles = new Float32Array(SEGMENTS);
      const positions = new Float32Array(SEGMENTS * 3);
      for (let i = 0; i < SEGMENTS; i++) {
        angles[i] = i / SEGMENTS;
        positions[i * 3] = Math.cos(angles[i] * Math.PI * 2) * def.radius;
        positions[i * 3 + 2] = Math.sin(angles[i] * Math.PI * 2) * def.radius;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        uniforms: {
          tFreq: { value: this.shared.freqTex?.texture || null },
          uTime: { value: 0 },
          uBand: { value: def.band },
          uGain: { value: 1 },
          uSpin: { value: 0 },
          uColor: { value: new THREE.Color(def.color) },
        },
        vertexShader: /* glsl */`
uniform sampler2D tFreq;
uniform float uTime, uBand, uGain, uSpin;
attribute float aAngle;
varying float vGlow;
void main(){
  // mirror the spectrum around the ring so it reads as a waveform loop
  float a = fract(aAngle + uSpin);
  float wave = abs(a * 2.0 - 1.0);
  float f = texture2D(tFreq, vec2(clamp(uBand + wave * 0.12, 0.01, 0.99), 0.5)).r;
  float r = length(position.xz);
  vec3 dir = vec3(position.x / r, 0.0, position.z / r);
  vec3 p = position
    + dir * f * uGain * 1.8
    + vec3(0.0, f * uGain * 2.4 * sin(aAngle * 6.28318 * 3.0 + uTime), 0.0);
  vGlow = 0.85 + f * 2.4;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
        fragmentShader: /* glsl */`
uniform vec3 uColor;
varying float vGlow;
void main(){ gl_FragColor = vec4(uColor * vGlow, 0.9); }`,
      });
      const line = new THREE.LineLoop(geo, mat);
      line.frustumCulled = false;
      // resting tilt so the stack reads in 3D, like the photo
      line.rotation.x = (Math.random() - 0.5) * 0.5;
      this.group.add(line);
      this.disposable(geo, mat);
      this.rings.push({
        line, mat, def,
        tiltTarget: new THREE.Euler(line.rotation.x, 0, 0),
        spin: Math.random(),
      });
    }

    // comets threading light trails through the ring stack
    for (let i = 0; i < COMETS; i++) {
      const hue = i / COMETS;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        emissive: new THREE.Color().setHSL(hue, 1, 0.55), emissiveIntensity: 3.5,
      });
      this.disposable(mat);
      const dist = 5 + i * 1.6;
      const ang = Math.random() * Math.PI * 2;
      const o = this.addBall(0.18, {
        x: Math.cos(ang) * dist, y: (Math.random() - 0.5) * 3, z: Math.sin(ang) * dist,
      }, { density: 1, restitution: 0.9, damping: 0.05, material: mat });
      o.body.setLinvel({ x: -Math.sin(ang) * 3.2, y: (Math.random() - 0.5) * 1.5, z: Math.cos(ang) * 3.2 }, true);
      this.addRibbon(o, new THREE.Color().setHSL(hue, 1, 0.55), 130, 0.8);
    }
    this._t = 0;
  }

  // the ring sculpture is the subject — camera stays centred on it
  hottestPoint() { return { point: new THREE.Vector3(0, 0, 0), energy: 0 }; }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    // rings snap to new tilts — the whole sculpture lurches
    for (const r of this.rings) {
      r.tiltTarget.set(
        (Math.random() - 0.5) * 0.5 * Math.min(1.2, k),
        0,
        (Math.random() - 0.5) * 0.5 * Math.min(1.2, k),
      );
    }
    // comets get a tangential shove
    for (const o of this.objects) {
      const v = o.body.linvel();
      const len = Math.hypot(v.x, v.y, v.z) || 1;
      o.body.applyImpulse({ x: v.x / len * 0.4 * k, y: (Math.random() - 0.5) * 0.3 * k, z: v.z / len * 0.4 * k }, true);
    }
  }

  onOnset(audio) {
    // melody hits flare the whole ring stack
    this._flare = Math.min(1.5, (this._flare || 0) + audio.onsetStrength * 0.4);
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;
    this._flare = Math.max(0, (this._flare || 0) - dt * 3);
    const gain = (0.6 + audio.smoothEnergy * 1.6 + this._flare * 0.8 + audio.transient * 0.5)
      * p.treble * p.master;

    for (const r of this.rings) {
      r.spin += dt * r.def.speed * (0.5 + audio.smoothEnergy * 2.5);
      r.mat.uniforms.uTime.value = this._t;
      r.mat.uniforms.uSpin.value = r.spin;
      r.mat.uniforms.uGain.value = gain;
      // ease toward the kicked tilt
      r.line.rotation.x += (r.tiltTarget.x - r.line.rotation.x) * dt * 3;
      r.line.rotation.z += (r.tiltTarget.z - r.line.rotation.z) * dt * 3;
    }

    // comets orbit a soft centre pull (bass tightens the knot)
    const pull = (2 + audio.smoothBass * 8 * p.gravity) * p.master;
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y, t.z) || 1;
      o.body.resetForces(true);
      o.body.addForce({ x: -t.x / d * pull * 0.2, y: -t.y / d * pull * 0.25, z: -t.z / d * pull * 0.2 }, true);
    }

    this.glow.intensity = 1 + audio.smoothEnergy * 6 * p.light * p.master;
  }
}
