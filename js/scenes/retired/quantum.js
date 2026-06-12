// Quantum Realm — near-zero gravity. Each body has an entangled twin (impulses
// mirror instantly) and a cloud of superposition ghosts that spread with the
// treble and collapse to the true position on strong beats.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';

const PAIRS = 10;
const GHOSTS_PER_BODY = 3;

export class QuantumScene extends SceneBase {
  defaultGravity() { return { x: 0, y: 0, z: 0 }; }
  envKey() { return 'dusk'; }
  kaleido() { return 0.3; } // mandala fold — superposition you can see

  build() {
    const { scene } = this.three;
    scene.fog = new THREE.FogExp2(0x020008, 0.022);
    scene.background = new THREE.Color(0x020008);

    const ambient = new THREE.AmbientLight(0x3a2a6e, 0.8);
    this.coreLight = new THREE.PointLight(0xff2bd6, 2, 60);
    const rim = new THREE.DirectionalLight(0x00f0ff, 0.8);
    rim.position.set(-6, 8, -4);
    scene.add(ambient, this.coreLight, rim);
    this.lights.push(ambient, this.coreLight, rim);

    // containment sphere (invisible walls via 6 cuboids)
    const R = this.RAPIER;
    const walls = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const D = 13;
    for (const [x, y, z, hx, hy, hz] of [
      [D, 0, 0, 0.5, D, D], [-D, 0, 0, 0.5, D, D],
      [0, D, 0, D, 0.5, D], [0, -D, 0, D, 0.5, D],
      [0, 0, D, D, D, 0.5], [0, 0, -D, D, D, 0.5],
    ]) this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z), walls);

    this.pairs = [];
    this.ghosts = [];
    const ghostGeo = new THREE.IcosahedronGeometry(1, 1);
    this.disposable(ghostGeo);

    for (let i = 0; i < PAIRS; i++) {
      const hueA = i / PAIRS;
      const pair = [];
      for (let half = 0; half < 2; half++) {
        const hue = (hueA + half * 0.5) % 1;
        const mat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color().setHSL(hue, 0.9, 0.5),
          emissive: new THREE.Color().setHSL(hue, 1, 0.5),
          emissiveIntensity: 1.1, roughness: 0.15, metalness: 0.7,
          iridescence: 0.9, envMapIntensity: 1.6,
        });
        this.disposable(mat);
        const r = 0.4 + Math.random() * 0.35;
        const o = this.addBall(r, {
          x: (Math.random() - 0.5) * 18,
          y: (Math.random() - 0.5) * 18,
          z: (Math.random() - 0.5) * 18,
        }, { density: 1, restitution: 0.95, damping: 0.12, material: mat });
        this.addRibbon(o, new THREE.Color().setHSL(hue, 1, 0.55), 56, 0.45); // light-painting
        o.body.applyImpulse({
          x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3,
        }, true);
        o.hue = hue;
        pair.push(o);

        // superposition ghosts — render-only echoes of where the body "might" be
        const gmat = new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(hue, 1, 0.7),
          transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        this.disposable(gmat);
        for (let g = 0; g < GHOSTS_PER_BODY; g++) {
          const gm = new THREE.Mesh(ghostGeo, gmat);
          gm.scale.setScalar(r);
          this.group.add(gm);
          this.ghosts.push({
            mesh: gm, owner: o, mat: gmat,
            phase: Math.random() * Math.PI * 2,
            axis: new THREE.Vector3().randomDirection(),
            collapse: 0,
          });
        }
      }
      // entanglement beam
      const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const beamMat = new THREE.LineBasicMaterial({
        color: new THREE.Color().setHSL(hueA, 1, 0.65), transparent: true, opacity: 0.3,
      });
      const beam = new THREE.Line(beamGeo, beamMat);
      this.group.add(beam);
      this.disposable(beamGeo, beamMat);
      this.pairs.push({ a: pair[0], b: pair[1], beam, beamGeo });
    }

    this.sparks = this.makeParticles(500, { size: 0.1, color: 0xff2bd6, opacity: 0.9 });
    this._t = 0;
  }

  onKick(audio) {
    // wave function collapse: ghosts snap home; entangled pairs get equal and
    // OPPOSITE impulses (spooky action at a distance)
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    for (const g of this.ghosts) g.collapse = 1;
    for (const { a, b } of this.pairs) {
      const dir = new THREE.Vector3().randomDirection().multiplyScalar(2.4 * k);
      a.body.applyImpulse({ x: dir.x, y: dir.y, z: dir.z }, true);
      b.body.applyImpulse({ x: -dir.x, y: -dir.y, z: -dir.z }, true);
    }
    // very hard hits tunnel one random pair to new positions
    if (audio.kickStrength > 1.6) {
      const { a, b } = this.pairs[Math.floor(Math.random() * this.pairs.length)];
      for (const o of [a, b]) {
        o.body.setTranslation({
          x: (Math.random() - 0.5) * 18, y: (Math.random() - 0.5) * 18, z: (Math.random() - 0.5) * 18,
        }, true);
        const t = o.body.translation();
        for (let i = 0; i < 12; i++) {
          this.emitParticle(this.sparks, t.x, t.y, t.z,
            (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, 0.8);
        }
      }
    }
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;

    // bass bends spacetime: pulls everything toward the origin
    const pull = audio.smoothBass * 14 * p.gravity * p.master;
    for (const o of this.objects) {
      const t = o.body.translation();
      const len = Math.hypot(t.x, t.y, t.z) || 1;
      o.body.resetForces(true);
      o.body.addForce({ x: -t.x / len * pull, y: -t.y / len * pull, z: -t.z / len * pull }, true);
    }

    // treble widens the superposition cloud; collapse springs ghosts back
    const spread = 0.4 + audio.treble * 4.5 * p.treble * p.master;
    for (const g of this.ghosts) {
      g.collapse = Math.max(0, g.collapse - dt * 3);
      const o = g.owner.mesh.position;
      const s = spread * (1 - g.collapse);
      const w = this._t * 2.2 + g.phase;
      g.mesh.position.set(
        o.x + Math.sin(w) * g.axis.x * s,
        o.y + Math.sin(w * 1.3) * g.axis.y * s,
        o.z + Math.cos(w * 0.8) * g.axis.z * s,
      );
      g.mat.opacity = g.collapse > 0 ? 0.5 : 0.10 + audio.treble * 0.3;
    }

    // entanglement beams + restitution from treble
    for (const { a, b, beamGeo, beam } of this.pairs) {
      const pos = beamGeo.attributes.position.array;
      pos[0] = a.mesh.position.x; pos[1] = a.mesh.position.y; pos[2] = a.mesh.position.z;
      pos[3] = b.mesh.position.x; pos[4] = b.mesh.position.y; pos[5] = b.mesh.position.z;
      beamGeo.attributes.position.needsUpdate = true;
      beam.material.opacity = 0.12 + audio.energy * 0.5;
      a.collider.setRestitution(0.6 + audio.treble * 0.4 * p.treble);
      b.collider.setRestitution(0.6 + audio.treble * 0.4 * p.treble);
    }

    this.stepParticles(this.sparks, dt, 0, 1.2);
    this.coreLight.intensity = 1 + audio.smoothEnergy * 7 * p.light * p.master;
  }
}
