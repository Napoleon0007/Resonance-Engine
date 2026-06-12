// UI — wires HUD, sliders, presets, upload, drag & drop, spectrum strip.

export class UI {
  constructor(app) {
    this.app = app;
    this.$ = id => document.getElementById(id);

    this.spectrumCanvas = this.$('spectrum');
    this.spectrumCtx = this.spectrumCanvas.getContext('2d');
    this.beatLamp = this.$('beat-lamp');
    this.beatFlash = this.$('beat-flash');
    this._lampOffAt = 0;

    this._bindUpload();
    this._bindSliders();
    this._bindPresets();
    this._bindButtons();
    this._bindDragDrop();
    this._bindIdleHide();
  }

  setBootStatus(text) { this.$('boot-status').textContent = text; }
  enableBoot() { this.$('boot-upload').disabled = false; }

  showHud() {
    this.$('boot-screen').classList.add('fading');
    for (const id of ['hud-top', 'presets', 'drawer', 'drawer-toggle', 'spectrum']) {
      this.$(id).classList.remove('hidden');
    }
  }

  _bindUpload() {
    const input = this.$('file-input');
    this.$('boot-upload').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files[0]) this.app.loadTrack(input.files[0]);
      input.value = '';
    });
    this._fileInput = input;
  }

  _bindDragDrop() {
    let depth = 0;
    document.addEventListener('dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    document.addEventListener('dragleave', e => { e.preventDefault(); if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');
      const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(f.name));
      if (file) this.app.loadTrack(file);
    });
  }

  _bindSliders() {
    this._sliderMap = {
      's-gravity': 'gravity', 's-impulse': 'impulse',
      's-treble': 'treble', 's-light': 'light', 's-master': 'master',
    };
    for (const [id, key] of Object.entries(this._sliderMap)) {
      const el = this.$(id);
      const out = el.parentElement.querySelector('.sval');
      el.addEventListener('input', () => {
        this.app.params[key] = parseFloat(el.value);
        out.textContent = parseFloat(el.value).toFixed(2);
        this.app.saveParams(); // each preset keeps its own mix
      });
    }
  }

  // reflect app.params back into the controls (preset switch restored a mix)
  syncSliders() {
    for (const [id, key] of Object.entries(this._sliderMap)) {
      const el = this.$(id);
      el.value = this.app.params[key];
      el.parentElement.querySelector('.sval').textContent = this.app.params[key].toFixed(2);
    }
  }

  _bindIdleHide() {
    let timer = null;
    const wake = () => {
      document.body.classList.remove('ui-idle');
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (this.app.started) document.body.classList.add('ui-idle');
      }, 3500);
    };
    for (const ev of ['mousemove', 'mousedown', 'touchstart', 'keydown']) {
      document.addEventListener(ev, wake, { passive: true });
    }
    wake();
  }

  _bindPresets() {
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.app.setPreset(btn.dataset.preset);
      });
    });
  }

  _bindButtons() {
    this.$('drawer-toggle').addEventListener('click', () => this._toggleDrawer());
    // touch-friendly twins of the keyboard shortcuts, tucked in the drawer
    this.$('act-pause').addEventListener('click', () => this.app.togglePause());
    this.$('act-full').addEventListener('click', () => this._toggleFullscreen());
    this.$('act-rec').addEventListener('click', () => this.app.toggleRecord());
    this.$('act-track').addEventListener('click', () => this._fileInput.click());
    this.$('act-auto').addEventListener('click', () => this.app.toggleAuto());
    // everything else lives on the keyboard — the screen stays clean
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.code) {
        case 'Space':
          if (this.app.started) { e.preventDefault(); this.app.togglePause(); }
          break;
        case 'KeyF': this._toggleFullscreen(); break;
        case 'KeyR': if (this.app.started) this.app.toggleRecord(); break;
        case 'KeyN': this._fileInput.click(); break;
        case 'KeyT': this._toggleDrawer(); break;
        case 'KeyA': this.app.toggleAuto(); break;
        default: {
          const presets = [...document.querySelectorAll('.preset-btn')];
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= presets.length) presets[n - 1].click();
        }
      }
    });
  }

  _toggleDrawer() { this.$('drawer').classList.toggle('closed'); }

  _toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }

  setRecording(on) {
    this.$('rec-dot').classList.toggle('hidden', !on);
    this.$('act-rec').classList.toggle('on', on);
  }

  setAuto(on) {
    this.$('auto-tag').classList.toggle('on', on);
    this.$('act-auto').classList.toggle('on', on);
  }

  setPausedGlyph(paused) { this.$('act-pause').textContent = paused ? '▶' : '❚❚'; }

  // auto-director picked a scene: light the right glyph without re-triggering
  reflectPreset(name) {
    document.querySelectorAll('.preset-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.preset === name));
  }

  setPaused(paused) {
    // minimal: the track line shows the state, no button needed
    this.$('track-time').style.color = paused ? 'var(--amber)' : '';
    document.body.classList.toggle('paused', paused);
    this.setPausedGlyph(paused);
  }

  setTrackName(name) { this.$('track-name').textContent = name; }

  _fmt(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  // called every frame
  update(audio, audioEl, fps) {
    const now = performance.now();
    this.beatLamp.classList.toggle('locked', !!audio.gridLocked);
    if (audio.kick) {
      this.beatLamp.classList.add('on');
      this._lampOffAt = now + 90;
      this.beatFlash.classList.remove('flash');
      void this.beatFlash.offsetWidth; // restart css animation
      this.beatFlash.classList.add('flash');
    } else if (now > this._lampOffAt) {
      this.beatLamp.classList.remove('on');
    }
    this.$('bpm-readout').textContent = audio.bpm ? `${audio.bpm} BPM` : '— BPM';
    this.$('key-readout').textContent = `KEY ${audio.keyName}`;
    this.$('fps-readout').textContent = String(Math.round(fps));
    this.$('track-time').textContent = document.body.classList.contains('paused')
      ? '❚❚ ' + this._fmt(audioEl.currentTime)
      : `${this._fmt(audioEl.currentTime)} / ${this._fmt(audioEl.duration)}`;
    this._drawSpectrum(audio);
  }

  _drawSpectrum(audio) {
    const ctx = this.spectrumCtx;
    const { width: w, height: h } = this.spectrumCanvas;
    ctx.clearRect(0, 0, w, h);
    const bars = 96;
    const step = Math.floor((audio.binCount * 0.6) / bars); // skip the dead top end
    const bw = w / bars;
    for (let i = 0; i < bars; i++) {
      let v = 0;
      for (let j = 0; j < step; j++) v += audio.freq[i * step + j];
      v /= step * 255;
      const bh = Math.max(1, v * (h - 6));
      const hue = 185 + (i / bars) * 130; // cyan -> pink sweep
      ctx.fillStyle = `hsl(${hue} 100% ${45 + v * 25}%)`;
      ctx.fillRect(i * bw + 1, h - bh - 3, bw - 2, bh);
    }
  }
}
