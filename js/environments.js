// Environment maps — real HDRIs (Polyhaven, bundled in assets/hdri/) feed
// image-based lighting so glass, metal and liquid pick up true reflections.
// Backgrounds stay black (the reference look); HDRIs light, they don't show.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const FILES = {
  studio: 'assets/hdri/studio_small_03.hdr',
  night: 'assets/hdri/moonless_golf.hdr',
  dusk: 'assets/hdri/dikhololo_night.hdr',
  sunset: 'assets/hdri/venice_sunset.hdr',
};

export class Environments {
  constructor(renderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.maps = {};
    this.loader = new RGBELoader();
  }

  async load() {
    const jobs = Object.entries(FILES).map(([key, url]) =>
      new Promise(resolve => {
        this.loader.load(
          url,
          tex => {
            this.maps[key] = this.pmrem.fromEquirectangular(tex).texture;
            tex.dispose();
            resolve();
          },
          undefined,
          () => resolve(), // missing HDRI -> that scene just uses lights only
        );
      }));
    await Promise.all(jobs);
  }

  get(key) { return this.maps[key] || null; }
}
