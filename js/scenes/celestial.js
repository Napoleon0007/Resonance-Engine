// Celestial — the real solar system under n-body gravity. Actual NASA-derived
// planet textures (Solar System Scope, CC-BY), axial tilts, Saturn's rings,
// orbit trails. Bass breathes through G, kicks surge gravity + fire comets.

import * as THREE from 'three';
import { SceneBase } from './scene-base.js';

const BASE_G = 14;
const TEX = 'assets/planets/';

// dist/radius are stage-scaled, not to true scale (true scale = invisible dots)
const PLANETS = [
  { name: 'mercury', tex: '2k_mercury.jpg', radius: 0.5, dist: 6.5, tilt: 0.001, spin: 0.12, trail: 0x9a8f7a },
  { name: 'venus', tex: '2k_venus_atmosphere.jpg', radius: 0.85, dist: 9, tilt: 3.09, spin: -0.05, trail: 0xe8c87a },
  { name: 'earth', tex: '2k_earth_daymap.jpg', radius: 0.9, dist: 12, tilt: 0.41, spin: 0.5, trail: 0x4d9fff },
  { name: 'mars', tex: '2k_mars.jpg', radius: 0.65, dist: 15, tilt: 0.44, spin: 0.48, trail: 0xff6a3d },
  { name: 'jupiter', tex: '2k_jupiter.jpg', radius: 1.9, dist: 19.5, tilt: 0.05, spin: 1.2, trail: 0xd8a06a },
  { name: 'saturn', tex: '2k_saturn.jpg', radius: 1.6, dist: 24.5, tilt: 0.47, spin: 1.1, trail: 0xe8d8a0 },
  { name: 'uranus', tex: '2k_uranus.jpg', radius: 1.1, dist: 29, tilt: 1.71, spin: -0.7, trail: 0x7adfe8 },
  { name: 'neptune', tex: '2k_neptune.jpg', radius: 1.05, dist: 33, tilt: 0.49, spin: 0.75, trail: 0x4d6aff },
];

export class CelestialScene extends SceneBase {
  defaultGravity() { return { x: 0, y: 0, z: 0 }; }
  envKey() { return 'night'; }
  lightWorldPos() { return this.sun ? this.sun.body.translation() : { x: 0, y: 0, z: 0 }; }
  cinema() { return { rays: 0.95, streak: 0.75 }; } // one star — full lens drama
  stormColors() { return [0x88aaff, 0xffd0a0]; } // cosmic dust
  stormRadius() { return 60; }
  arcsEnabled() { return false; }

  build() {
    const { scene } = this.three;
    scene.fog = null;
    scene.background = new THREE.Color(0x000004);

    // deep space: 4000 twinkling stars in real stellar colours
    const N_STARS = 4000;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(N_STARS * 3);
    const starCol = new Float32Array(N_STARS * 3);
    const starSeed = new Float32Array(N_STARS);
    const palette = [
      new THREE.Color(0xaecbff), new THREE.Color(0xffffff), new THREE.Color(0xfff4e0),
      new THREE.Color(0xffd9a0), new THREE.Color(0xffb380),
    ];
    for (let i = 0; i < N_STARS; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(110 + Math.random() * 90);
      starPos[i * 3] = v.x; starPos[i * 3 + 1] = v.y; starPos[i * 3 + 2] = v.z;
      const c = palette[Math.floor(Math.random() * palette.length)];
      const b = 0.4 + Math.random() * 0.6;
      starCol[i * 3] = c.r * b; starCol[i * 3 + 1] = c.g * b; starCol[i * 3 + 2] = c.b * b;
      starSeed[i] = Math.random() * 100;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(starCol, 3));
    starGeo.setAttribute('aSeed', new THREE.BufferAttribute(starSeed, 1));
    const starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
uniform float uTime;
attribute vec3 aColor; attribute float aSeed;
varying vec3 vColor;
void main(){
  float tw = 0.65 + 0.35 * sin(uTime * (0.6 + fract(aSeed) * 2.2) + aSeed);
  vColor = aColor * tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (1.2 + fract(aSeed * 7.3) * 2.4) * tw * (260.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */`
varying vec3 vColor;
void main(){
  float d = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vColor * d, d);
}`,
    });
    this.starfield = new THREE.Points(starGeo, starMat);
    this.starMat = starMat;
    this.group.add(this.starfield);
    this.disposable(starGeo, starMat);

    // distant galaxies + nebulae — procedural sprites, slowly turning
    this.galaxies = [];
    const galaxyHues = [[0.65, 0.85], [0.78, 0.6], [0.02, 0.7], [0.55, 0.5], [0.9, 0.65]];
    for (let g = 0; g < 5; g++) {
      const tex = this._galaxyTexture(galaxyHues[g][0], galaxyHues[g][1], g);
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
        rotation: Math.random() * Math.PI * 2,
      });
      const sprite = new THREE.Sprite(mat);
      const dir = new THREE.Vector3().randomDirection();
      if (Math.abs(dir.y) > 0.7) dir.y *= 0.4; // keep them off the poles
      sprite.position.copy(dir.normalize().multiplyScalar(150 + g * 18));
      const s = 45 + Math.random() * 50;
      sprite.scale.set(s, s, 1);
      this.group.add(sprite);
      this.disposable(mat, tex);
      this.galaxies.push({ sprite, spin: (Math.random() - 0.5) * 0.012 });
    }

    const ambient = new THREE.AmbientLight(0x18203a, 0.55);
    this.sunLight = new THREE.PointLight(0xfff2cc, 800, 0, 1.6); // inverse-square, like a real star
    scene.add(ambient, this.sunLight);
    this.lights.push(ambient, this.sunLight);

    const R = this.RAPIER;
    const loader = new THREE.TextureLoader();
    const loadTex = name => {
      const t = loader.load(TEX + name);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };

    // the star — Luke-approved, unchanged look
    this.sunMat = new THREE.MeshStandardMaterial({
      color: 0xffc24d, emissive: 0xff8c00, emissiveIntensity: 2, roughness: 0.4,
    });
    this.disposable(this.sunMat);
    this.sun = this.addBall(2.6, { x: 0, y: 0, z: 0 },
      { density: 40, restitution: 0.4, damping: 0.6, material: this.sunMat });
    this.sun.isSun = true;

    this.planets = [];
    for (const def of PLANETS) {
      const ang = Math.random() * Math.PI * 2;
      const mat = new THREE.MeshStandardMaterial({
        map: loadTex(def.tex), roughness: 0.92, metalness: 0,
      });
      this.disposable(mat);
      const geo = new THREE.SphereGeometry(def.radius, 48, 32);
      this.disposable(geo);
      const o = this.addBall(def.radius, {
        x: Math.cos(ang) * def.dist,
        y: (Math.random() - 0.5) * 1.2,
        z: Math.sin(ang) * def.dist,
      }, { density: 2, restitution: 0.8, damping: 0, material: mat, geometry: geo });

      // axial tilt rig: physics owns position, we own rotation (tilt + spin)
      o.lockRotation = true;
      o.mesh.rotation.z = def.tilt;
      o.spin = def.spin;
      o.def = def;

      if (def.name === 'saturn') {
        const ringTex = loader.load(TEX + '2k_saturn_ring_alpha.png');
        ringTex.colorSpace = THREE.SRGBColorSpace;
        const ringGeo = new THREE.RingGeometry(def.radius * 1.25, def.radius * 2.3, 96);
        // remap ring UVs radially so the strip texture wraps as real ring bands
        const pos = ringGeo.attributes.position;
        const uv = ringGeo.attributes.uv;
        const inner = def.radius * 1.25, outer = def.radius * 2.3;
        for (let i = 0; i < pos.count; i++) {
          const r = Math.hypot(pos.getX(i), pos.getY(i));
          uv.setXY(i, (r - inner) / (outer - inner), 0.5);
        }
        const ringMat = new THREE.MeshBasicMaterial({
          map: ringTex, side: THREE.DoubleSide, transparent: true,
          opacity: 0.95, depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        o.mesh.add(ring);
        this.disposable(ringGeo, ringMat, ringTex);
      }

      // circular orbit start: v = sqrt(G*M/r)
      const m = this.sun.body.mass();
      const v = Math.sqrt((BASE_G * m) / def.dist) * (0.95 + Math.random() * 0.1);
      o.body.setLinvel({ x: -Math.sin(ang) * v, y: 0, z: Math.cos(ang) * v }, true);
      this.addRibbon(o, new THREE.Color(def.trail), 130, 0.55);
      this.planets.push(o);
    }

    // distant aurora veil across deep space
    this.aurora = this.makeAurora({ radius: 95, height: 80, y: 0, colorA: 0x2244ff, colorB: 0xb14cff });

    this.stardust = this.makeParticles(1200, { size: 0.1, color: 0x9fc8ff, opacity: 0.6 });
    this.comets = [];
    this._t = 0;
  }

  // spiral galaxy / nebula painted onto a canvas — no downloads needed
  _galaxyTexture(hue, sat, seed) {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const cx = S / 2, cy = S / 2;
    // core glow
    let grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.18);
    grad.addColorStop(0, `hsla(${hue * 360}, ${sat * 60}%, 85%, 0.9)`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    // spiral arms: blobs along two logarithmic spirals
    let rng = 12.9898 + seed * 78.233;
    const rand = () => { rng = (rng * 16807) % 2147483647; return (rng % 1000) / 1000; };
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < 90; i++) {
        const t = i / 90;
        const ang = arm * Math.PI + t * 4.2 + rand() * 0.5;
        const r = 8 + t * S * 0.42;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r * 0.55; // squashed = inclined disc
        const size = (1 - t) * 16 + 3;
        grad = ctx.createRadialGradient(x, y, 0, x, y, size);
        const l = 55 + rand() * 25;
        grad.addColorStop(0, `hsla(${(hue + rand() * 0.06) * 360}, ${sat * 100}%, ${l}%, ${0.16 * (1 - t * 0.6)})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, S, S);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  onOnset(audio) {
    // melody hits flare the star
    this._sunFlare = Math.min(1.5, (this._sunFlare || 0) + audio.onsetStrength * 0.35);
  }

  onKick(audio) {
    const k = audio.kickStrength * this.params.impulse * this.params.master;
    // gravity surge: planets lurch toward the star, orbits swing eccentric
    for (const o of this.planets) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y, t.z) || 1;
      o.body.applyImpulse({
        x: -t.x / d * 0.9 * k * o.body.mass(),
        y: -t.y / d * 0.9 * k * o.body.mass(),
        z: -t.z / d * 0.9 * k * o.body.mass(),
      }, true);
    }
    if (audio.kickStrength > 1.35 && this.comets.length < 6) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xcfffff, emissive: 0x88f0ff, emissiveIntensity: 2.5, roughness: 0.2,
      });
      this.disposable(mat);
      const ang = Math.random() * Math.PI * 2;
      const o = this.addBall(0.3, { x: Math.cos(ang) * 42, y: (Math.random() - 0.5) * 14, z: Math.sin(ang) * 42 },
        { density: 1.5, restitution: 0.9, damping: 0, material: mat });
      o.body.setLinvel({ x: -Math.cos(ang) * 17, y: (Math.random() - 0.5) * 4, z: -Math.sin(ang) * 17 }, true);
      o.isComet = true; o.age = 0;
      this.comets.push(o);
    }
  }

  updateScene(dt, audio) {
    this._t += dt;
    const p = this.params;

    // bass breathes through the gravitational constant
    const G = BASE_G * (0.6 + audio.smoothBass * 2.0 * p.gravity * p.master);

    const bodies = this.objects;
    for (const o of bodies) o.body.resetForces(true);
    for (let i = 0; i < bodies.length; i++) {
      const A = bodies[i];
      const ta = A.body.translation();
      for (let j = i + 1; j < bodies.length; j++) {
        const B = bodies[j];
        const tb = B.body.translation();
        const dx = tb.x - ta.x, dy = tb.y - ta.y, dz = tb.z - ta.z;
        const d2 = Math.max(3, dx * dx + dy * dy + dz * dz);
        const f = (G * A.body.mass() * B.body.mass()) / d2;
        const d = Math.sqrt(d2);
        const fx = f * dx / d, fy = f * dy / d, fz = f * dz / d;
        A.body.addForce({ x: fx, y: fy, z: fz }, true);
        B.body.addForce({ x: -fx, y: -fy, z: -fz }, true);
      }
    }

    // keep the star centred
    const st = this.sun.body.translation();
    this.sun.body.addForce({ x: -st.x * 80, y: -st.y * 80, z: -st.z * 80 }, true);

    // soft recall for flung planets
    for (const o of this.planets) {
      const t = o.body.translation();
      const d = Math.hypot(t.x, t.y, t.z);
      if (d > 40) {
        const pull = (d - 40) * 2.5 * o.body.mass();
        o.body.addForce({ x: -t.x / d * pull, y: -t.y / d * pull, z: -t.z / d * pull }, true);
        const v = o.body.linvel();
        o.body.setLinvel({ x: v.x * 0.995, y: v.y * 0.995, z: v.z * 0.995 }, true);
      }
      // axial day-spin (physics owns orbit; render owns rotation on the axis)
      o.mesh.rotateY(o.spin * dt * (1 + audio.smoothEnergy * 2));
    }

    // comets age out, treble stardust
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.age += dt;
      const t = c.body.translation();
      this.emitParticle(this.stardust, t.x, t.y, t.z, 0, 0, 0, 0.9);
      if (c.age > 14 || Math.hypot(t.x, t.y, t.z) > 110) {
        this.world.removeRigidBody(c.body);
        this.group.remove(c.mesh);
        this.objects.splice(this.objects.indexOf(c), 1);
        this.comets.splice(i, 1);
      }
    }
    this.stepParticles(this.stardust, dt, 0, 0.4);

    // star throbs with energy; melody onsets flare it
    this._sunFlare = Math.max(0, (this._sunFlare || 0) - dt * 2.5);
    const e = audio.smoothEnergy * p.light * p.master;
    this.sunLight.intensity = 500 + e * 2600 + this._sunFlare * 900;
    this.sunMat.emissiveIntensity = 1.2 + e * 4 + this._sunFlare * 2;
    const pulse = 1 + Math.sin(this._t * 6) * 0.02 + audio.bass * 0.12;
    this.sun.mesh.scale.setScalar(this.sun.baseScale * pulse);
    this.starfield.rotation.y += dt * 0.008;
    this.starMat.uniforms.uTime.value = this._t;
    this.aurora.mat.uniforms.uTime.value = this._t;
    this.aurora.mat.uniforms.uMid.value = audio.mid;
    this.aurora.mat.uniforms.uEnergy.value = audio.smoothEnergy;
    for (const g of this.galaxies) g.sprite.material.rotation += g.spin * dt * (1 + audio.smoothEnergy * 3);
  }
}
