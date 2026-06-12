// Black Hole — the singularity scene. A pure-black event horizon ringed by a
// blazing accretion disc (doppler-shifted: the approaching side burns
// brighter and bluer), spacetime visibly lensing the starfield behind it.
// Bass feeds the disc, kicks hurl matter in, the drop flares it blinding.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';
import { NOISE_GLSL, makeRockGeometry } from '../materials.js';

const DOOMED = 14;

export class BlackHoleScene extends SceneBase {
  defaultGravity() { return { x: 0, y: 0, z: 0 }; }
  envKey() { return 'night'; }
  cinema() { return { rays: 0.7, streak: 0.85 }; }
  lens() { return 1; } // post-stack bends light around the horizon

  build() {
    const { scene } = this.three;
    scene.fog = null;
    scene.background = new THREE.Color(0x000001);

    const ambient = new THREE.AmbientLight(0x0a0a18, 0.5);
    this.discLight = new THREE.PointLight(0xff9040, 600, 0, 1.7);
    scene.add(ambient, this.discLight);
    this.lights.push(ambient, this.discLight);

    // background stars — these are what the lens visibly bends
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(2600 * 3);
    for (let i = 0; i < 2600; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(95 + Math.random() * 70);
      starPos[i * 3] = v.x; starPos[i * 3 + 1] = v.y; starPos[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.32, color: 0xcfdcff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.group.add(new THREE.Points(starGeo, starMat));
    this.disposable(starGeo, starMat);

    // the event horizon: light goes in, nothing comes out
    const bhGeo = new THREE.SphereGeometry(2.1, 48, 32);
    const bhMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.group.add(new THREE.Mesh(bhGeo, bhMat));
    this.disposable(bhGeo, bhMat);

    // accretion disc — swirling shader plasma with doppler beaming
    this.discUniforms = {
      uTime: { value: 0 },
      uHeat: { value: 0.5 },
      uFlare: { value: 0 },
    };
    const discMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.discUniforms,
      vertexShader: /* glsl */`
varying vec2 vUv; varying vec3 vWorld;
void main(){
  vUv = uv;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: NOISE_GLSL + /* glsl */`
uniform float uTime, uHeat, uFlare;
varying vec2 vUv; varying vec3 vWorld;
void main(){
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;            // 0 centre -> 1 outer edge
  float ang = atan(c.y, c.x);
  if (r < 0.34 || r > 1.0) discard;     // hole for the horizon
  // plasma streaks orbit faster near the horizon (keplerian-ish)
  float swirl = ang * 3.0 - uTime * (3.2 / (r + 0.25));
  float n = fbm(vec3(cos(swirl) * r * 4.0, sin(swirl) * r * 4.0, uTime * 0.22));
  float bands = 0.55 + 0.45 * sin(swirl * 2.0 + n * 5.0);
  float falloff = smoothstep(1.0, 0.42, r) * smoothstep(0.3, 0.46, r);
  // doppler beaming: the side rotating toward us burns brighter + bluer
  float doppler = 0.55 + 0.45 * sin(ang + uTime * 0.4);
  vec3 hot = mix(vec3(1.0, 0.42, 0.1), vec3(0.75, 0.85, 1.0), doppler * 0.6);
  float inner = smoothstep(0.52, 0.36, r);   // white-hot inner edge
  vec3 col = hot * bands * falloff * (0.3 + uHeat * 0.9 + uFlare * 1.4);
  col += vec3(1.0, 0.95, 0.85) * inner * (0.7 + uFlare * 1.6) * bands;
  gl_FragColor = vec4(col, falloff * 0.95);
}`,
    });
    const discGeo = new THREE.RingGeometry(2.4, 9.5, 128, 4);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2 + 0.32; // tilted like Gargantua
    this.group.add(disc);
    this.disposable(discGeo, discMat);

    // photon ring — the thin halo of orbiting light just above the horizon
    const ringGeo = new THREE.TorusGeometry(2.35, 0.06, 8, 96);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xfff3d0, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2 + 0.32;
    this.group.add(ring);
    this.disposable(ringGeo, this.ringMat);

    // doomed matter: rocks spiralling in, re-fed to the outer orbit when eaten
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a30, emissive: 0xff5510, emissiveIntensity: 0.4, roughness: 0.9,
    });
    this.disposable(rockMat);
    for (let i = 0; i < DOOMED; i++) {
      const r = 0.14 + Math.random() * 0.22;
      const dist = 6 + Math.random() * 9;
      const ang = Math.random() * Math.PI * 2;
      const o = this.addBall(r, {
        x: Math.cos(ang) * dist, y: (Math.random() - 0.5) * 1.5, z: Math.sin(ang) * dist,
      }, {
        density: 2, restitution: 0.4, damping: 0.04,
        material: rockMat, geometry: makeRockGeometry(r, i * 5.1, 0.5),
      });
      const v = Math.sqrt(60 / dist);
      o.body.setLinvel({ x: -Math.sin(ang) * v, y: 0, z: Math.cos(ang) * v }, true);
      this.addRibbon(o, new THREE.Color(0xff7733), 70, 0.6);
    }

    this.embers = this.makeParticles(700, { size: 0.1, color: 0xffaa55, opacity: 0.85 });
    this._t = 0;
    this._flare = 0;
  }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    this._flare = Math.min(2, this._flare + k * 0.5);
    // matter slammed inward
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y, t.z) || 1;
      o.body.applyImpulse({
        x: -t.x / d * 0.5 * k, y: -t.y / d * 0.5 * k, z: -t.z / d * 0.5 * k,
      }, true);
    }
  }

  onOnset(audio) {
    this._flare = Math.min(2, this._flare + audio.onsetStrength * 0.15);
  }

  hottestPoint() { return { point: new THREE.Vector3(0, 0, 0), energy: 0 }; }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;
    this._flare = Math.max(0, this._flare - dt * 2.2);

    // newtonian approximation of doom: strong central pull, bass tightens it
    const G = (55 + audio.smoothBass * 130 * p.gravity) * p.master;
    for (const o of this.objects) {
      const t = o.body.translation();
      const d2 = Math.max(2, t.x * t.x + t.y * t.y + t.z * t.z);
      const d = Math.sqrt(d2);
      const f = (G * o.body.mass()) / d2;
      o.body.resetForces(true);
      o.body.addForce({ x: -t.x / d * f, y: -t.y / d * f, z: -t.z / d * f }, true);

      // crossing the horizon: spaghettified — ember burst, re-fed far out
      if (d < 2.6) {
        for (let i = 0; i < 14; i++) {
          this.emitParticle(this.embers, t.x, t.y, t.z,
            (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5,
            0.5 + Math.random() * 0.5);
        }
        const ang = Math.random() * Math.PI * 2;
        const dist = 12 + Math.random() * 5;
        o.body.setTranslation({ x: Math.cos(ang) * dist, y: (Math.random() - 0.5) * 2, z: Math.sin(ang) * dist }, true);
        const v = Math.sqrt(60 / dist);
        o.body.setLinvel({ x: -Math.sin(ang) * v, y: 0, z: Math.cos(ang) * v }, true);
      }
      // heat glow as matter falls closer
      o.mesh.material.emissiveIntensity = 0.2 + Math.max(0, 1 - d / 10) * 2.5;
    }

    this.stepParticles(this.embers, dt, 0, 0.6);

    const u = this.discUniforms;
    u.uTime.value = this._t;
    u.uHeat.value = 0.35 + audio.smoothEnergy * 1.6 * p.light * p.master + audio.bass * 0.5;
    u.uFlare.value = this._flare;
    this.ringMat.opacity = 0.6 + audio.energy * 0.4 + this._flare * 0.2;
    this.discLight.intensity = 400 + audio.smoothEnergy * 2200 * p.light + this._flare * 1200;
  }
}
