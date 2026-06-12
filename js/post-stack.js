// PostStack — EffectComposer pipeline: render → DOF → bloom → impact pass
// (shockwave / chromatic aberration / exposure flash / vignette / grain) →
// output. Includes an FPS governor that sheds effects before it sheds frames.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// God rays + anamorphic streak + lens dirt + halation — the "shot on real
// glass" layer. Runs after bloom so it feeds on already-bright pixels.
const CinemaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLightPos: { value: new THREE.Vector2(0.5, 0.5) },
    uRayAmt: { value: 0.5 },
    uStreakAmt: { value: 0.6 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uLightPos;
uniform float uRayAmt, uStreakAmt, uTime;
varying vec2 vUv;

float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// sparse round specks, like dust on a lens — NOT blotches
float dirt(vec2 uv){
  float d = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 g = uv * (5.0 + float(i) * 3.0) + float(i) * 7.31;
    vec2 id = floor(g), f = fract(g);
    float h = hash21(id);
    vec2 c = vec2(hash21(id + 3.7), hash21(id + 9.1)) * 0.6 + 0.2;
    float fall = max(0.0, 1.0 - length(f - c) * 4.5);
    d += step(0.93, h) * fall * fall;
  }
  return clamp(d, 0.0, 1.0);
}

void main(){
  vec3 col = texture2D(tDiffuse, vUv).rgb;

  // --- god rays: march toward the light, accumulate truly-hot pixels only
  vec2 delta = (uLightPos - vUv) / 14.0;
  vec2 p = vUv;
  float decay = 1.0;
  vec3 rays = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    p += delta;
    vec3 s = texture2D(tDiffuse, p).rgb;
    rays += max(s - 0.78, 0.0) * decay;
    decay *= 0.84;
  }
  rays /= 14.0;
  col += rays * 0.55 * uRayAmt;

  // --- anamorphic streak: horizontal smear of hot pixels, tinted cold blue
  vec3 streak = vec3(0.0);
  for (int i = 1; i <= 7; i++) {
    float o = float(i) * float(i) * 0.004;
    streak += max(texture2D(tDiffuse, vUv + vec2(o, 0.0)).rgb - 0.9, 0.0);
    streak += max(texture2D(tDiffuse, vUv - vec2(o, 0.0)).rgb - 0.9, 0.0);
  }
  streak /= 14.0;
  col += streak * vec3(0.35, 0.55, 1.0) * 0.6 * uStreakAmt;

  // --- halation: tight warm bleed around only the very hottest pixels
  float hot = max(luma(col) - 0.88, 0.0);
  col += vec3(1.0, 0.35, 0.18) * hot * 0.09;

  // --- lens dirt: barely-there specks, only on genuinely bright frames
  float bright = smoothstep(0.4, 1.0, luma(rays) + luma(streak) * 2.0);
  col += dirt(vUv) * bright * vec3(0.7, 0.8, 1.0) * 0.06;

  gl_FragColor = vec4(col, 1.0);
}`,
};

// Unsharp-mask sharpen — the final clarity pass. Subtracts a blurred version
// of the frame from itself to crisp up every edge. This is what makes neon
// lines, particle dots and the orb's spikes read razor-sharp.
const SharpenShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.5 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float uAmount;
uniform vec2 uResolution;
varying vec2 vUv;
void main(){
  vec2 px = 1.0 / uResolution;
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  // 4-tap cross blur = the low-frequency component to subtract
  vec3 blur = (
    texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb +
    texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb +
    texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb +
    texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb) * 0.25;
  gl_FragColor = vec4(c + (c - blur) * uAmount, 1.0);
}`,
};

const ImpactShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uShockTime: { value: 99 },     // seconds since last kick
    uShockStrength: { value: 0 },
    uShockCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAberration: { value: 0 },
    uFlash: { value: 0 },
    uEnergy: { value: 0 },
    uKaleidoMix: { value: 0 },
    uKaleidoSegs: { value: 6 },
    uLensPos: { value: new THREE.Vector2(0.5, 0.5) },
    uLensAmt: { value: 0 },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float uTime, uShockTime, uShockStrength, uAberration, uFlash, uEnergy;
uniform float uKaleidoMix, uKaleidoSegs, uLensAmt;
uniform vec2 uShockCenter, uLensPos;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main(){
  vec2 uv = vUv;

  // gravitational lensing: spacetime bends light around the singularity —
  // a tight pinch near the horizon, fading fast with distance
  if (uLensAmt > 0.001) {
    vec2 lc = uv - uLensPos;
    lc.x *= 1.6; // roughly correct for aspect
    float ld = length(lc);
    float bend = uLensAmt * 0.0032 / (ld * ld + 0.03);
    uv -= normalize(lc) * min(bend, ld * 0.45) * vec2(0.625, 1.0);
  }

  // kaleidoscope fold (mandala mode) — blends with the straight image
  if (uKaleidoMix > 0.001) {
    vec2 c = uv - 0.5;
    float ang = atan(c.y, c.x);
    float seg = 6.28318530 / uKaleidoSegs;
    ang = abs(mod(ang, seg) - seg * 0.5);
    vec2 folded = vec2(cos(ang), sin(ang)) * length(c) + 0.5;
    uv = mix(uv, folded, uKaleidoMix);
  }

  // shockwave: expanding ring that refracts the image as it passes
  float waveR = uShockTime * 1.6;            // ring radius grows over time
  float d = distance(uv, uShockCenter);
  float ring = smoothstep(waveR - 0.18, waveR, d) * smoothstep(waveR + 0.18, waveR, d);
  float fade = exp(-uShockTime * 3.0);
  uv += normalize(uv - uShockCenter + 1e-5) * ring * fade * uShockStrength * 0.045;

  // chromatic aberration: split RGB radially from centre
  vec2 dir = (uv - 0.5);
  float ca = uAberration * (0.004 + uEnergy * 0.002) + ring * fade * 0.012;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + dir * ca).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - dir * ca).b;

  // exposure flash on the hit, decays fast
  col *= 1.0 + uFlash * 0.55;

  // vignette — gentle, just enough to frame; never crushes the corners
  float vig = smoothstep(1.05, 0.4, length(dir) * (1.3 - uEnergy * 0.2));
  col *= mix(0.74, 1.0, vig);

  // animated film grain — a whisper, keeps it from looking sterile
  float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 100.0);
  col += (g - 0.5) * 0.016;

  gl_FragColor = vec4(col, 1.0);
}`,
};

export class PostStack {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);

    this.bokeh = new BokehPass(scene, camera, {
      focus: 24, aperture: 0.00004, maxblur: 0.0025, // very subtle: only the far background softens
    });
    this.bokeh.enabled = true;

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.42,   // strength (base — audio pushes it). lower = less wash
      0.4,    // radius: tighter glow, not a fog
      0.86,   // threshold: only genuinely bright things bloom
    );

    this.cinema = new ShaderPass(CinemaShader);
    this.impact = new ShaderPass(ImpactShader);
    this.sharpen = new ShaderPass(SharpenShader);
    this.sharpen.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    this.output = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bokeh);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.cinema);
    this.composer.addPass(this.impact);
    this.composer.addPass(this.sharpen);
    this.composer.addPass(this.output);

    // MSAA on the composer targets (WebGL2) — clean edges without TAA ghosting
    this.composer.renderTarget1.samples = 2;
    this.composer.renderTarget2.samples = 2;

    this._shockClock = 99;
    this._flash = 0;
    this._aberr = 0;
    this.quality = 2;          // 2 = full, 1 = no DOF, 0 = no DOF + light bloom
    this._badFrames = 0;
    this._dofWanted = true;
  }

  // some scenes (thin neon lines) read better razor-sharp
  setDOF(enabled) {
    this._dofWanted = enabled;
    this.bokeh.enabled = enabled && this.quality >= 2;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.sharpen.uniforms.uResolution.value.set(w, h);
  }

  // point the DOF at the camera's current focus distance — track fast so the
  // subject never falls out of focus while the camera moves (that's the blur)
  setFocus(dist) {
    this.bokeh.uniforms.focus.value += (dist - this.bokeh.uniforms.focus.value) * 0.2;
  }

  // where the scene's hero light sits on screen (uv) + how strong the rays are
  setLight(uv, rayAmt) {
    this.cinema.uniforms.uLightPos.value.copy(uv);
    this.cinema.uniforms.uRayAmt.value = rayAmt;
  }

  setLens(uv, amt) {
    this.impact.uniforms.uLensPos.value.copy(uv);
    this.impact.uniforms.uLensAmt.value = amt;
  }

  setKaleido(mix, segments = 6) {
    this.impact.uniforms.uKaleidoMix.value = mix;
    this.impact.uniforms.uKaleidoSegs.value = segments;
  }

  // small reaction for snares/hats/melody — a touch of aberration, barely any flash
  microPulse(strength) {
    this._flash = Math.min(0.5, this._flash + strength * 0.04);
    this._aberr = Math.min(1.4, this._aberr + strength * 0.18);
  }

  kick(strength, screenCenter) {
    this._shockClock = 0;
    this.impact.uniforms.uShockStrength.value = Math.min(1.4, strength);
    if (screenCenter) this.impact.uniforms.uShockCenter.value.copy(screenCenter);
    this._flash = Math.min(0.7, this._flash + strength * 0.18); // less white-out
    this._aberr = Math.min(1.6, this._aberr + strength * 0.5);
  }

  update(dt, audio, fps, lightSens) {
    this._shockClock += dt;
    // fast decay = a crisp snap back to clarity instead of a lingering haze
    this._flash = Math.max(0, this._flash - dt * 7.5);
    this._aberr = Math.max(0, this._aberr - dt * 6.0);

    this.cinema.uniforms.uTime.value += dt;

    const u = this.impact.uniforms;
    u.uTime.value += dt;
    u.uShockTime.value = this._shockClock;
    u.uFlash.value = this._flash;
    u.uAberration.value = this._aberr;
    u.uEnergy.value = audio.smoothEnergy;

    // keep bloom roughly constant — loud sections shouldn't bloom into a haze
    this.bloom.strength = (0.32 + audio.smoothEnergy * 0.5 + this._flash * 0.25) * lightSens;

    // FPS governor: shed effects under sustained load, restore when healthy
    if (fps < 42) this._badFrames++;
    else if (fps > 55) this._badFrames = Math.max(0, this._badFrames - 2);
    if (this._badFrames > 120 && this.quality > 0) {
      this.quality--;
      this._badFrames = 0;
      this._applyQuality();
    }
  }

  _applyQuality() {
    // sharpen stays on at every tier — it's cheap and it's the whole point
    this.bokeh.enabled = this._dofWanted && this.quality >= 2;
    if (this.quality === 1) {
      this.cinema.enabled = true;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    }
    if (this.quality === 0) {
      this.cinema.enabled = false;
      this.bloom.radius = 0.3;
      this.renderer.setPixelRatio(1);
    }
    console.info(`[poststack] quality -> ${this.quality}`);
  }

  render() { this.composer.render(); }
}
