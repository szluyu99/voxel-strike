// Small math / color helpers shared by every module.
// Colors are stored as 32-bit little-endian ABGR so they can be written
// straight into a Uint32Array view of ImageData.

export const TAU = Math.PI * 2;
export const MAP_SIZE = 1024;
export const MAP_MASK = 1023;

export const rgb = (r, g, b) => ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;

export function scaleColor(c, k) {
  let r = (c & 255) * k, g = ((c >> 8) & 255) * k, b = ((c >> 16) & 255) * k;
  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
  return rgb(r | 0, g | 0, b | 0);
}

export function mixColor(a, b, t) {
  const ar = a & 255, ag = (a >> 8) & 255, ab = (a >> 16) & 255;
  const br = b & 255, bg = (b >> 8) & 255, bb = (b >> 16) & 255;
  return rgb((ar + (br - ar) * t) | 0, (ag + (bg - ag) * t) | 0, (ab + (bb - ab) * t) | 0);
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Wrap a coordinate into [0, MAP_SIZE). The maps are periodic.
export function wrap(v) {
  v %= MAP_SIZE;
  return v < 0 ? v + MAP_SIZE : v;
}

// Shortest signed difference on the periodic map.
export function wdelta(d) {
  return d - MAP_SIZE * Math.round(d / MAP_SIZE);
}

export function angleDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approach(cur, target, maxStep) {
  const d = target - cur;
  if (d > maxStep) return cur + maxStep;
  if (d < -maxStep) return cur - maxStep;
  return target;
}

// Exponential smoothing that is frame-rate independent.
export function damp(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

// Vector between two world points, honoring map wrap-around.
export function delta3(a, b) {
  return { x: wdelta(b.x - a.x), y: wdelta(b.y - a.y), h: b.h - a.h };
}

export function dist2D(a, b) {
  return Math.hypot(wdelta(b.x - a.x), wdelta(b.y - a.y));
}

export function dist3(a, b) {
  return Math.hypot(wdelta(b.x - a.x), wdelta(b.y - a.y), b.h - a.h);
}
