// Shared material + geometry helpers: GLSL simplex noise, liquid (transmission
// + organic vertex wobble) materials, noise-displaced rock geometry, and the
// frequency DataTexture that streams the live spectrum into shaders.

import * as THREE from 'three';

// Ashima/IQ 3D simplex noise — injected into any shader that needs it.
export const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 mod289(vec4 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ f += a * snoise(p); p *= 2.02; a *= 0.5; }
  return f;
}
`;

// JS-side simplex (small + fast enough for one-off geometry displacement)
const _grad = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const _p = new Uint8Array(512);
{
  // fixed-seed permutation so rocks are stable run to run
  let seed = 1337;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const base = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) _p[i] = base[i & 255];
}
function noise3(x, y, z) {
  // classic Perlin-style gradient noise, good enough for rock displacement
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const u = fade(x), v = fade(y), w = fade(z);
  const g = (h, x, y, z) => { const G = _grad[h % 12]; return G[0] * x + G[1] * y + G[2] * z; };
  const A = _p[X] + Y, AA = _p[A] + Z, AB = _p[A + 1] + Z;
  const B = _p[X + 1] + Y, BA = _p[B] + Z, BB = _p[B + 1] + Z;
  const lerp = (t, a, b) => a + t * (b - a);
  return lerp(w,
    lerp(v, lerp(u, g(_p[AA], x, y, z), g(_p[BA], x - 1, y, z)),
            lerp(u, g(_p[AB], x, y - 1, z), g(_p[BB], x - 1, y - 1, z))),
    lerp(v, lerp(u, g(_p[AA + 1], x, y, z - 1), g(_p[BA + 1], x - 1, y, z - 1)),
            lerp(u, g(_p[AB + 1], x, y - 1, z - 1), g(_p[BB + 1], x - 1, y - 1, z - 1))));
}

// Irregular rock: icosahedron displaced by layered noise. Looks geological,
// stays a sphere collider in Rapier (close enough at this displacement).
export function makeRockGeometry(radius, seed = 0, jaggedness = 0.35) {
  const geo = new THREE.IcosahedronGeometry(radius, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d = 1
      + noise3(n.x * 2 + seed, n.y * 2 + seed, n.z * 2 + seed) * jaggedness
      + noise3(n.x * 6 + seed, n.y * 6 + seed, n.z * 6 + seed) * jaggedness * 0.35;
    pos.setXYZ(i, n.x * radius * d, n.y * radius * d, n.z * radius * d);
  }
  geo.computeVertexNormals();
  return geo;
}

// Organic vertex wobble — patches noise displacement into any built-in
// material. uWobble drives amplitude (wire it to the audio every frame).
export function addWobble(material, { scale = 1.5, speed = 1.0 } = {}) {
  material.userData.uTime = { value: 0 };
  material.userData.uWobble = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = material.userData.uTime;
    shader.uniforms.uWobble = material.userData.uWobble;
    shader.vertexShader = NOISE_GLSL + `
uniform float uTime; uniform float uWobble;
` + shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
{
  vec3 nrm = normalize(transformed);
  float w = snoise(nrm * ${scale.toFixed(2)} + vec3(uTime * ${speed.toFixed(2)}));
  transformed += normal * w * uWobble;
}`);
  };
  return material;
}

// Oil-slick / soap-bubble iridescence: a view-angle rainbow fresnel painted
// onto any material's surface. The rim shifts through the spectrum as the
// camera moves — that holographic, petrol-on-water shimmer.
export function addIridescence(material, { strength = 0.6, speed = 0.05 } = {}) {
  material.userData.uIriTime = material.userData.uIriTime || { value: 0 };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    if (prev) prev(shader);
    shader.uniforms.uIriTime = material.userData.uIriTime;
    shader.uniforms.uIriStrength = { value: strength };
    shader.fragmentShader = `
uniform float uIriTime; uniform float uIriStrength;
vec3 iriHue(float t){
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}
` + shader.fragmentShader.replace(
      '#include <output_fragment>',
      `#include <output_fragment>
{
  float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
  vec3 sheen = iriHue(fres * 1.6 + uIriTime * ${speed.toFixed(3)});
  gl_FragColor.rgb += sheen * fres * uIriStrength;
}`
    ).replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
{
  float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
  vec3 sheen = iriHue(fres * 1.6 + uIriTime * ${speed.toFixed(3)});
  gl_FragColor.rgb += sheen * fres * uIriStrength;
}`
    );
  };
  return material;
}

// Liquid blob material: glassy transmission + iridescence + wobble.
export function makeLiquidMaterial(color, { transmission = 0.9, wobbleScale = 1.6 } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color, metalness: 0, roughness: 0.08,
    transmission, thickness: 1.2, ior: 1.33,
    iridescence: 0.5, iridescenceIOR: 1.3,
    clearcoat: 1, clearcoatRoughness: 0.1,
    envMapIntensity: 1.4,
    emissive: new THREE.Color(color).multiplyScalar(0.25),
    emissiveIntensity: 0.4,
  });
  return addWobble(mat, { scale: wobbleScale, speed: 0.8 });
}

// Live spectrum as shader textures: a 128-band strip (this frame) plus a
// 128x64 rolling history — row 0 is now, row 63 is ~4 s ago. The history is
// what lets the wave-grid terrain literally be the song's recent past.
export function makeFreqTexture() {
  const HISTORY_ROWS = 64;
  const data = new Uint8Array(128 * 4);
  const tex = new THREE.DataTexture(data, 128, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  const hist = new Uint8Array(128 * HISTORY_ROWS * 4);
  const histTex = new THREE.DataTexture(hist, 128, HISTORY_ROWS, THREE.RGBAFormat);
  histTex.needsUpdate = true;
  let frame = 0;
  return {
    texture: tex,
    history: histTex,
    update(freq, binCount) {
      const step = Math.floor((binCount * 0.7) / 128);
      for (let i = 0; i < 128; i++) {
        let v = 0;
        for (let j = 0; j < step; j++) v += freq[i * step + j];
        data[i * 4] = v / step;
        data[i * 4 + 3] = 255;
      }
      tex.needsUpdate = true;
      // push a history row every 4th frame (~15 rows/s -> 64 rows ≈ 4 s)
      if (++frame % 4 === 0) {
        hist.copyWithin(128 * 4, 0, 128 * (HISTORY_ROWS - 1) * 4);
        hist.set(data, 0);
        histTex.needsUpdate = true;
      }
    },
  };
}
