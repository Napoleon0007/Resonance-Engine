# ⬡ RESONANCE ENGINE

Physics-driven music visualizer. The track *is* the physics: bass bends gravity,
kicks fire impulses, treble sprays particles and bounce, overall energy drives
the lights.

## Run

```bash
cd ~/"Music visualizer"
python3 serve.py        # serves on http://localhost:7437 and opens the browser
```

Then **load any audio file** (or drag & drop it onto the page). Needs internet
on first load — Three.js and Rapier come from CDN.

## Scenes

Each preset is built from one of the reference images in `assets/reference/`.

| Preset | Reference | What it does |
|---|---|---|
| ◉ Pulse Orb | Visualizer 4 | Ferrofluid sphere over a black mirror floor — raw bass snaps the surface, per-band spikes, kick pump; orbiting shards bounce off the mirror |
| ◌ Spirograph | Visualizer 1 | Concentric neon waveform rings, each riding its own band, counter-rotating; kicks tilt the sculpture; comets thread light trails |
| ✺ Psychedelia | Visualizer 2 | Three morphing geometric patterns — spectrum tunnel, kaleidoscope petals, breathing lattice — hard kicks morph to the next; gem blobs drift inside |
| ∿ Wave Grid | Visualizer 5 | 3D spectrogram canyon: the terrain IS the last ~4 s of the song; grid wires + glow nodes + mirrored ceiling; kicks roll a shockwave down the valley |
| ☉ Celestial | — | The real solar system: NASA-derived textures, axial tilts, Saturn's rings, n-body gravity; bass scales G, kicks surge orbits + fire comets |

(Underwater / Molten / Quantum / Mandala retired to `js/scenes/retired/` — recoverable.)

## Interface

Deliberately minimal — five preset glyphs, one quiet status line, everything
else on the keyboard. UI fades away entirely after 3.5 s idle.

| Key | Action |
|---|---|
| SPACE | pause / resume |
| F | fullscreen |
| R | record clip (.webm with audio) |
| N | new track |
| 1–5 | jump scenes |
| A | toggle auto-director |
| T | tuning drawer (sliders, BPM, FPS) |

**Auto-director** (on by default): watches the energy curve and switches
scenes at musical transitions with a flash — manual preset picks pause it for
90 s. **Cinema pass**: god rays from each scene's hero light, anamorphic
streak flares, lens dirt, halation — tuned per scene. Sliders persist per
preset; auto-calibration normalises quiet tracks to hit like loud masters.

## Look

Cinematic pipeline: HDRI image-based lighting (Polyhaven, in assets/hdri/),
ACES tone mapping, soft shadows, bloom, depth of field, and a beat-impact pass
— camera trauma shake, punch-in, shockwave distortion ring, chromatic
aberration spike, exposure flash, film grain + vignette. An FPS governor sheds
effects (DOF first) before it ever sheds frames.

## Controls

- **Preset bar** (bottom) — switch worlds live, physics state rebuilds instantly
- **Reactor panel** (right) — sensitivity sliders: bass→gravity, kick→impulse,
  treble→particles, energy→light, master
- **Space** or ❚❚ — pause/resume (audio + simulation freeze together)
- Camera self-directs: orbits slowly and chases the most energetic body, punches in on kicks

## Stack

- [Three.js](https://threejs.org) 0.160 — rendering
- [Rapier](https://rapier.rs) 0.14 (rapier3d-compat, WASM) — rigid-body physics, one world per scene
- Web Audio API — 1024-bin FFT, band energies, adaptive kick detection
  (sound-energy w/ variance threshold) + spectral-flux onsets, rolling BPM

## Test

```bash
python3 test/run_test.py   # headless Chrome: boots, loads a generated track, cycles all 4 presets
```
