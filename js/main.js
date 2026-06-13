// RESONANCE ENGINE — entry point. Boots Rapier + Three, owns the render loop,
// routes audio analysis into the active physics scene and the post stack.

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { AudioEngine } from './audio-engine.js';
import { CameraDirector } from './camera-director.js';
import { UI } from './ui.js';
import { PostStack } from './post-stack.js';
import { Environments } from './environments.js';
import { makeFreqTexture } from './materials.js';
import { PulseOrbScene } from './scenes/pulse-orb.js';
import { SpirographScene } from './scenes/spirograph.js';
import { PsychedeliaScene } from './scenes/psychedelia.js';
import { WaveGridScene } from './scenes/wavegrid.js';
import { CelestialScene } from './scenes/celestial.js';
import { BlackHoleScene } from './scenes/blackhole.js';
import { CymaticaScene } from './scenes/cymatica.js';
import { DreamsScene } from './scenes/dreams.js';

const PRESETS = {
  pulse: { cls: PulseOrbScene, cam: { radius: 16, height: 3 } },
  spirograph: { cls: SpirographScene, cam: { radius: 21, height: 13 } },
  psychedelia: { cls: PsychedeliaScene, cam: { radius: 16, height: 2 } },
  wavegrid: { cls: WaveGridScene, cam: { radius: 30, height: 6, spin: 0.18 } },
  celestial: { cls: CelestialScene, cam: { radius: 42, height: 14 } },
  blackhole: { cls: BlackHoleScene, cam: { radius: 20, height: 5 } },
  cymatica: { cls: CymaticaScene, cam: { radius: 18, height: 6 } },
  dreams: { cls: DreamsScene, cam: { radius: 17, height: 3 } },
};

const AUTO_ORDER = ['cymatica', 'pulse', 'dreams', 'wavegrid', 'blackhole', 'spirograph', 'psychedelia', 'celestial'];

const IS_MOBILE = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;

class App {
  constructor() {
    this.params = { gravity: 1, impulse: 1, treble: 1, light: 1, master: 1 };
    this.isMobile = IS_MOBILE;
    this.started = false;
    this.paused = false;
    this.scene = null;
    this.presetName = 'pulse';
    // auto-director state
    this.autoOn = true;
    this._lastSwitch = 0;
    this._lastManual = -Infinity;
    this._energyRef = 0;
    this._nextShotAt = 0;
    // bullet-time state
    this.timeScale = 1;
    this._slowmoUntil = 0;
    this._lastDrop = -Infinity;
    this._lightProj = new THREE.Vector3();
    this._lightUv = new THREE.Vector2(0.5, 0.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('stage'),
      antialias: false, // post stack supersedes MSAA; keeps old GPUs at 60
      powerPreference: 'high-performance',
    });
    // native retina on desktop = the single biggest sharpness win; governor
    // drops it only if the GPU genuinely can't keep up
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // OutputPass applies it
    this.renderer.toneMappingExposure = 1.05;

    this.threeScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 6, 24);

    this.audio = new AudioEngine(document.getElementById('audio-el'));
    this.director = new CameraDirector(this.camera);
    this.post = new PostStack(this.renderer, this.threeScene, this.camera);
    if (IS_MOBILE) {
      // phone GPUs: skip DOF + MSAA from the start; governor sheds more if needed
      this.post.quality = 1;
      this.post.bokeh.enabled = false;
      this.post.composer.renderTarget1.samples = 0;
      this.post.composer.renderTarget2.samples = 0;
    }
    this.freqTex = makeFreqTexture();
    this.env = new Environments(this.renderer);
    this.ui = new UI(this);

    this._fps = 60;
    this._lastT = performance.now();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.post.setSize(window.innerWidth, window.innerHeight);
    });
  }

  async boot() {
    this.ui.setBootStatus('INITIALISING PHYSICS CORE…');
    await RAPIER.init();
    this.RAPIER = RAPIER;
    this.ui.setBootStatus('LOADING LIGHT FIELDS…');
    await this.env.load();
    this.ui.setBootStatus('REACTOR ONLINE // AWAITING SIGNAL');
    this.ui.enableBoot();
    this.setPreset(this.presetName);
    this._loop();
  }

  saveParams() {
    try { localStorage.setItem(`rez:params:${this.presetName}`, JSON.stringify(this.params)); }
    catch { /* private mode etc — sliders just won't persist */ }
  }

  toggleAuto() {
    this.autoOn = !this.autoOn;
    this.ui.setAuto(this.autoOn && this.started);
  }

  // the auto-director: rides the energy curve and changes scenes at moments
  // that feel like musical sections — or after 50 s if the track plateaus
  _directorTick(now) {
    if (!this.started || this.paused) return;
    const e = this.audio.smoothEnergy;
    this._energyRef += (e - this._energyRef) * 0.002;   // very slow baseline

    // camera shots rotate regardless of auto scene-switching
    if (now > this._nextShotAt) {
      this.director.changeShot(e);
      this._nextShotAt = now + 11_000 + Math.random() * 8_000;
    }

    if (!this.autoOn || now - this._lastManual < 90_000) return; // user is driving
    const sinceSwitch = now - this._lastSwitch;
    const bigShift = Math.abs(e - this._energyRef) > 0.16 && this.audio.kick;
    if ((bigShift && sinceSwitch > 22_000) || sinceSwitch > 50_000) {
      const next = AUTO_ORDER[(AUTO_ORDER.indexOf(this.presetName) + 1) % AUTO_ORDER.length];
      this._lastSwitch = now;
      this.setPreset(next, { auto: true });
      this.ui.reflectPreset(next);
      this.post.kick(1.5, this._lightUv);               // flash the transition
    }
  }

  setPreset(name, { auto = false } = {}) {
    if (!PRESETS[name]) return;
    if (!auto) {
      this._lastManual = performance.now();
      this._lastSwitch = performance.now();
    }
    this.presetName = name;
    // each preset remembers its own slider mix
    try {
      const saved = JSON.parse(localStorage.getItem(`rez:params:${name}`) || 'null');
      if (saved) { Object.assign(this.params, saved); this.ui.syncSliders(); }
    } catch { /* ignore corrupt storage */ }
    if (this.scene) this.scene.dispose();
    const { cls, cam } = PRESETS[name];
    this.scene = new cls(this.RAPIER, {
      scene: this.threeScene, camera: this.camera, renderer: this.renderer,
    }, this.params, { freqTex: this.freqTex, env: this.env, mobile: IS_MOBILE });
    this.scene.init();
    this.director.configure(cam);
    const k = this.scene.kaleido();
    if (typeof k === 'number') this.post.setKaleido(k);
    else this.post.setKaleido(k.mix, k.segs);
    this.post.setDOF(this.scene.wantsDOF());
    this.post.setTrails(IS_MOBILE ? 0 : this.scene.trails()); // trails off on phones (cost)
  }

  async loadTrack(file) {
    try {
      await this.audio.loadFile(file);
    } catch (err) {
      console.error('Track load failed:', err);
      this.ui.setBootStatus('⚠ COULD NOT DECODE THAT FILE — TRY MP3/WAV/M4A');
      return;
    }
    this.ui.setTrackName(this.audio.trackName);
    if (!this.started) {
      this.started = true;
      this.ui.showHud();
      this.ui.setAuto(this.autoOn);
      this._lastSwitch = performance.now();
    }
    if (this.paused) this.togglePause();
  }

  async togglePause() {
    this.paused = !this.paused;
    if (this.paused) await this.audio.pause();
    else await this.audio.resume();
    this.ui.setPaused(this.paused);
  }

  // record the canvas + audio to a downloadable .webm
  toggleRecord() {
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    if (typeof MediaRecorder === 'undefined' || !this.renderer.domElement.captureStream) {
      console.warn('Recording not supported in this browser');
      return;
    }
    const stream = this.renderer.domElement.captureStream(60);
    const audioStream = this.audio.recordStream();
    if (audioStream) for (const t of audioStream.getAudioTracks()) stream.addTrack(t);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus' : 'video/webm';
    const chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    this.recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    this.recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.audio.trackName || 'resonance'}-${this.presetName}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      this.recorder = null;
      this.ui.setRecording(false);
    };
    this.recorder.start();
    this.ui.setRecording(true);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const now = performance.now();
    let dt = (now - this._lastT) / 1000;
    this._lastT = now;
    dt = Math.min(dt, 1 / 20); // clamp tab-switch spikes
    this._fps += ((1 / Math.max(dt, 1e-4)) - this._fps) * 0.05;

    this.audio.update(now);
    this.freqTex.update(this.audio.freq, this.audio.binCount);

    // bullet-time: a hard kick landing way above the energy baseline = the
    // drop. World slows to 12% for ~2 s while the camera keeps gliding.
    if (this.started && !this.paused && this.audio.kick
        && this.audio.kickStrength > 1.5
        && this.audio.smoothEnergy > this._energyRef + 0.13
        && now - this._lastDrop > 16_000) {
      this._lastDrop = now;
      this._slowmoUntil = now + 1900;
      this.post.kick(2, this.director.screenFocus());
    }
    const inSlowmo = now < this._slowmoUntil;
    const targetTs = inSlowmo ? 0.12 : 1;
    this.timeScale += (targetTs - this.timeScale) * (1 - Math.exp(-dt * 7));
    // hyperspace radial streak ramps up while the drop's slow-mo holds
    this._warp = (this._warp || 0) + ((inSlowmo ? 1 : 0) - (this._warp || 0)) * (1 - Math.exp(-dt * 6));
    this.post.setWarp(this._warp);

    if (this.scene && !this.paused) {
      if (this.audio.kick) {
        const strength = this.audio.kickStrength * this.params.impulse * this.params.master;
        this.director.onKick(strength);
        this.post.kick(strength, this.director.screenFocus());
      } else if (this.audio.onset) {
        // snares / melody hits move the camera + lens a little, every time
        this.director.onKick(this.audio.onsetStrength * 0.22 * this.params.impulse);
        this.post.microPulse(this.audio.onsetStrength * 0.6);
      }
      if (this.audio.hat) this.post.microPulse(this.audio.hatStrength * 0.25);
      this.scene.step(dt * this.timeScale, this.audio);
    }
    if (this.scene) this.director.update(this.paused ? 0.0001 : dt, this.scene, this.audio);

    // project the scene's hero light into screen space for the god rays
    if (this.scene) {
      const lp = this.scene.lightWorldPos();
      const cp = this.scene.cinema();
      this._lightProj.set(lp.x, lp.y, lp.z).project(this.camera);
      const behind = this._lightProj.z > 1;
      this._lightUv.set(this._lightProj.x * 0.5 + 0.5, this._lightProj.y * 0.5 + 0.5);
      this.post.setLight(this._lightUv, behind ? 0 : cp.rays * (0.6 + this.audio.smoothEnergy * 1.2));
      this.post.cinema.uniforms.uStreakAmt.value = cp.streak * (0.5 + this.audio.smoothEnergy);
      this.post.setLens(this._lightUv, behind ? 0 : this.scene.lens());
    }

    this._directorTick(now);
    this.post.setFocus(this.director.focusDistance());
    this.post.update(dt, this.audio, this._fps, this.params.light * this.params.master);

    if (this.started) this.ui.update(this.audio, this.audio.el, this._fps);
    this.post.render();
  }
}

const app = new App();
window.app = app; // handy for debugging + automated tests
app.boot().catch(err => {
  console.error(err);
  document.getElementById('boot-status').textContent = '⚠ BOOT FAILURE — CHECK CONSOLE';
});
