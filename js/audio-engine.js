// AudioEngine — Web Audio analysis: frequency bands, energy, beat + onset detection.
// Exposes a per-frame snapshot consumed by the physics scenes.

const FFT_SIZE = 2048;           // 1024 frequency bins
const HISTORY = 43;              // ~1 s of frames at 60 fps for adaptive thresholds
const KICK_REFRACTORY_MS = 130;  // min gap between detected kicks

export class AudioEngine {
  constructor(audioEl) {
    this.el = audioEl;
    this.ctx = null;
    this.analyser = null;
    this.freq = new Uint8Array(FFT_SIZE / 2);
    this.binCount = FFT_SIZE / 2;

    // per-frame snapshot, all values normalised 0..1 unless noted
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.presence = 0;        // vocal / lead band level
    this.energy = 0;
    this.smoothBass = 0;
    this.smoothEnergy = 0;
    this.smoothPresence = 0;
    this.kick = false;        // bass attack (kick drum / bass note onset)
    this.kickStrength = 0;    // ~1 = threshold, higher = harder hit
    this.onset = false;       // mid attack (snare, stab, vocal, melody note)
    this.onsetStrength = 0;
    this.hat = false;         // treble attack (hats, shakers, clicks)
    this.hatStrength = 0;
    this.transient = 0;       // continuous 0..1 "how much is changing right now"
    this.beatCount = 0;
    this.bpm = 0;

    this._bFluxHist = new Float32Array(HISTORY);
    this._mFluxHist = new Float32Array(HISTORY);
    this._tFluxHist = new Float32Array(HISTORY);
    this._fluxHist = new Float32Array(HISTORY);
    this._histIdx = 0;
    this._histFill = 0;
    this._prevSpectrum = new Float32Array(FFT_SIZE / 2);
    this._lastKickAt = 0;
    this._lastOnsetAt = 0;
    this._lastHatAt = 0;
    this._kickTimes = [];

    // phase-locked beat grid: once tempo locks, beats fire ON the grid
    this.gridLocked = false;
    this.beatPhase = 0;       // 0 just after a beat -> 1 at the next
    this._grid = { period: 0, next: 0, conf: 0, intervals: [] };
    this._lastDetStrength = 1;

    // musical key: chromagram -> Krumhansl key correlation
    this.chroma = new Float32Array(12);   // smoothed pitch-class energy
    this.keyPc = 0;                       // 0=C ... 11=B
    this.keyMinor = false;
    this.keyName = '—';
    this.keyHue = 0.6;                    // circle-of-fifths colour
    this.keyChanged = false;              // true the frame the key flips
    this._keyScore = 0;
    this._keyTimer = 0;
  }

  // a raw kick detection: steers the grid; fires directly only when unlocked
  _onKickDetected(nowMs, strength) {
    const g = this._grid;
    if (this._lastKickAt > 0) {
      let iv = nowMs - this._lastKickAt;
      while (iv > 1000) iv /= 2;   // fold half-time kicks onto the beat
      while (iv < 300) iv *= 2;    // fold double-time
      if (iv >= 300 && iv <= 1000) {
        g.intervals.push(iv);
        if (g.intervals.length > 12) g.intervals.shift();
      }
    }
    this._lastKickAt = nowMs;
    this._lastDetStrength = strength;

    if (g.intervals.length >= 4) {
      const sorted = [...g.intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      g.period = g.period ? g.period * 0.8 + median * 0.2 : median;
    }
    if (g.period) {
      if (!g.next) g.next = nowMs + g.period;
      // how far off the predicted grid did this hit land? (nearest grid point)
      let err = ((nowMs - g.next) % g.period + g.period) % g.period;
      if (err > g.period / 2) err -= g.period;
      // PLL hysteresis: acquire the lock with a tight window, keep it with a
      // loose one — frame jitter must not be able to shake the grid loose
      const win = this.gridLocked ? 0.3 : 0.18;
      if (Math.abs(err) < g.period * win) {
        g.conf = Math.min(8, g.conf + 1);
        g.next += err * 0.35;          // gently pull the grid onto the music
      } else {
        g.conf -= 1;
        if (g.conf <= 0) { g.conf = 0; g.next = nowMs + g.period; }
      }
    }
    this.gridLocked = g.conf >= 3;
    if (!this.gridLocked) {
      this.kick = true;
      this.kickStrength = strength;
      this.beatCount++;
      this._trackBpm(nowMs);
    }
  }

  // Must be called from a user gesture the first time.
  ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaElementSource(this.el);
    // smoothed analyser: pretty, slow — drives the visuals
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.55;
    src.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    // raw analyser: zero smoothing — attacks land the frame they happen.
    // Detection on the smoothed one lags 50-100 ms; this is the timing fix.
    this.analyserFast = this.ctx.createAnalyser();
    this.analyserFast.fftSize = FFT_SIZE;
    this.analyserFast.smoothingTimeConstant = 0.04;
    src.connect(this.analyserFast);
    this.freqFast = new Uint8Array(FFT_SIZE / 2);
    this._binHz = this.ctx.sampleRate / FFT_SIZE;
  }

  async loadFile(file) {
    this.ensureContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
    this._objectUrl = URL.createObjectURL(file);
    this.el.src = this._objectUrl;
    this.trackName = file.name.replace(/\.[^.]+$/, '');
    await this.el.play();
    this._kickTimes.length = 0;
    this.beatCount = 0;
    this.bpm = 0;
    this._grid = { period: 0, next: 0, conf: 0, intervals: [] };
    this.gridLocked = false;
    this.beatPhase = 0;
  }

  get playing() { return this.ctx && !this.el.paused; }

  // audio track for video recording (tapped after the analyser)
  recordStream() {
    if (!this.ctx) return null;
    if (!this._recDest) {
      this._recDest = this.ctx.createMediaStreamDestination();
      this.analyser.connect(this._recDest);
    }
    return this._recDest.stream;
  }

  async pause() { this.el.pause(); }
  async resume() {
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    await this.el.play();
  }

  _bandAvg(loHz, hiHz) {
    const lo = Math.max(0, Math.floor(loHz / this._binHz));
    const hi = Math.min(this.binCount - 1, Math.ceil(hiHz / this._binHz));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += this.freq[i];
    return sum / ((hi - lo + 1) * 255);
  }

  update(nowMs) {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freq);
    this.analyserFast.getByteFrequencyData(this.freqFast);

    this.bass = this._bandAvg(25, 140);
    this.mid = this._bandAvg(250, 2000);
    this.treble = this._bandAvg(4000, 12000);
    this.presence = this._bandAvg(800, 3500); // vocal / lead presence band

    let total = 0;
    for (let i = 0; i < this.binCount; i++) total += this.freq[i] * this.freq[i];
    this.energy = Math.sqrt(total / this.binCount) / 255;

    // auto-calibration: track the rolling peak (slow decay) and normalise so
    // quiet acoustic tracks drive the visuals as hard as loud club masters
    this._peakE = Math.max((this._peakE || 0.3) * 0.9995, this.energy);
    const targetGain = Math.min(2.6, Math.max(0.85, 0.5 / Math.max(0.1, this._peakE)));
    this.gain = (this.gain || 1) + (targetGain - (this.gain || 1)) * 0.01;
    this.bass = Math.min(1, this.bass * this.gain);
    this.mid = Math.min(1, this.mid * this.gain);
    this.treble = Math.min(1, this.treble * this.gain);
    this.presence = Math.min(1, this.presence * this.gain);
    this.energy = Math.min(1, this.energy * this.gain);

    this.smoothBass += (this.bass - this.smoothBass) * 0.08;
    this.smoothEnergy += (this.energy - this.smoothEnergy) * 0.05;
    // faster follower for the voice so it tracks syllables, not phrases
    this.smoothPresence = (this.smoothPresence || 0) + (this.presence - (this.smoothPresence || 0)) * 0.2;

    // --- per-band spectral flux: we detect ATTACKS, not loudness, so a bass
    // note held for 4 bars can't deafen the detector (it has zero flux) ---
    const bassMax = Math.ceil(170 / this._binHz);
    const midMax = Math.ceil(2200 / this._binHz);
    const trebMax = Math.min(this.binCount - 1, Math.ceil(11000 / this._binHz));
    let bassFlux = 0, midFlux = 0, trebFlux = 0, flux = 0;
    for (let i = 0; i < this.binCount; i++) {
      const d = this.freqFast[i] - this._prevSpectrum[i];
      if (d > 0) {
        flux += d;
        if (i <= bassMax) bassFlux += d;
        else if (i <= midMax) midFlux += d;
        else if (i <= trebMax) trebFlux += d;
      }
      this._prevSpectrum[i] = this.freqFast[i];
    }
    bassFlux /= bassMax + 1;
    midFlux /= midMax - bassMax;
    trebFlux /= trebMax - midMax;
    flux /= this.binCount;

    // adaptive per-band thresholds over ~1 s of history
    const n = Math.max(1, this._histFill);
    let bAvg = 0, mAvg = 0, tAvg = 0, fAvg = 0;
    for (let i = 0; i < n; i++) {
      bAvg += this._bFluxHist[i]; mAvg += this._mFluxHist[i];
      tAvg += this._tFluxHist[i]; fAvg += this._fluxHist[i];
    }
    bAvg /= n; mAvg /= n; tAvg /= n; fAvg /= n;

    this.kick = false; this.kickStrength = 0;
    this.onset = false; this.onsetStrength = 0;
    this.hat = false; this.hatStrength = 0;
    this.keyChanged = false;
    if (this.playing) this._updateKey(nowMs);

    const ready = this._histFill >= HISTORY; // full ~1 s warm-up kills false positives
    if (ready && this.playing) {
      // lower floors + tighter multipliers = hears soft kicks, ghost snares,
      // quick hats. The beat GRID (below) rejects spurious kicks, so we can
      // afford to be greedy here without the visuals getting jittery.
      const bThresh = bAvg * 1.4 + 0.85;
      if (bassFlux > bThresh && nowMs - this._lastKickAt > KICK_REFRACTORY_MS) {
        this._onKickDetected(nowMs, Math.min(3, bassFlux / bThresh));
      }
      const mThresh = mAvg * 1.45 + 0.6;
      if (midFlux > mThresh && nowMs - this._lastOnsetAt > 60) {
        this.onset = true;
        this.onsetStrength = Math.min(2.5, midFlux / mThresh);
        this._lastOnsetAt = nowMs;
      }
      const tThresh = tAvg * 1.45 + 0.5;
      if (trebFlux > tThresh && nowMs - this._lastHatAt > 45) {
        this.hat = true;
        this.hatStrength = Math.min(2, trebFlux / tThresh);
        this._lastHatAt = nowMs;
      }
      // continuous: how transient-rich is this exact moment (0 = sustained pad)
      this.transient = Math.min(1, flux / (fAvg * 2.0 + 1.0));
    }

    // grid tick: when locked, beats fire dead on the predicted grid — even if
    // a kick is buried in the mix — so the visuals never drift or stutter
    const g = this._grid;
    if (this.gridLocked && g.period && this.playing) {
      while (nowMs >= g.next) {
        this.kick = true;
        this.kickStrength = this._lastDetStrength;
        this.beatCount++;
        g.next += g.period;
      }
      this.beatPhase = 1 - Math.min(1, Math.max(0, g.next - nowMs) / g.period);
      this.bpm = Math.round(60000 / g.period);
    } else {
      this.beatPhase = 0;
    }

    this._bFluxHist[this._histIdx] = bassFlux;
    this._mFluxHist[this._histIdx] = midFlux;
    this._tFluxHist[this._histIdx] = trebFlux;
    this._fluxHist[this._histIdx] = flux;
    this._histIdx = (this._histIdx + 1) % HISTORY;
    this._histFill = Math.min(HISTORY, this._histFill + 1);
  }

  // chromagram + key estimate — the visuals learn what key the song is in
  _updateKey(nowMs) {
    const lo = Math.max(2, Math.floor(60 / this._binHz));
    const hi = Math.min(this.binCount - 1, Math.ceil(4500 / this._binHz));
    const raw = AudioEngine._chromaScratch || (AudioEngine._chromaScratch = new Float32Array(12));
    raw.fill(0);
    for (let i = lo; i <= hi; i++) {
      const v = this.freq[i];
      if (v < 14) continue;
      const pitch = 12 * Math.log2((i * this._binHz) / 440) + 69;
      raw[((Math.round(pitch) % 12) + 12) % 12] += (v / 255) * (v / 255);
    }
    let max = 0;
    for (let p = 0; p < 12; p++) max = Math.max(max, raw[p]);
    if (max > 0.01) {
      for (let p = 0; p < 12; p++) {
        this.chroma[p] += (raw[p] / max - this.chroma[p]) * 0.04;
      }
    }
    // every ~1.5 s: correlate against Krumhansl major/minor profiles
    this._keyTimer += 1;
    if (this._keyTimer < 90) return;
    this._keyTimer = 0;
    const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    let best = -Infinity, bestPc = this.keyPc, bestMinor = this.keyMinor;
    for (let pc = 0; pc < 12; pc++) {
      let sMaj = 0, sMin = 0;
      for (let i = 0; i < 12; i++) {
        const c = this.chroma[(pc + i) % 12];
        sMaj += c * MAJ[i]; sMin += c * MIN[i];
      }
      if (sMaj > best) { best = sMaj; bestPc = pc; bestMinor = false; }
      if (sMin > best) { best = sMin; bestPc = pc; bestMinor = true; }
    }
    // hysteresis: only flip when the new key clearly beats the old one
    const changed = bestPc !== this.keyPc || bestMinor !== this.keyMinor;
    if (changed && best > this._keyScore * 1.06) {
      this.keyPc = bestPc;
      this.keyMinor = bestMinor;
      this.keyChanged = true;
      const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
      this.keyName = NAMES[bestPc] + (bestMinor ? 'm' : '');
      this.keyHue = ((bestPc * 7) % 12) / 12; // circle of fifths -> hue wheel
    }
    this._keyScore = best;
  }

  _trackBpm(nowMs) {
    const t = this._kickTimes;
    t.push(nowMs);
    while (t.length && nowMs - t[0] > 12000) t.shift();
    if (t.length < 4) return;
    const gaps = [];
    for (let i = 1; i < t.length; i++) {
      const g = t[i] - t[i - 1];
      if (g > 230 && g < 1500) gaps.push(g);
    }
    if (!gaps.length) return;
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    this.bpm = Math.round(60000 / median);
  }
}
