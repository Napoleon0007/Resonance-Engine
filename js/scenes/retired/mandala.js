// Mandala — folding kaleidoscope (reference: Visualizer 3). Emerald + amber
// bodies swirl around the screen centre; a strong screen-space fold turns
// their light and trails into a live radial mandala. Kicks burst petals.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';

const SWIRLERS = 22;

export class MandalaScene extends SceneBase {
  defaultGravity() { return { x: 0, y: 0, z: 0 }; }
  envKey() { return 'dusk'; }
  kaleido() { return { mix: 0.75, segs: 8 }; }
  wantsDOF() { return false; } // crisp petals, like the reference

  build() {
    const { scene } = this.three;
    scene.fog = new THREE.FogExp2(0x000200, 0.02);
    scene.background = new THREE.Color(0x000200);

    const ambient = new THREE.AmbientLight(0x103305, 0.7);
    this.glow = new THREE.PointLight(0x39ff88, 3, 60);
    scene.add(ambient, this.glow);
    this.lights.push(ambient, this.glow);

    // swirling bodies — the raw material the fold turns into petals
    for (let i = 0; i < SWIRLERS; i++) {
      // emerald / amber split like the reference
      const hue = i % 3 === 0 ? 0.09 + Math.random() * 0.04 : 0.35 + Math.random() * 0.08;
      const color = new THREE.Color().setHSL(hue, 1, 0.5);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x051005, emissive: color, emissiveIntensity: 2.4,
        roughness: 0.4,
      });
      this.disposable(mat);
      const dist = 3 + (i / SWIRLERS) * 9;
      const ang = (i / SWIRLERS) * Math.PI * 2;
      const o = this.addBall(0.45 + Math.random() * 0.4, {
        x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, z: (Math.random() - 0.5) * 4,
      }, { density: 1, restitution: 0.9, damping: 1.4, material: mat });
      // orbit in the camera-facing plane so the fold sees maximum motion
      o.body.setLinvel({ x: -Math.sin(ang) * 2.5, y: Math.cos(ang) * 2.5, z: 0 }, true);
      o.swirlDist = dist;
      this.addRibbon(o, color, 90, 0.7);
    }

    this.sparks = this.makeParticles(700, { size: 0.12, color: 0x9fff66, opacity: 0.9 });
    this._t = 0;
  }

  // keep the camera dead-centred — the mandala lives at screen centre
  hottestPoint() { return { point: new THREE.Vector3(0, 0, 0), energy: 0 }; }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    // petal burst: everything shoved outward in the orbit plane
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y) || 1;
      o.body.applyImpulse({ x: t.x / d * 1.4 * k, y: t.y / d * 1.4 * k, z: 0 }, true);
      if (Math.random() < 0.5) {
        for (let i = 0; i < 6; i++) {
          this.emitParticle(this.sparks, t.x, t.y, t.z,
            (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2,
            0.8 + Math.random() * 0.6);
        }
      }
    }
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;

    // swirl: spring back to home radius + tangential drive from the mids
    const swirl = (1.5 + audio.mid * 7 * p.treble) * p.master;
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y) || 1;
      const m = o.body.mass();
      const radial = (o.swirlDist - d) * 5 * m; // home-radius spring
      o.body.resetForces(true);
      o.body.addForce({
        x: (t.x / d) * radial + (-t.y / d) * swirl * m,
        y: (t.y / d) * radial + (t.x / d) * swirl * m,
        z: -t.z * 3 * m, // squeeze toward the fold plane
      }, true);
      // hard speed cap — the swirl must never sling bodies out of frame
      const v = o.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > 9) {
        const s = 9 / speed;
        o.body.setLinvel({ x: v.x * s, y: v.y * s, z: v.z * s }, true);
      }
    }

    // continuous spark stream off the swirlers keeps the fold fed with light
    const rate = (0.15 + audio.treble * 1.2 * p.treble) * p.master;
    for (const o of this.objects) {
      if (Math.random() < rate) {
        const t = o.body.translation();
        const v = o.body.linvel();
        this.emitParticle(this.sparks, t.x, t.y, t.z,
          v.x * 0.3 + (Math.random() - 0.5), v.y * 0.3 + (Math.random() - 0.5), (Math.random() - 0.5),
          1.2 + Math.random());
      }
    }
    this.stepParticles(this.sparks, dt, 0, 0.8);
    this.glow.intensity = 1.5 + audio.smoothEnergy * 8 * p.light * p.master;
  }
}
