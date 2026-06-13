// Cymatica — the orb and the water as one instrument. The pool below is a
// cymatic plate: standing-wave (Chladni) patterns whose mode shape is chosen
// by the song's musical key, with glowing nodal lines where the "sand" would
// collect. The ferrofluid orb hovers above, spiking with the spectrum, tinted
// by the key. Change key -> the whole pattern and palette morph live.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';
import { NOISE_GLSL } from '../materials.js';

const DROPLETS = 10;

export class CymaticaScene extends SceneBase {
  defaultGravity() { return { x: 0, y: -7, z: 0 }; }
  envKey() { return 'studio'; }
  cinema() { return { rays: 0.4, streak: 0.5 }; }

  build() {
    const { scene } = this.three;
    scene.fog = new THREE.FogExp2(0x010108, 0.02);
    scene.background = new THREE.Color(0x010108);

    const ambient = new THREE.AmbientLight(0x202040, 0.6);
    this.keyLight = new THREE.SpotLight(0xffffff, 20, 80, 0.7, 0.4);
    this.keyLight.position.set(8, 16, 6);
    this.rimLight = new THREE.PointLight(0x00f0ff, 4, 50);
    this.rimLight.position.set(-8, 3, -7);
    scene.add(ambient, this.keyLight, this.rimLight);
    this.lights.push(ambient, this.keyLight, this.rimLight);

    // ---- the cymatic pool ----
    this.waterUniforms = {
      uTime: { value: 0 },
      uN: { value: 3 }, uM: { value: 2 },        // Chladni mode numbers (key-driven)
      uAmp: { value: 0.5 },
      uKickTime: { value: 99 }, uKickAmp: { value: 0 },
      uColor: { value: new THREE.Color().setHSL(0.6, 0.9, 0.55) },
      uBass: { value: 0 },
      tFreq: { value: this.shared.freqTex?.texture || null },
    };
    const waterMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide,
      uniforms: this.waterUniforms,
      vertexShader: NOISE_GLSL + /* glsl */`
uniform float uTime, uN, uM, uAmp, uKickTime, uKickAmp, uBass;
varying vec2 vUv; varying float vH;
// Chladni standing wave: sin(nπx)sin(mπy) - sin(mπx)sin(nπy)
float chladni(vec2 p){
  float a = sin(uN * 3.14159 * p.x) * sin(uM * 3.14159 * p.y);
  float b = sin(uM * 3.14159 * p.x) * sin(uN * 3.14159 * p.y);
  return a - b;
}
void main(){
  vUv = uv;
  float c = chladni(uv);
  // the plate vibrates: standing wave oscillating in time with the bass
  float h = c * uAmp * (0.5 + uBass * 1.6) * sin(uTime * 7.0);
  // beat ripple expanding from the centre
  float d = length(uv - 0.5) * 36.0;
  h += exp(-abs(d - uKickTime * 22.0) * 0.5) * exp(-uKickTime * 2.2) * uKickAmp;
  h += snoise(vec3(uv * 9.0, uTime * 0.4)) * 0.06; // restless surface
  vH = c;
  vec3 p = position + vec3(0.0, 0.0, h); // plane is rotated; z = up
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
      fragmentShader: /* glsl */`
uniform vec3 uColor; uniform float uTime;
uniform sampler2D tFreq;
varying vec2 vUv; varying float vH;
void main(){
  // nodal lines: where the standing wave is still — the cymatic pattern
  float node = smoothstep(0.16, 0.0, abs(vH));
  float crest = smoothstep(0.6, 1.4, abs(vH));
  float band = texture2D(tFreq, vec2(length(vUv - 0.5) * 1.6 + 0.04, 0.5)).r;
  vec3 col = uColor * (0.05 + node * (0.9 + band * 1.4));
  col += vec3(1.0) * crest * 0.25;            // white caps on the antinodes
  float edge = smoothstep(0.5, 0.32, length(vUv - 0.5));
  gl_FragColor = vec4(col * edge, edge * (0.35 + node * 0.65));
}`,
    });
    const waterGeo = new THREE.PlaneGeometry(34, 34, 180, 180);
    this.water = new THREE.Mesh(waterGeo, waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -3;
    this.group.add(this.water);
    this.disposable(waterGeo, waterMat);

    // ---- the orb above (ferrofluid, tinted by the key) ----
    this.orbUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 },
      uKickPulse: { value: 0 }, uSpike: { value: 0.3 },
      tFreq: { value: this.shared.freqTex?.texture || null },
    };
    this.orbMat = new THREE.MeshPhysicalMaterial({
      color: 0x14081f, metalness: 1.0, roughness: 0.28,
      iridescence: 1.0, iridescenceIOR: 1.6,
      clearcoat: 1.0, clearcoatRoughness: 0.2, envMapIntensity: 0.65,
      emissive: new THREE.Color().setHSL(0.6, 0.9, 0.25), emissiveIntensity: 0.25,
    });
    this.orbMat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.orbUniforms);
      shader.vertexShader = NOISE_GLSL + /* glsl */`
uniform float uTime, uBass, uKickPulse, uSpike;
uniform sampler2D tFreq;
float fdisp(vec3 dir){
  float f = texture2D(tFreq, vec2(abs(dir.y), 0.5)).r;
  float n = snoise(dir * 3.2 + vec3(0.0, uTime * 0.45, 0.0));
  float spikes = pow(max(n, 0.0), 2.4) * (uSpike + uKickPulse * 0.85);
  return min(spikes * (0.35 + f * 1.9) + uBass * 0.4
    + snoise(dir * 9.0 + vec3(uTime * 1.9)) * 0.07, 1.2);
}
` + shader.vertexShader
        .replace('#include <beginnormal_vertex>', /* glsl */`
vec3 fDir = normalize(position);
float fD0 = fdisp(fDir);
vec3 fUp = abs(fDir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
vec3 fT = normalize(cross(fDir, fUp));
vec3 fB = cross(fDir, fT);
float fe = 0.025; float fR = 1.7;
vec3 dT = normalize(fDir + fT * fe);
vec3 dB = normalize(fDir + fB * fe);
vec3 fP0 = fDir * (fR + fD0);
vec3 fPT = dT * (fR + fdisp(dT));
vec3 fPB = dB * (fR + fdisp(dB));
vec3 objectNormal = normalize(cross(fPT - fP0, fPB - fP0));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = fP0;`);
    };
    this.disposable(this.orbMat);
    const orbGeo = new THREE.SphereGeometry(1, this.shared.mobile ? 100 : 160, this.shared.mobile ? 100 : 160);
    this.orbMesh = new THREE.Mesh(orbGeo, this.orbMat);
    this.orbMesh.position.y = 1.6;
    this.group.add(this.orbMesh);
    this.disposable(orbGeo);

    // droplets the orb flicks onto the water on the beat
    this.addGroundBox(17, 0.5, 17, -3.4);
    const dropMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d0716, metalness: 0.9, roughness: 0.2,
      iridescence: 0.9, envMapIntensity: 1.2,
    });
    this.disposable(dropMat);
    for (let i = 0; i < DROPLETS; i++) {
      const ang = (i / DROPLETS) * Math.PI * 2;
      const o = this.addBall(0.16 + Math.random() * 0.16, {
        x: Math.cos(ang) * (3.5 + Math.random() * 6), y: 1 + Math.random() * 4,
        z: Math.sin(ang) * (3.5 + Math.random() * 6),
      }, { density: 1.4, restitution: 0.75, damping: 0.15, material: dropMat });
      this.addRibbon(o, new THREE.Color().setHSL(0.6, 1, 0.55), 44, 0.5);
      o.ribbonIdx = this.ribbons.length - 1;
    }

    // caustic shimmer dancing across the pool
    this.caustics = this.makeCaustics({ size: 32, y: -2.9, color: 0x88ddff });

    this._t = 0;
    this._kickPulse = 0;
    this._keyFlash = 0;
    this._nT = 3; this._mT = 2; // Chladni mode targets
  }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    this._kickPulse = Math.min(1.6, this._kickPulse + k * 0.55);
    this.waterUniforms.uKickTime.value = 0;
    this.waterUniforms.uKickAmp.value = Math.min(2.2, 0.7 + k * 0.7);
    for (const o of this.objects) {
      o.body.applyImpulse({
        x: (Math.random() - 0.5) * 0.5 * k,
        y: (1.2 + Math.random()) * k * o.body.mass() * 1.6,
        z: (Math.random() - 0.5) * 0.5 * k,
      }, true);
    }
  }

  onOnset(audio) {
    this._kickPulse = Math.min(1.6, this._kickPulse + audio.onsetStrength * 0.2 * this.params.master);
  }

  hottestPoint() { return { point: new THREE.Vector3(0, 0, 0), energy: 0 }; }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;
    this._kickPulse = Math.max(0, this._kickPulse - dt * 2.4);
    this._keyFlash = Math.max(0, this._keyFlash - dt * 1.2);

    // the key picks the Chladni mode: each key = its own water pattern
    if (audio.keyChanged) {
      this._nT = 2 + ((audio.keyPc * 7) % 12) / 12 * 4;       // 2..6
      this._mT = 1.5 + (audio.keyPc % 12) / 12 * 3 + (audio.keyMinor ? 0.7 : 0);
      this._keyFlash = 1;
    }
    this.caustics.mat.uniforms.uTime.value = this._t;
    this.caustics.mat.uniforms.uEnergy.value = audio.smoothEnergy;

    const wu = this.waterUniforms;
    wu.uN.value += (this._nT - wu.uN.value) * dt * 1.2;       // morph, don't snap
    wu.uM.value += (this._mT - wu.uM.value) * dt * 1.2;
    wu.uTime.value = this._t;
    wu.uKickTime.value += dt;
    wu.uAmp.value = 0.35 + audio.smoothEnergy * 1.4 * p.light * p.master;
    wu.uBass.value = audio.bass * p.gravity * p.master;

    // key colour floods the water, the orb's glow, the rim light
    const keyColor = new THREE.Color().setHSL(audio.keyHue, 0.85, 0.55 + this._keyFlash * 0.2);
    wu.uColor.value.lerp(keyColor, dt * 1.5);
    this.orbMat.emissive.lerp(new THREE.Color().setHSL(audio.keyHue, 0.9, 0.22), dt * 1.5);
    this.rimLight.color.lerp(keyColor, dt * 1.5);

    const ou = this.orbUniforms;
    ou.uTime.value = this._t;
    ou.uBass.value = (audio.bass * 0.7 + audio.smoothBass * 0.5) * 1.8 * p.gravity * p.master;
    ou.uKickPulse.value = this._kickPulse;
    ou.uSpike.value = 0.16 + (audio.treble * 1.4 + audio.presence * 1.0 + audio.mid * 0.4) * p.treble * p.master;
    this.orbMesh.rotation.y += dt * (0.15 + audio.smoothEnergy * 0.5);
    this.orbMesh.position.y = 1.6 + Math.sin(this._t * 0.9) * 0.25 + audio.smoothBass * 0.8;
    this.orbMesh.scale.setScalar(1 + this._kickPulse * 0.06 + audio.bass * 0.05);

    // droplets get pulled gently back toward the orb's column
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.z) || 1;
      o.body.resetForces(true);
      o.body.addForce({ x: -t.x / d * 0.8 * o.body.mass(), y: 0, z: -t.z / d * 0.8 * o.body.mass() }, true);
    }

    const e = audio.smoothEnergy * p.light * p.master;
    this.keyLight.intensity = 10 + e * 40 + this._kickPulse * 16;
    this.rimLight.intensity = 2.5 + e * 14 + this._keyFlash * 8;
  }
}
