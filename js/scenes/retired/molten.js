// Molten Core — heavy gravity over a lava floor. Rocks heat up with the energy
// (glow + soften), melt-squash when hot, reform when the track cools. Kicks
// erupt from the core, treble sprays embers.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';
import { NOISE_GLSL, makeRockGeometry } from '../materials.js';

const ROCKS = 30;

export class MoltenScene extends SceneBase {
  defaultGravity() { return { x: 0, y: -16, z: 0 }; }
  envKey() { return 'sunset'; }

  build() {
    const { scene } = this.three;
    scene.fog = new THREE.FogExp2(0x050100, 0.03);
    scene.background = new THREE.Color(0x050100);

    const ambient = new THREE.AmbientLight(0x4a1c08, 1.2);
    this.coreLight = new THREE.PointLight(0xff4400, 3, 60, 1.2);
    this.coreLight.position.set(0, 1.5, 0);
    const top = new THREE.DirectionalLight(0xff9955, 0.8);
    top.position.set(2, 12, 4);
    top.castShadow = true;
    top.shadow.mapSize.set(1024, 1024);
    Object.assign(top.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 });
    scene.add(ambient, this.coreLight, top);
    this.lights.push(ambient, this.coreLight, top);

    // molten floor — flowing fbm lava, self-lit so bloom picks up the cracks
    this.addGroundBox(26, 0.5, 26, -4.5);
    const floorGeo = new THREE.CircleGeometry(34, 64);
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeat: { value: 0.4 },
      },
      vertexShader: /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE_GLSL + /* glsl */`
uniform float uTime, uHeat;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * 14.0;
  // domain-warped flow: lava creeps, doesn't just shimmer
  float q = fbm(vec3(p, uTime * 0.12));
  float n = fbm(vec3(p + q * 1.8, uTime * 0.07));
  float crack = smoothstep(0.12, 0.5, n);
  vec3 crust = vec3(0.03, 0.008, 0.004);
  vec3 hot = mix(vec3(0.9, 0.12, 0.0), vec3(1.0, 0.75, 0.15), smoothstep(0.4, 0.85, n));
  vec3 col = mix(hot * (0.7 + uHeat * 1.8), crust, crack);
  float edge = smoothstep(1.0, 0.55, length(vUv - 0.5) * 2.0); // cool toward rim
  gl_FragColor = vec4(col * edge, 1.0);
}`,
    });
    const floor = new THREE.Mesh(floorGeo, this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -4;
    this.group.add(floor);
    this.disposable(floorGeo, this.floorMat);

    // crater walls
    const R = this.RAPIER;
    const walls = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.world.createCollider(
        R.ColliderDesc.cuboid(5, 8, 0.6)
          .setTranslation(Math.cos(a) * 18, 2, Math.sin(a) * 18)
          .setRotation({ x: 0, y: Math.sin(-a / 2 + Math.PI / 4), z: 0, w: Math.cos(-a / 2 + Math.PI / 4) }),
        walls);
    }

    this.rocks = [];
    for (let i = 0; i < ROCKS; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x4a3328, emissive: 0xff3300, emissiveIntensity: 0.2,
        roughness: 0.9, metalness: 0.05,
      });
      this.disposable(mat);
      const r = 0.4 + Math.random() * 0.6;
      const o = this.addBall(r, {
        x: (Math.random() - 0.5) * 22, y: 2 + Math.random() * 8, z: (Math.random() - 0.5) * 22,
      }, {
        density: 2.5, restitution: 0.3, damping: 0.25, material: mat,
        geometry: makeRockGeometry(r, i * 3.7, 0.4), // jagged, geological
      });
      o.heat = 0;
      this.rocks.push(o);
    }

    this.embers = this.makeParticles(900, { size: 0.14, color: 0xffaa33, opacity: 0.9 });
    this._t = 0;
  }

  onKick(audio) {
    // eruption: rocks near the core get blasted upward
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    for (const o of this.rocks) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.z);
      const boost = Math.max(0, 1 - d / 24);
      o.body.applyImpulse({
        x: (Math.random() - 0.5) * 3 * k,
        y: (6 + Math.random() * 7) * boost * k * o.body.mass() * 0.55,
        z: (Math.random() - 0.5) * 3 * k,
      }, true);
      o.heat = Math.min(1, o.heat + 0.25 * k);
    }
    // ember burst from the core
    for (let i = 0; i < 30 * Math.min(2, k); i++) {
      const a = Math.random() * Math.PI * 2;
      this.emitParticle(this.embers,
        Math.cos(a) * 2, -3.5, Math.sin(a) * 2,
        Math.cos(a) * (2 + Math.random() * 4), 7 + Math.random() * 9, Math.sin(a) * (2 + Math.random() * 4),
        1.2 + Math.random());
    }
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;

    // bass piles on the gravity — heavy drops slam everything to the floor
    this.world.gravity.y = -16 - audio.smoothBass * 26 * p.gravity * p.master;

    // heat follows track energy; rocks melt (squash) when hot, reform when cool
    const ambientHeat = audio.smoothEnergy * 1.3 * p.master;
    for (const o of this.rocks) {
      o.heat += (ambientHeat - o.heat) * dt * 1.4;
      const h = Math.max(0, Math.min(1, o.heat));
      o.mesh.material.emissiveIntensity = 0.2 + h * 2.6 * p.light;
      // melt: squash vertically, spread horizontally
      const squash = 1 - h * 0.45;
      const spread = 1 + h * 0.35;
      o.mesh.scale.set(o.baseScale * spread, o.baseScale * squash, o.baseScale * spread);
      // molten rocks lose bounce, cool rocks regain it
      o.collider.setRestitution(0.05 + (1 - h) * 0.45);
    }

    // treble sprays embers off the hottest rocks
    const rate = audio.treble * p.treble * p.master;
    for (const o of this.rocks) {
      if (o.heat > 0.45 && Math.random() < rate * 1.6) {
        const t = o.body.translation();
        this.emitParticle(this.embers, t.x, t.y + 0.3, t.z,
          (Math.random() - 0.5) * 2, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 2,
          0.7 + Math.random() * 0.8);
      }
    }
    this.stepParticles(this.embers, dt, -4, 0.25);

    // floor and core light breathe with bass + energy
    const e = audio.smoothEnergy * p.light * p.master;
    this.floorMat.uniforms.uTime.value = this._t;
    this.floorMat.uniforms.uHeat.value = 0.25 + audio.bass * 1.6 * p.light + e * 0.8;
    this.coreLight.intensity = 1.5 + e * 10 + audio.kickStrength * 2;
  }
}
