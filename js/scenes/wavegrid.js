// Wave Grid v2 — a 3D spectrogram landscape. The terrain IS the music: the
// front edge is this instant's spectrum, and the mountains rolling away are
// the last ~4 seconds of the song. Grid wires + glow nodes + mirrored ceiling
// make it a neon canyon; kicks roll a shockwave down the whole valley.
// Glass marbles bounce on the unseen floor for scale and physics.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';
import { NOISE_GLSL, makeLiquidMaterial } from '../materials.js';

const MARBLES = 9;
const NX = 128, NZ = 64;          // matches the spectrum-history texture
const W = 96, D = 110;            // world size of the terrain

export class WaveGridScene extends SceneBase {
  defaultGravity() { return { x: 0, y: -9, z: 0 }; }
  envKey() { return 'studio'; }
  cinema() { return { rays: 0.06, streak: 0.2 }; } // thousands of lights — keep the air clear

  _makeTerrainLayer({ y, flip = false, opacity = 1, colorA, colorB }) {
    // grid vertices, front row (z = +D/2, nearest camera start) = newest audio
    const count = NX * NZ;
    const positions = new Float32Array(count * 3);
    const ref = new Float32Array(count * 2);
    let i = 0;
    for (let zr = 0; zr < NZ; zr++) {
      for (let x = 0; x < NX; x++) {
        positions[i * 3] = (x / (NX - 1) - 0.5) * W;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = (0.5 - zr / (NZ - 1)) * D; // row 0 in front
        ref[i * 2] = x / (NX - 1);
        ref[i * 2 + 1] = zr / (NZ - 1);
        i++;
      }
    }
    // wire indices: along x and along z
    const idx = [];
    for (let zr = 0; zr < NZ; zr++) {
      for (let x = 0; x < NX - 1; x++) {
        const a = zr * NX + x;
        idx.push(a, a + 1);
      }
    }
    for (let x = 0; x < NX; x += 2) {
      for (let zr = 0; zr < NZ - 1; zr++) {
        const a = zr * NX + x;
        idx.push(a, a + NX);
      }
    }

    const posAttr = new THREE.BufferAttribute(positions, 3);
    const refAttr = new THREE.BufferAttribute(ref, 2);

    const uniforms = {
      tHist: { value: this.shared.freqTex?.history || null },
      uTime: { value: 0 },
      uAmp: { value: 6 },
      uKickTime: { value: 99 },
      uKickAmp: { value: 0 },
      uFlip: { value: flip ? -1 : 1 },
      uOpacity: { value: opacity },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
    };
    const vertexShader = NOISE_GLSL + /* glsl */`
uniform sampler2D tHist;
uniform float uTime, uAmp, uKickTime, uKickAmp, uFlip;
attribute vec2 aRef;
varying float vAmp;
varying vec2 vRef;
float height(vec2 ref, vec3 pos){
  float f = texture2D(tHist, vec2(ref.x, ref.y)).r;        // spectrogram history
  float fade = 1.0 - ref.y * 0.55;                          // older = lower
  float edge = smoothstep(0.0, 0.12, ref.x) * smoothstep(1.0, 0.88, ref.x);
  float n = snoise(vec3(ref * 7.0, uTime * 0.15)) * 0.35 + 0.65;
  float h = f * uAmp * fade * edge * n;
  float wave = exp(-abs((1.0 - ref.y) * ${D.toFixed(1)} - uKickTime * 34.0) * 0.35)
             * exp(-uKickTime * 1.6);
  return h + wave * uKickAmp * edge;
}
void main(){
  float h = height(aRef, position);
  vec3 p = position + vec3(0.0, h * uFlip, 0.0);
  vAmp = h / max(uAmp, 0.001);
  vRef = aRef;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (1.5 + vAmp * 7.0) * (140.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
    const fragCommon = /* glsl */`
uniform vec3 uColorA, uColorB;
uniform float uOpacity;
varying float vAmp;
varying vec2 vRef;
vec3 gridColor(){
  vec3 col = mix(uColorA, uColorB, clamp(vAmp * 1.6, 0.0, 1.0));
  col = mix(col, vec3(1.0), smoothstep(0.9, 1.25, vAmp) * 0.5); // white-hot peaks
  float depthFade = 1.0 - vRef.y * 0.7;
  return col * (0.18 + vAmp * 2.0) * depthFade;
}`;

    const geoLines = new THREE.BufferGeometry();
    geoLines.setAttribute('position', posAttr);
    geoLines.setAttribute('aRef', refAttr);
    geoLines.setIndex(idx);
    const matLines = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms, vertexShader,
      fragmentShader: fragCommon + `void main(){ gl_FragColor = vec4(gridColor(), 0.55 * uOpacity); }`,
    });
    const lines = new THREE.LineSegments(geoLines, matLines);
    lines.frustumCulled = false;

    const geoPts = new THREE.BufferGeometry();
    geoPts.setAttribute('position', posAttr);
    geoPts.setAttribute('aRef', refAttr);
    const matPts = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms, vertexShader,
      fragmentShader: fragCommon + /* glsl */`
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float disc = smoothstep(0.5, 0.08, length(c));
  gl_FragColor = vec4(gridColor() * disc, disc * 0.9 * uOpacity);
}`,
    });
    const points = new THREE.Points(geoPts, matPts);
    points.frustumCulled = false;

    this.group.add(lines, points);
    this.disposable(geoLines, matLines, geoPts, matPts);
    return { uniforms };
  }

  build() {
    const { scene } = this.three;
    scene.fog = new THREE.FogExp2(0x02020c, 0.016);
    scene.background = new THREE.Color(0x02020c);

    const ambient = new THREE.AmbientLight(0x202050, 0.7);
    this.keyLight = new THREE.PointLight(0x8866ff, 4, 80);
    this.keyLight.position.set(0, 14, 10);
    scene.add(ambient, this.keyLight);
    this.lights.push(ambient, this.keyLight);

    // valley floor + mirrored canyon ceiling
    this.terrain = this._makeTerrainLayer({ y: -5, colorA: 0x00f0ff, colorB: 0xb14cff });
    this.ceiling = this._makeTerrainLayer({ y: 17, flip: true, opacity: 0.35, colorA: 0xff2bd6, colorB: 0x2244ff });

    // aurora curtains rippling across the back of the canyon
    this.aurora = this.makeAurora({ radius: 80, height: 60, y: 6, colorA: 0x39ff88, colorB: 0x00f0ff });

    // bokeh dust drifting through the canyon
    this.dust = this.makeParticles(450, { size: 0.55, color: 0x6699ff, opacity: 0.3 });
    for (let i = 0; i < 240; i++) {
      this.emitParticle(this.dust,
        (Math.random() - 0.5) * 70, -2 + Math.random() * 18, (Math.random() - 0.5) * 80,
        (Math.random() - 0.5) * 0.25, 0.08 + Math.random() * 0.18, (Math.random() - 0.5) * 0.25,
        999);
    }

    // glass marbles bouncing through the valley
    this.addGroundBox(48, 0.5, 55, -5.4);
    this.marbleMats = [];
    for (let i = 0; i < MARBLES; i++) {
      const hue = 0.5 + (i / MARBLES) * 0.4;
      const color = new THREE.Color().setHSL(hue % 1, 0.9, 0.55);
      const mat = makeLiquidMaterial(color, { transmission: i < 3 ? 0.92 : 0, wobbleScale: 1.4 });
      this.marbleMats.push(mat);
      this.disposable(mat);
      const o = this.addBall(0.4 + Math.random() * 0.4, {
        x: (Math.random() - 0.5) * 30, y: 1 + Math.random() * 7, z: (Math.random() - 0.5) * 30,
      }, { density: 1, restitution: 0.85, damping: 0.1, material: mat });
      this.addRibbon(o, color, 55, 0.5);
    }
    this._t = 0;
  }

  onOnset(audio) {
    // snares send a smaller ripple — the valley answers everything
    const k = audio.onsetStrength * this.params.impulse * this.params.master;
    for (const layer of [this.terrain, this.ceiling]) {
      if (layer.uniforms.uKickTime.value > 0.35) { // don't stomp a fresh kick wave
        layer.uniforms.uKickTime.value = 0;
        layer.uniforms.uKickAmp.value = Math.min(3, 0.8 + k);
      }
    }
  }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    for (const layer of [this.terrain, this.ceiling]) {
      layer.uniforms.uKickTime.value = 0;
      layer.uniforms.uKickAmp.value = Math.min(6, 2 + k * 2);
    }
    for (const o of this.objects) {
      o.body.applyImpulse({
        x: (Math.random() - 0.5) * 1.5 * k,
        y: (2.5 + Math.random() * 2.5) * k * o.body.mass() * 0.6,
        z: (Math.random() - 0.5) * 1.5 * k,
      }, true);
    }
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;

    this.world.gravity.y = -9 - audio.smoothBass * 18 * p.gravity * p.master;

    const amp = (4 + audio.smoothEnergy * 13 * p.light) * p.master;
    const keyColor = new THREE.Color().setHSL(audio.keyHue, 0.95, 0.55);
    for (const layer of [this.terrain, this.ceiling]) {
      layer.uniforms.uTime.value = this._t;
      layer.uniforms.uKickTime.value += dt;
      layer.uniforms.uAmp.value = amp;
      layer.uniforms.uColorB.value.lerp(keyColor, dt * 0.6); // key tints the peaks
    }

    this.aurora.mat.uniforms.uTime.value = this._t;
    this.aurora.mat.uniforms.uMid.value = audio.mid;
    this.aurora.mat.uniforms.uEnergy.value = audio.smoothEnergy;
    this.stepParticles(this.dust, dt, 0, 0);
    const wobble = 0.03 + audio.smoothBass * 0.25 * p.master;
    for (const m of this.marbleMats) {
      m.userData.uTime.value = this._t;
      m.userData.uWobble.value = wobble;
      m.emissiveIntensity = 0.35 + audio.energy * 1.8 * p.light;
    }
    this.keyLight.intensity = 2 + audio.smoothEnergy * 14 * p.light * p.master;
  }
}
