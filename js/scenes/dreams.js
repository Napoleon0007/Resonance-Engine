// Dreams — a surreal photographic collage. Real images (clouds, rabbits, koi,
// moths, eyes, jellyfish, flowers, smoke) float as soft-edged cards at many
// depths. Each card melts under a music-driven flow warp, is double-exposed
// with a second photo, and graded toward the song's key colour. The camera
// drifts among them; beats jostle the cards and pulse them brighter.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';
import { NOISE_GLSL } from '../materials.js';

const IMAGES = ['clouds', 'rabbit', 'koi', 'moth', 'eye', 'jellyfish', 'flower', 'smoke'];
const DRIFT_CARDS = 12;   // physics-driven, drifting in the foreground
const STATIC_CARDS = 10;  // fixed depths, parallax backdrop

export class DreamsScene extends SceneBase {
  defaultGravity() { return { x: 0, y: 0, z: 0 }; }
  envKey() { return 'dusk'; }
  cinema() { return { rays: 0.15, streak: 0.4 }; }
  kaleido() { return 0; } // keep the real things recognisable
  trails() { return 0.55; }
  stormCount() { return this.shared.mobile ? 4000 : 12000; } // faint dust
  stormColors() { return [0xff80e0, 0x80c0ff]; }
  arcsEnabled() { return false; }

  build() {
    const { scene } = this.three;
    scene.fog = new THREE.FogExp2(0x05030a, 0.012);
    scene.background = new THREE.Color(0x05030a);

    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    this.glow = new THREE.PointLight(0xff80e0, 2, 80);
    scene.add(ambient, this.glow);
    this.lights.push(ambient, this.glow);

    // load the photo set
    const loader = new THREE.TextureLoader();
    this.textures = IMAGES.map(name => {
      const t = loader.load(`assets/dreams/${name}.jpg`);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });

    this.cards = [];
    const R = this.RAPIER;

    // bounded box so drifting cards never wander off
    const walls = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const B = 22;
    for (const [x, y, z, hx, hy, hz] of [
      [B, 0, 0, 0.5, B, B], [-B, 0, 0, 0.5, B, B],
      [0, B, 0, B, 0.5, B], [0, -B, 0, B, 0.5, B],
      [0, 0, B, B, B, 0.5], [0, 0, -B, B, B, 0.5],
    ]) this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z), walls);

    // --- drifting foreground cards (physics) ---
    for (let i = 0; i < DRIFT_CARDS; i++) {
      const size = 5 + Math.random() * 5;
      const mesh = this._makeCard(i, size);
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation((Math.random() - 0.5) * 28, (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 28)
          .setLinearDamping(0.4));
      this.world.createCollider(R.ColliderDesc.ball(size * 0.32).setRestitution(0.7).setDensity(0.4), body);
      body.setLinvel({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 }, true);
      const o = this.track(body, mesh);
      o.lockRotation = true; // we billboard it ourselves
      o.card = mesh.userData;
    }

    // --- static parallax backdrop cards ---
    for (let i = 0; i < STATIC_CARDS; i++) {
      const size = 6 + Math.random() * 8;
      const mesh = this._makeCard(i + 3, size);
      mesh.position.set((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 36, -18 - Math.random() * 40);
      this.group.add(mesh);
      this.cards.push({ mesh, drift: (Math.random() - 0.5) * 0.3 });
    }

    this._t = 0;
    this._beat = 0;
  }

  _makeCard(seed, size) {
    const a = this.textures[seed % this.textures.length];
    const b = this.textures[(seed * 3 + 1) % this.textures.length]; // a different one
    const uniforms = {
      tA: { value: a }, tB: { value: b },
      uTime: { value: 0 }, uWarp: { value: 0.03 },
      uMix: { value: 0.12 + Math.random() * 0.16 },  // ghost of a 2nd photo, subtle
      uTint: { value: new THREE.Color(0.6, 0.4, 0.9) },
      uTintAmt: { value: 0.22 },
      uBright: { value: 1 },
      uSeed: { value: Math.random() * 10 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms,
      vertexShader: /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE_GLSL + /* glsl */`
uniform sampler2D tA, tB;
uniform float uTime, uWarp, uMix, uTintAmt, uBright, uSeed;
uniform vec3 uTint;
varying vec2 vUv;
void main(){
  // music-driven flow warp — the photo melts and breathes
  vec2 w = vec2(
    fbm(vec3(vUv * 3.0, uTime * 0.3 + uSeed)),
    fbm(vec3(vUv * 3.0 + 5.2, uTime * 0.25 + uSeed)));
  vec2 uvA = vUv + (w - 0.5) * uWarp;
  vec2 uvB = vUv + (w.yx - 0.5) * uWarp * 1.4 + 0.015 * sin(uTime * 0.2);
  vec3 ca = texture2D(tA, uvA).rgb;       // the real photo, stays dominant
  vec3 cb = texture2D(tB, uvB).rgb;       // a faint second photo ghosted in
  vec3 col = ca + cb * uMix * (0.4 + ca * 0.6); // double-exposure ghost, readable
  // gentle wash of the song's key colour — keeps the photo's real colours
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, mix(col, uTint * (0.5 + lum), 0.85), uTintAmt);
  col *= uBright;
  // soft feather: most of the photo shows, just the edges dissolve to nothing
  vec2 d = abs(vUv - 0.5) * 2.0;
  float edge = (1.0 - smoothstep(0.7, 1.0, d.x)) * (1.0 - smoothstep(0.7, 1.0, d.y));
  gl_FragColor = vec4(col, edge * 0.96);
}`,
    });
    const geo = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = uniforms;
    this.disposable(geo, mat);
    return mesh;
  }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    this._beat = Math.min(1.8, this._beat + k * 0.6);
    for (const o of this.objects) {
      o.body.applyImpulse({
        x: (Math.random() - 0.5) * 2.2 * k,
        y: (Math.random() - 0.5) * 2.2 * k,
        z: (Math.random() - 0.5) * 2.2 * k,
      }, true);
    }
  }

  onOnset(audio) {
    this._beat = Math.min(1.8, this._beat + audio.onsetStrength * 0.25 * this.params.master);
  }

  hottestPoint() { return { point: new THREE.Vector3(0, 0, 0), energy: 0 }; }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;
    this._beat = Math.max(0, this._beat - dt * 2.2);

    const camPos = this.three.camera.position;
    const key = new THREE.Color().setHSL(audio.keyHue, 0.7, 0.6);
    // keep the warp gentle — the photos should melt a little, not dissolve
    const warp = 0.025 + audio.smoothBass * 0.13 * p.gravity * p.master + this._beat * 0.025;
    const bright = 0.95 + audio.smoothEnergy * 0.4 * p.light + this._beat * 0.3;

    const applyCard = (u) => {
      u.uTime.value = this._t;
      u.uWarp.value = warp;
      u.uBright.value = bright;
      u.uTint.value.lerp(key, dt * 1.2);
      u.uTintAmt.value = 0.35 + audio.smoothPresence * 0.35; // vocals pull the grade
    };

    // drifting cards: gentle centre tether + billboard to camera
    for (const o of this.objects) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y, t.z) || 1;
      o.body.resetForces(true);
      o.body.addForce({ x: -t.x / d * 0.12, y: -t.y / d * 0.12, z: -t.z / d * 0.12 }, true);
      o.mesh.lookAt(camPos);
      applyCard(o.card);
    }

    // static parallax cards: slow sway + billboard
    for (const c of this.cards) {
      c.mesh.position.x += Math.sin(this._t * 0.2 + c.mesh.position.y) * c.drift * dt;
      c.mesh.lookAt(camPos);
      applyCard(c.mesh.userData);
    }

    this.glow.color.lerp(key, dt * 1.2);
    this.glow.intensity = 1.5 + audio.smoothEnergy * 6 * p.light * p.master;
  }
}
