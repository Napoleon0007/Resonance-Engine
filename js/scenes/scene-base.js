// SceneBase — owns one Rapier world + one THREE.Group, keeps meshes synced to
// bodies, and provides shared helpers (particles, body bookkeeping, disposal).

import * as THREE from 'three';
import { NOISE_GLSL } from '../materials.js';

export class SceneBase {
  constructor(RAPIER, three, params, shared = {}) {
    this.RAPIER = RAPIER;
    this.three = three;          // { scene, camera, renderer }
    this.params = params;        // live sensitivity values from the UI
    this.shared = shared;        // { freqTex, env } provided by the app
    this.group = new THREE.Group();
    this.world = null;
    this.objects = [];           // { body, mesh, baseScale }
    this.lights = [];
    this.ribbons = [];
    this._arcs = [];             // live electric arcs (fade + recycle)
    this._disposables = [];
  }

  // does this scene fire electric arcs between its bodies on snares?
  arcsEnabled() { return true; }
  arcColor() { return 0x9fe8ff; }

  // override per scene: which HDRI lights it + kaleidoscope amount + DOF
  envKey() { return 'studio'; }
  kaleido() { return 0; }
  wantsDOF() { return true; }
  lightWorldPos() { return { x: 0, y: 0, z: 0 }; } // god-ray source
  // per-scene lens character: god rays suit one dominant light; scenes made
  // of many bright points need them nearly off or the frame fills with haze
  cinema() { return { rays: 0.5, streak: 0.6 }; }
  lens() { return 0; } // gravitational lensing strength (black hole = 1)
  trails() { return 0; } // frame-feedback echo damping 0..0.95 (light-trails)

  init() {
    this.world = new this.RAPIER.World(this.defaultGravity());
    this.three.scene.add(this.group);
    this.three.scene.environment = this.shared.env?.get(this.envKey()) || null;
    this.build();
    const n = this.stormCount();
    if (n > 0) this._storm = this.makeParticleStorm(n, this.stormColors(), this.stormRadius());
  }

  defaultGravity() { return { x: 0, y: -9.81, z: 0 }; }
  build() {}
  onKick(_audio) {}
  onOnset(_audio) {}
  onHat(_audio) {}
  updateScene(_dt, _audio) {}

  // ambient GPU particle storm — drifting glow dust, all motion on the GPU.
  // Scenes override count/colours/radius; 0 opts out.
  stormCount() { return this.shared.mobile ? 9000 : 30000; }
  stormColors() { return [0x00f0ff, 0xb14cff]; }
  stormRadius() { return 34; }

  // Camera director queries this for "most energetic action".
  hottestPoint() {
    let best = null, bestE = -1;
    for (const o of this.objects) {
      if (!o.body || o.body.isFixed()) continue;
      const v = o.body.linvel();
      const e = (v.x * v.x + v.y * v.y + v.z * v.z) * o.body.mass();
      if (e > bestE) { bestE = e; best = o; }
    }
    if (!best) return { point: new THREE.Vector3(0, 0, 0), energy: 0 };
    const t = best.body.translation();
    return { point: new THREE.Vector3(t.x, t.y, t.z), energy: bestE };
  }

  step(dt, audio) {
    if (this._storm) {
      const u = this._storm.mat.uniforms;
      u.uTime.value += dt;
      u.uBass.value = audio.smoothBass;
      u.uEnergy.value = audio.smoothEnergy;
      u.uKey.value.setHSL(audio.keyHue, 0.7, 0.6);
    }
    if (audio.kick) this.onKick(audio);
    if (audio.onset) this.onOnset(audio);
    if (audio.hat) this.onHat(audio);
    // electric arcs leap between bodies on the snare hits
    if (audio.onset && audio.onsetStrength > 1.15 && this.arcsEnabled() && this.objects.length >= 2) {
      this._fireArc();
    }
    this._stepArcs(dt);
    this.updateScene(dt, audio);
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
    for (const o of this.objects) {
      if (!o.body || !o.mesh) continue;
      const t = o.body.translation();
      o.mesh.position.set(t.x, t.y, t.z);
      if (!o.lockRotation) { // planets spin on their own tilted axis instead
        const r = o.body.rotation();
        o.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
    this.stepRibbons();
  }

  track(body, mesh, extra = {}) {
    const o = { body, mesh, baseScale: mesh.scale.x, ...extra };
    this.objects.push(o);
    this.group.add(mesh);
    return o;
  }

  disposable(...items) { this._disposables.push(...items); }

  addBall(radius, pos, { density = 1, restitution = 0.5, damping = 0.1, material, geometry }) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(damping)
        .setAngularDamping(damping)
    );
    const col = this.world.createCollider(
      R.ColliderDesc.ball(radius).setDensity(density).setRestitution(restitution),
      body
    );
    const geo = geometry || new THREE.IcosahedronGeometry(radius, 3);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.disposable(geo);
    return this.track(body, mesh, { collider: col, radius });
  }

  addGroundBox(hx, hy, hz, y) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, y, 0));
    this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz), body);
    return body;
  }

  makeParticles(count, { size = 0.12, color = 0x00f0ff, opacity = 0.8 }) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const life = new Float32Array(count); // 0 = dead
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size, color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.disposable(geo, mat);
    const velocities = new Float32Array(count * 3);
    return { points, positions, velocities, life, count, cursor: 0, geo, mat };
  }

  emitParticle(p, x, y, z, vx, vy, vz, lifespan = 1) {
    const i = p.cursor;
    p.positions[i * 3] = x; p.positions[i * 3 + 1] = y; p.positions[i * 3 + 2] = z;
    p.velocities[i * 3] = vx; p.velocities[i * 3 + 1] = vy; p.velocities[i * 3 + 2] = vz;
    p.life[i] = lifespan;
    p.cursor = (i + 1) % p.count;
  }

  // a jagged electric bolt between two random bodies, flashes then fades
  _fireArc() {
    if (this._arcs.length > 5) return;
    const objs = this.objects;
    const a = objs[Math.floor(Math.random() * objs.length)];
    const b = objs[Math.floor(Math.random() * objs.length)];
    if (a === b || !a.body || !b.body) return;
    const SEG = 12;
    const pa = a.body.translation(), pb = b.body.translation();
    const p0 = new THREE.Vector3(pa.x, pa.y, pa.z);
    const p1 = new THREE.Vector3(pb.x, pb.y, pb.z);
    const len = p0.distanceTo(p1);
    const pts = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const p = p0.clone().lerp(p1, t);
      if (i > 0 && i < SEG) { // jitter the middle into a lightning zigzag
        p.x += (Math.random() - 0.5) * len * 0.18;
        p.y += (Math.random() - 0.5) * len * 0.18;
        p.z += (Math.random() - 0.5) * len * 0.18;
      }
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: this.arcColor(), transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    this.group.add(line);
    this._arcs.push({ line, geo, mat, life: 0.22 });
  }

  _stepArcs(dt) {
    for (let i = this._arcs.length - 1; i >= 0; i--) {
      const arc = this._arcs[i];
      arc.life -= dt;
      if (arc.life <= 0) {
        this.group.remove(arc.line);
        arc.geo.dispose(); arc.mat.dispose();
        this._arcs.splice(i, 1);
      } else {
        arc.mat.opacity = arc.life / 0.22; // flash-fade
      }
    }
  }

  makeParticleStorm(count, [colorA, colorB], radius) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // home positions: denser toward the centre (cube-rooted radius)
      const v = new THREE.Vector3().randomDirection().multiplyScalar(radius * Math.cbrt(Math.random()));
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
      seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uBass: { value: 0 }, uEnergy: { value: 0 },
        uSize: { value: this.shared.mobile ? 26 : 34 },
        uColorA: { value: new THREE.Color(colorA) },
        uColorB: { value: new THREE.Color(colorB) },
        uKey: { value: new THREE.Color(0x8080ff) },
      },
      vertexShader: NOISE_GLSL + /* glsl */`
uniform float uTime, uBass, uEnergy, uSize;
attribute float aSeed;
varying float vMix;
void main(){
  vec3 home = position;
  float t = uTime * 0.12 + aSeed * 6.28;
  // flowing drift field — a cheap curl-ish swirl, swells with the bass
  vec3 drift = vec3(
    snoise(home * 0.06 + vec3(t, 0.0, 0.0)),
    snoise(home * 0.06 + vec3(0.0, t, 5.2)),
    snoise(home * 0.06 + vec3(2.1, 0.0, t)));
  vec3 p = home * (1.0 + uBass * 0.3) + drift * (2.5 + uBass * 7.0 + uEnergy * 3.0);
  vMix = aSeed;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.3 + aSeed * 0.7) * (0.5 + uEnergy * 1.5) / max(-mv.z, 1.0);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */`
uniform vec3 uColorA, uColorB, uKey;
uniform float uEnergy;
varying float vMix;
void main(){
  float d = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  if (d <= 0.0) discard;
  vec3 col = mix(uColorA, uColorB, vMix);
  col = mix(col, uKey, 0.4);                 // tinted toward the song's key
  gl_FragColor = vec4(col * (0.4 + uEnergy * 1.4), d * (0.35 + uEnergy * 0.5));
}`,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.disposable(geo, mat);
    return { points, mat };
  }

  // Aurora curtains — a tall ring of flowing light sheets that ripple with the
  // mids. Returns { mesh, mat }; call .mat.uniforms.uMid/uTime each frame.
  makeAurora({ radius = 70, height = 50, y = 0, colorA = 0x39ff88, colorB = 0xb14cff } = {}) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uMid: { value: 0 }, uEnergy: { value: 0 },
        uColorA: { value: new THREE.Color(colorA) },
        uColorB: { value: new THREE.Color(colorB) },
      },
      vertexShader: /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE_GLSL + /* glsl */`
uniform float uTime, uMid, uEnergy;
uniform vec3 uColorA, uColorB;
varying vec2 vUv;
void main(){
  // vertical curtains: noise in x scrolls, brightness falls off with height
  float curtain = fbm(vec3(vUv.x * 8.0, vUv.y * 1.5 - uTime * 0.15, uTime * 0.1));
  float band = pow(0.5 + 0.5 * sin(vUv.x * 40.0 + curtain * 6.0 + uTime * 0.5), 3.0);
  float vfade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
  float amt = band * vfade * (0.3 + uMid * 1.8 + uEnergy * 0.6);
  vec3 col = mix(uColorA, uColorB, curtain * 0.5 + 0.5);
  gl_FragColor = vec4(col * amt, amt * 0.7);
}`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y;
    this.group.add(mesh);
    this.disposable(geo, mat);
    return { mesh, mat };
  }

  // Caustics — dancing underwater light web projected on a floor plane.
  makeCaustics({ size = 50, y = 0, color = 0x66ccff } = {}) {
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uEnergy: { value: 0 },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE_GLSL + /* glsl */`
uniform float uTime, uEnergy;
uniform vec3 uColor;
varying vec2 vUv;
void main(){
  // layered moving noise ridged into bright light-veins = caustic web
  vec2 p = vUv * 7.0;
  float n = fbm(vec3(p, uTime * 0.3)) + fbm(vec3(p * 1.8 + 4.0, uTime * 0.22));
  float web = pow(1.0 - abs(sin(n * 3.14159)), 4.0);
  float edge = smoothstep(0.5, 0.15, length(vUv - 0.5)); // fade at the rim
  gl_FragColor = vec4(uColor * web * (0.4 + uEnergy * 1.6) * edge, web * edge * 0.6);
}`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    this.group.add(mesh);
    this.disposable(geo, mat);
    return { mesh, mat };
  }

  // Neon light-painting trail behind a body (long-exposure look). Additive
  // blending + colors fading to black = the tail dissolves into the dark.
  addRibbon(target, color, length = 64, opacity = 0.85) {
    const positions = new Float32Array(length * 3);
    const colors = new Float32Array(length * 3);
    const c = new THREE.Color(color);
    const t = target.body ? target.body.translation() : target.position;
    for (let i = 0; i < length; i++) {
      positions[i * 3] = t.x; positions[i * 3 + 1] = t.y; positions[i * 3 + 2] = t.z;
      const f = Math.pow(1 - i / length, 1.6);
      colors[i * 3] = c.r * f; colors[i * 3 + 1] = c.g * f; colors[i * 3 + 2] = c.b * f;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    this.group.add(line);
    this.disposable(geo, mat);
    const ribbon = { target, geo, positions, length, line };
    this.ribbons.push(ribbon);
    return ribbon;
  }

  stepRibbons() {
    for (const r of this.ribbons) {
      const p = r.positions;
      // shift tail back one slot, write the head
      p.copyWithin(3, 0, (r.length - 1) * 3);
      const t = r.target.body ? r.target.body.translation() : r.target.position;
      p[0] = t.x; p[1] = t.y; p[2] = t.z;
      r.geo.attributes.position.needsUpdate = true;
    }
  }

  // Spectrum-driven dot-grid terrain (the glowing particle wave backdrop).
  makeWaveField({ width = 60, depth = 30, nx = 128, nz = 28, y = -6, colorA = 0x00f0ff, colorB = 0xb14cff } = {}) {
    const count = nx * nz;
    const positions = new Float32Array(count * 3);
    const ref = new Float32Array(count * 2); // (band 0..1, row 0..1)
    let i = 0;
    for (let zx = 0; zx < nz; zx++) {
      for (let x = 0; x < nx; x++) {
        positions[i * 3] = (x / (nx - 1) - 0.5) * width;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = (zx / (nz - 1) - 0.5) * depth;
        ref[i * 2] = x / (nx - 1);
        ref[i * 2 + 1] = zx / (nz - 1);
        i++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aRef', new THREE.BufferAttribute(ref, 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        tFreq: { value: this.shared.freqTex?.texture || null },
        uTime: { value: 0 },
        uAmp: { value: 5 },
        uKickTime: { value: 99 },   // seconds since last kick
        uKickAmp: { value: 0 },
        uColorA: { value: new THREE.Color(colorA) },
        uColorB: { value: new THREE.Color(colorB) },
      },
      vertexShader: NOISE_GLSL + /* glsl */`
uniform sampler2D tFreq; uniform float uTime, uAmp, uKickTime, uKickAmp;
attribute vec2 aRef;
varying float vAmp;
void main(){
  float band = texture2D(tFreq, vec2(aRef.x, 0.5)).r;
  float n = snoise(vec3(aRef * 6.0, uTime * 0.25)) * 0.5 + 0.5;
  float h = band * uAmp * (0.35 + 0.65 * n);
  // kick shockwave rolling outward through the grid
  float d = length(position.xz);
  float wave = exp(-abs(d - uKickTime * 26.0) * 0.45) * exp(-uKickTime * 2.0);
  h += wave * uKickAmp;
  vec3 p = position + vec3(0.0, h, 0.0);
  vAmp = min(1.0, band + wave * uKickAmp * 0.25);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (2.0 + vAmp * 6.0) * (120.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */`
uniform vec3 uColorA, uColorB;
varying float vAmp;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = smoothstep(0.5, 0.05, length(c));
  vec3 col = mix(uColorA, uColorB, vAmp) * (0.25 + vAmp * 1.6);
  gl_FragColor = vec4(col * d, d * 0.9);
}`,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.disposable(geo, mat);
    return {
      points, mat,
      kick(strength) {
        mat.uniforms.uKickTime.value = 0;
        mat.uniforms.uKickAmp.value = Math.min(5, 1.5 + strength * 1.5);
      },
      step(dt, t) {
        mat.uniforms.uTime.value = t;
        mat.uniforms.uKickTime.value += dt;
      },
    };
  }

  stepParticles(p, dt, gravity = 0, drag = 0) {
    for (let i = 0; i < p.count; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) { p.positions[i * 3 + 1] = -9999; continue; }
      p.velocities[i * 3 + 1] += gravity * dt;
      const k = 1 - drag * dt;
      p.velocities[i * 3] *= k; p.velocities[i * 3 + 1] *= k; p.velocities[i * 3 + 2] *= k;
      p.positions[i * 3] += p.velocities[i * 3] * dt;
      p.positions[i * 3 + 1] += p.velocities[i * 3 + 1] * dt;
      p.positions[i * 3 + 2] += p.velocities[i * 3 + 2] * dt;
    }
    p.geo.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.three.scene.remove(this.group);
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
      }
    });
    for (const d of this._disposables) d.dispose?.();
    for (const l of this.lights) this.three.scene.remove(l);
    this.world?.free();
    this.world = null;
    this.objects.length = 0;
    this.ribbons.length = 0;
    this._arcs.length = 0;
  }
}
