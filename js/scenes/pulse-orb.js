// Pulse Orb — the hero scene. A ferrofluid sphere of dark iridescent liquid
// metal that vibrates with the spectrum: bass swells the body, individual
// bands ripple the surface, kicks spike it like a magnet snapped on. Orbiting
// shards + a spectrum wave-field backdrop. Pure black void, studio lighting.

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { SceneBase } from './scene-base.js';
import { NOISE_GLSL, makeRockGeometry, addIridescence } from '../materials.js';

const SHARDS = 18;

export class PulseOrbScene extends SceneBase {
  defaultGravity() { return { x: 0, y: 0, z: 0 }; }
  envKey() { return 'studio'; }
  trails() { return 0.62; }

  build() {
    const { scene } = this.three;
    scene.fog = null;
    scene.background = new THREE.Color(0x000003);

    const ambient = new THREE.AmbientLight(0x221133, 0.5);
    this.keyLight = new THREE.SpotLight(0xeeddff, 30, 80, 0.7, 0.4);
    this.keyLight.position.set(10, 16, 8);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.rimLight = new THREE.PointLight(0xb14cff, 6, 50);
    this.rimLight.position.set(-9, 2, -7);
    this.fillLight = new THREE.PointLight(0x00f0ff, 3, 50);
    this.fillLight.position.set(8, -4, 9);
    scene.add(ambient, this.keyLight, this.rimLight, this.fillLight);
    this.lights.push(ambient, this.keyLight, this.rimLight, this.fillLight);

    // ---- the orb: ferrofluid displacement in the vertex stage ----
    this.orbUniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uKickPulse: { value: 0 },
      uSpike: { value: 0.35 },
      tFreq: { value: this.shared.freqTex?.texture || null },
    };
    const orbMat = new THREE.MeshPhysicalMaterial({
      color: 0x14081f, metalness: 1.0, roughness: 0.28,
      iridescence: 1.0, iridescenceIOR: 1.6,
      clearcoat: 1.0, clearcoatRoughness: 0.2,
      envMapIntensity: 0.65,
      emissive: 0x2a0a4a, emissiveIntensity: 0.18,
    });
    orbMat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.orbUniforms);
      shader.vertexShader = NOISE_GLSL + /* glsl */`
uniform float uTime, uBass, uKickPulse, uSpike;
uniform sampler2D tFreq;

// ferrofluid spike field: sharp peaks pulled out of smooth noise
float fdisp(vec3 dir){
  float band = abs(dir.y);                                  // latitude -> band
  float f = texture2D(tFreq, vec2(band, 0.5)).r;            // live spectrum
  float n = snoise(dir * 3.2 + vec3(0.0, uTime * 0.45, 0.0));
  float spikes = pow(max(n, 0.0), 2.4) * (uSpike + uKickPulse * 0.85);
  float swell = uBass * 0.42 + sin(uTime * 1.1) * 0.05;     // breath, never dead-still
  float ripple = snoise(dir * 9.0 + vec3(uTime * 1.9)) * 0.08 * (0.25 + f * 1.5);
  return min(spikes * (0.35 + f * 1.9) + swell + ripple, 1.5); // never explode
}
` + shader.vertexShader
        .replace('#include <beginnormal_vertex>', /* glsl */`
vec3 fDir = normalize(position);
float fD0 = fdisp(fDir);
vec3 fUp = abs(fDir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0); // pole-safe
vec3 fT = normalize(cross(fDir, fUp));
vec3 fB = cross(fDir, fT);
float fe = 0.025;
vec3 dT = normalize(fDir + fT * fe);
vec3 dB = normalize(fDir + fB * fe);
float fR = 2.4;
vec3 fP0 = fDir * (fR + fD0);
vec3 fPT = dT * (fR + fdisp(dT));
vec3 fPB = dB * (fR + fdisp(dB));
vec3 objectNormal = normalize(cross(fPT - fP0, fPB - fP0));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`)
        .replace('#include <begin_vertex>', /* glsl */`
vec3 transformed = fP0;`);
    };
    addIridescence(orbMat, { strength: 0.7 }); // petrol-on-water sheen
    this.disposable(orbMat);

    const seg = this.shared.mobile ? 120 : 196; // spikes need verts; phones need mercy
    const orbGeo = new THREE.SphereGeometry(1, seg, seg);
    this.orbMesh = new THREE.Mesh(orbGeo, orbMat);
    this.orbMesh.castShadow = true;
    this.group.add(this.orbMesh);
    this.disposable(orbGeo);

    // physics proxy so shards bounce off the orb's "body"
    const R = this.RAPIER;
    this.orbBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.orbCollider = this.world.createCollider(R.ColliderDesc.ball(2.8), this.orbBody);

    // black mirror floor — doubles every light, grounds the orb in a "studio"
    this.mirror = new Reflector(new THREE.CircleGeometry(26, 64), {
      textureWidth: 1024, textureHeight: 1024,
      color: 0x202028, clipBias: 0.003,
    });
    this.mirror.rotation.x = -Math.PI / 2;
    this.mirror.position.y = -6.2;
    this.group.add(this.mirror);
    this.disposable(this.mirror.geometry, this.mirror.material);
    this.addGroundBox(26, 0.5, 26, -6.8); // shards bounce off the mirror
    // caustic light-web dancing on the mirror
    this.caustics = this.makeCaustics({ size: 48, y: -6.1, color: 0x66c0ff });

    // ---- orbiting obsidian shards, kicked outward on hits ----
    const shardMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d0716, metalness: 0.95, roughness: 0.22,
      iridescence: 0.8, envMapIntensity: 1.8,
    });
    addIridescence(shardMat, { strength: 0.9 });
    this.disposable(shardMat);
    for (let i = 0; i < SHARDS; i++) {
      const r = 0.16 + Math.random() * 0.3;
      const dist = 5 + Math.random() * 5;
      const ang = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.5) * 1.6;
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(Math.cos(ang) * dist, Math.sin(elev) * dist * 0.5, Math.sin(ang) * dist)
          .setLinearDamping(0.25).setAngularDamping(0.2));
      this.world.createCollider(R.ColliderDesc.ball(r).setDensity(2).setRestitution(0.7), body);
      const geo = makeRockGeometry(r, i * 7.3, 0.55);
      const mesh = new THREE.Mesh(geo, shardMat);
      mesh.castShadow = true;
      this.disposable(geo);
      const o = this.track(body, mesh);
      body.setLinvel({ x: -Math.sin(ang) * 2.2, y: 0, z: Math.cos(ang) * 2.2 }, true);
      const hue = 0.72 + (i / SHARDS) * 0.2;
      this.addRibbon(o, new THREE.Color().setHSL(hue % 1, 1, 0.55), 56);
    }

    // wave-field backdrop (the glowing dot terrain) on two sides
    this.waveA = this.makeWaveField({ width: 70, depth: 26, y: -8, colorA: 0x00f0ff, colorB: 0xb14cff });
    this.waveA.points.position.z = -16;
    this.waveB = this.makeWaveField({ width: 70, depth: 26, y: -8, colorA: 0x39ff88, colorB: 0xff2bd6 });
    this.waveB.points.position.z = 16;
    this.waveB.points.rotation.y = Math.PI;

    this._t = 0;
    this._kickPulse = 0;
  }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    this._kickPulse = Math.min(1.6, this._kickPulse + k * 0.55);
    this.waveA.kick(k);
    this.waveB.kick(k);
    // shards blasted radially off the orb
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y, t.z) || 1;
      o.body.applyImpulse({
        x: t.x / d * 1.1 * k, y: t.y / d * 1.1 * k, z: t.z / d * 1.1 * k,
      }, true);
    }
  }

  onOnset(audio) {
    // snares/melody: medium surface jolt — the orb answers every hit
    this._kickPulse = Math.min(1.6, this._kickPulse + audio.onsetStrength * 0.22 * this.params.master);
  }

  onHat(audio) {
    this.fillLight.intensity += audio.hatStrength * 4 * this.params.treble;
  }

  hottestPoint() {
    // the orb IS the show — keep the camera locked on it
    return { point: new THREE.Vector3(0, 0, 0), energy: 0 };
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;
    this._kickPulse = Math.max(0, this._kickPulse - dt * 2.4);

    const u = this.orbUniforms;
    u.uTime.value = this._t;
    // ride the RAW bass (not the smoothed) so the surface snaps with the music
    u.uBass.value = (audio.bass * 0.7 + audio.smoothBass * 0.5) * 2.0 * p.gravity * p.master;
    u.uKickPulse.value = this._kickPulse;
    // treble + voice ripple the surface; the orb "sings" with the vocal
    u.uSpike.value = 0.18 + (audio.treble * 1.5 + audio.presence * 1.0 + audio.mid * 0.5) * p.treble * p.master;
    this.orbMesh.material.emissiveIntensity = 0.2 + audio.smoothPresence * 1.4 * p.light;
    this.caustics.mat.uniforms.uTime.value = this._t;
    this.caustics.mat.uniforms.uEnergy.value = audio.smoothEnergy;
    this.orbMesh.rotation.y += dt * (0.12 + audio.smoothEnergy * 0.5);
    // whole-orb pump on the beat
    const pump = 1 + this._kickPulse * 0.07 + audio.bass * 0.05;
    this.orbMesh.scale.setScalar(pump);

    // shards: gravity well pulls them back into orbit around the orb
    const pull = (3.2 + audio.smoothBass * 9 * p.gravity) * p.master;
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y, t.z) || 1;
      o.body.resetForces(true);
      o.body.addForce({
        x: -t.x / d * pull * o.body.mass(),
        y: -t.y / d * pull * o.body.mass(),
        z: -t.z / d * pull * o.body.mass(),
      }, true);
    }

    // the song's key tints the rim light — every track gets its own colour
    this.rimLight.color.lerp(new THREE.Color().setHSL(audio.keyHue, 0.9, 0.6), dt * 0.8);

    // lights breathe with the track
    const e = audio.smoothEnergy * p.light * p.master;
    this.keyLight.intensity = 8 + e * 22 + this._kickPulse * 10;
    this.rimLight.intensity = 2.5 + e * 12;
    this.fillLight.intensity = 1.2 + audio.treble * 7 * p.treble;
    this.waveA.step(dt, this._t);
    this.waveB.step(dt, this._t);
    this.waveA.mat.uniforms.uAmp.value = 3 + e * 9;
    this.waveB.mat.uniforms.uAmp.value = 3 + e * 9;
  }
}
