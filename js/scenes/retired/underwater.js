// Underwater Realm — buoyant drifting orbs, joint-chained kelp swaying with the
// mids, rising bubbles driven by treble, pressure-wave impulses on every kick.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';
import { makeLiquidMaterial } from '../materials.js';

const ORBS = 26;
const KELP_STRANDS = 7;
const KELP_LINKS = 6;

export class UnderwaterScene extends SceneBase {
  defaultGravity() { return { x: 0, y: -1.2, z: 0 }; }

  build() {
    const { scene } = this.three;
    // black abyss — everything visible is bioluminescent
    scene.fog = new THREE.FogExp2(0x000508, 0.024);
    scene.background = new THREE.Color(0x000508);

    const ambient = new THREE.AmbientLight(0x103a44, 0.6);
    this.keyLight = new THREE.DirectionalLight(0x6fd8ff, 1.0);
    this.keyLight.position.set(4, 14, 6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.keyLight.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 });
    this.glow = new THREE.PointLight(0x00f0ff, 1.2, 40);
    this.glow.position.set(0, 4, 0);
    scene.add(ambient, this.keyLight, this.glow);
    this.lights.push(ambient, this.keyLight, this.glow);

    this.addGroundBox(30, 0.5, 30, -6.5);
    const floorGeo = new THREE.PlaneGeometry(60, 60);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x021016, roughness: 0.95, metalness: 0, envMapIntensity: 0.12,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -6;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.disposable(floorGeo, floorMat);

    // invisible walls keep the school of orbs in frame
    const R = this.RAPIER;
    const walls = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const [x, z, hx, hz] of [[16, 0, 0.5, 16], [-16, 0, 0.5, 16], [0, 16, 16, 0.5], [0, -16, 16, 0.5]]) {
      this.world.createCollider(R.ColliderDesc.cuboid(hx, 12, hz).setTranslation(x, 4, z), walls);
    }
    // water surface — buoyant orbs bob against it instead of escaping
    this.world.createCollider(R.ColliderDesc.cuboid(16, 0.5, 16).setTranslation(0, 12, 0), walls);

    this.orbMats = [];
    for (let i = 0; i < ORBS; i++) {
      const hue = 0.42 + Math.random() * 0.2; // teal -> cyan -> blue
      const color = new THREE.Color().setHSL(hue, 0.95, 0.55);
      // a handful of true liquid-glass orbs (transmission is pricey), the rest
      // wobbling glow-jellies — all organic, all bioluminescent
      const mat = i < 6
        ? makeLiquidMaterial(color, { wobbleScale: 1.8 })
        : makeLiquidMaterial(color, { transmission: 0, wobbleScale: 2.2 });
      this.orbMats.push(mat);
      this.disposable(mat);
      const orb = this.addBall(0.35 + Math.random() * 0.5, {
        x: (Math.random() - 0.5) * 20,
        y: -2 + Math.random() * 10,
        z: (Math.random() - 0.5) * 20,
      }, { density: 0.8, restitution: 0.4, damping: 2.6, material: mat });
      orb.buoyancy = 0.9 + Math.random() * 0.25; // ~neutral, each drifts differently
      if (i < 9) this.addRibbon(orb, color.clone().multiplyScalar(1.2), 48); // glowing wakes
    }

    // kelp: chains of small bodies joined by spherical joints, anchored to the floor
    this.kelpTips = [];
    const kelpMat = new THREE.MeshStandardMaterial({
      color: 0x0a3a22, emissive: 0x39ff88, emissiveIntensity: 0.8, roughness: 0.5,
    });
    this.disposable(kelpMat);
    const linkGeo = new THREE.CapsuleGeometry(0.16, 0.7, 4, 8);
    this.disposable(linkGeo);
    for (let s = 0; s < KELP_STRANDS; s++) {
      const bx = (Math.random() - 0.5) * 22;
      const bz = (Math.random() - 0.5) * 22;
      let prev = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(bx, -6, bz));
      for (let l = 0; l < KELP_LINKS; l++) {
        const y = -6 + (l + 1) * 1.1;
        const body = this.world.createRigidBody(
          R.RigidBodyDesc.dynamic().setTranslation(bx, y, bz)
            .setLinearDamping(3.5).setAngularDamping(3.5)
        );
        this.world.createCollider(R.ColliderDesc.capsule(0.35, 0.16).setDensity(0.5), body);
        const joint = R.JointData.spherical({ x: 0, y: l === 0 ? 0 : 0.55, z: 0 }, { x: 0, y: -0.55, z: 0 });
        this.world.createImpulseJoint(joint, prev, body, true);
        const mesh = new THREE.Mesh(linkGeo, kelpMat);
        this.track(body, mesh, { isKelp: true, phase: s * 1.7 + l * 0.6 });
        if (l === KELP_LINKS - 1) this.kelpTips.push(body);
        prev = body;
      }
    }

    this.bubbles = this.makeParticles(600, { size: 0.16, color: 0x9fe8ff, opacity: 0.7 });
    this._t = 0;
  }

  onKick(audio) {
    // pressure wave from the centre — orbs surge outward and upward
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    for (const o of this.objects) {
      if (o.isKelp) continue;
      const t = o.body.translation();
      const len = Math.hypot(t.x, t.z) || 1;
      o.body.applyImpulse({
        x: (t.x / len) * 1.8 * k,
        y: (0.8 + Math.random() * 1.6) * k,
        z: (t.z / len) * 1.8 * k,
      }, true);
    }
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;

    // bass swells make the water "heavier" (stronger sink), quiet = near-buoyant
    this.world.gravity.y = -1.2 - audio.smoothBass * 9 * p.gravity * p.master;

    // mids push a slow current through the kelp; orbs ride near-neutral buoyancy
    const sway = audio.mid * 6 * p.master;
    const g = this.world.gravity.y;
    for (const o of this.objects) {
      o.body.resetForces(true);
      if (o.isKelp) {
        o.body.addForce({
          x: Math.sin(this._t * 1.3 + o.phase) * sway,
          y: 1.2, // buoyancy keeps strands upright
          z: Math.cos(this._t * 0.9 + o.phase) * sway * 0.6,
        }, true);
      } else if (o.buoyancy) {
        o.body.addForce({ x: 0, y: -g * o.body.mass() * o.buoyancy, z: 0 }, true);
      }
    }

    // treble emits bubbles from kelp tips
    const rate = audio.treble * 14 * p.treble * p.master;
    if (this.playingBubbles !== false) {
      for (const tip of this.kelpTips) {
        if (Math.random() < rate * dt * 4) {
          const t = tip.translation();
          this.emitParticle(this.bubbles, t.x, t.y, t.z,
            (Math.random() - 0.5) * 0.4, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.4,
            3 + Math.random() * 2);
        }
      }
    }
    this.stepParticles(this.bubbles, dt, 0.8, 0.3);

    // energy drives the light and orb glow; bass + mids drive the wobble
    this.glow.intensity = 0.6 + audio.smoothEnergy * 5 * p.light * p.master;
    this.keyLight.intensity = 1 + audio.energy * 2 * p.light;
    const glowAmt = 0.35 + audio.energy * 2.2 * p.light;
    const wobble = 0.04 + (audio.smoothBass * 0.5 + audio.mid * 0.3) * 0.5 * p.master;
    for (const m of this.orbMats) {
      m.emissiveIntensity = glowAmt;
      m.userData.uTime.value = this._t;
      m.userData.uWobble.value = wobble;
    }
  }
}
