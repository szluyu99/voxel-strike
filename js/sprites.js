// Voxel models and depth-tested sprite drawing into the renderer's buffers.
// Each model is a list of small cubes in local space:
//   lx = right, ly = forward, lh = up, plus a color. Cubes are drawn as
//   screen-aligned squares and tested against the terrain depth buffer, so
//   mountains correctly hide units behind them.

import { rgb, scaleColor, wdelta } from './util.js';
import { VSCALE } from './renderer.js';

function makeModel() { return { vox: [], size: 1 }; }

function box(m, x0, x1, y0, y1, h0, h1, col, step) {
  for (let h = h0; h <= h1 + 1e-6; h += step)
    for (let y = y0; y <= y1 + 1e-6; y += step)
      for (let x = x0; x <= x1 + 1e-6; x += step) {
        // only keep the shell, the inside is never visible
        const edge = x - x0 < step * 0.5 || x1 - x < step * 0.5 || y - y0 < step * 0.5 ||
          y1 - y < step * 0.5 || h - h0 < step * 0.5 || h1 - h < step * 0.5;
        if (!edge) continue;
        const shade = 0.75 + 0.35 * ((h - h0) / Math.max(step, h1 - h0));
        m.vox.push([x, y, h, scaleColor(col, shade)]);
      }
  m.size = step;
  return m;
}

const OLIVE = rgb(92, 104, 58), OLIVE_D = rgb(62, 70, 40), DARK = rgb(40, 42, 40);
const SAND = rgb(150, 132, 92), RED = rgb(170, 40, 30), GREY = rgb(110, 114, 118);
const NAVY = rgb(52, 60, 76), GLASS = rgb(90, 160, 200), WHITE = rgb(230, 230, 220);

export const MODELS = {};

{
  const m = makeModel(); const s = 1.2;
  box(m, -3.6, 3.6, -5.4, 5.4, 0, 0, DARK, s);          // tracks
  box(m, -3, 3, -4.8, 4.8, 1.2, 2.4, OLIVE, s);          // hull
  box(m, -1.8, 1.8, -2.4, 1.8, 3.6, 4.8, OLIVE_D, s);    // turret
  MODELS.tank = m;
  const t = makeModel();                                  // barrel, rotated separately
  for (let y = 1.8; y <= 8; y += s) t.vox.push([0, y, 4.2, DARK]);
  t.size = s;
  MODELS.tankGun = t;
}
{
  const m = makeModel(); const s = 1.2;
  box(m, -4.2, 4.2, -4.2, 4.2, 0, 1.2, SAND, s);         // concrete pad
  box(m, -2.4, 2.4, -2.4, 2.4, 2.4, 3.6, GREY, s);       // launcher base
  for (let k = 0; k < 6; k++) {                           // two angled tubes
    m.vox.push([-1.4, -1 + k * 1.1, 4.8 + k * 0.9, WHITE]);
    m.vox.push([1.4, -1 + k * 1.1, 4.8 + k * 0.9, WHITE]);
  }
  m.vox.push([-1.4, 5.6, 10.2, RED], [1.4, 5.6, 10.2, RED]);
  MODELS.sam = m;
}
{
  const m = makeModel(); const s = 1.1;
  box(m, -1.6, 1.6, -3.3, 3.3, -1.6, 1.6, NAVY, s);      // fuselage
  box(m, -1.1, 1.1, 3.3, 4.4, -1.1, 0.6, GLASS, s);      // canopy
  for (let y = -4.4; y >= -11; y -= s) m.vox.push([0, y, 0.5, NAVY]); // tail boom
  m.vox.push([0, -11, 1.6, RED], [0, -11, 2.7, RED], [1.1, -11, 1.6, NAVY]);
  box(m, -2.2, 2.2, -2.2, 2.2, -3.3, -3.3, DARK, s);     // skids
  MODELS.heli = m;
}
{
  const m = makeModel(); const s = 1.0;
  box(m, -2, 2, -2, 2, -2, 2, rgb(30, 160, 60), s);
  for (let k = -1; k <= 1; k++) m.vox.push([k, -2.6, 0, WHITE], [0, -2.6, k, WHITE]);
  MODELS.repair = m;
}
{
  const m = makeModel(); const s = 1.0;
  box(m, -2, 2, -2, 2, -2, 2, rgb(200, 160, 30), s);
  for (let k = -1; k <= 1; k++) m.vox.push([k, -2.6, 1, DARK], [k, -2.6, -1, DARK]);
  MODELS.ammo = m;
}

// --- low level drawing ------------------------------------------------------

function fillRect(R, cx, cy, hw, hh, z, col, alpha) {
  const w = R.w, h = R.h, buf = R.buf, depth = R.depth;
  let x0 = (cx - hw) | 0, x1 = (cx + hw) | 0, y0 = (cy - hh) | 0, y1 = (cy + hh) | 0;
  if (x1 < 0 || y1 < 0 || x0 >= w || y0 >= h) return;
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
  if (x1 >= w) x1 = w - 1; if (y1 >= h) y1 = h - 1;
  if (alpha >= 1) {
    for (let y = y0; y <= y1; y++) {
      let p = y * w + x0;
      for (let x = x0; x <= x1; x++, p++) if (depth[p] > z) { buf[p] = col; depth[p] = z; }
    }
    return;
  }
  const cr = col & 255, cg = (col >> 8) & 255, cb = (col >> 16) & 255;
  for (let y = y0; y <= y1; y++) {
    let p = y * w + x0;
    for (let x = x0; x <= x1; x++, p++) {
      if (depth[p] <= z) continue;
      const d = buf[p];
      const r = d & 255, g = (d >> 8) & 255, b = (d >> 16) & 255;
      buf[p] = (0xff000000 | (((b + (cb - b) * alpha) | 0) << 16) |
        (((g + (cg - g) * alpha) | 0) << 8) | ((r + (cr - r) * alpha) | 0)) >>> 0;
    }
  }
}

// Draw a voxel model. Returns the projected screen center (for HUD markers) or null.
const tmp = {};
export function drawModel(R, model, x, y, h, yaw, scale = 1, opts = {}) {
  const c = R.cam, b = R.basis;
  const ox = wdelta(x - c.x), oy = wdelta(y - c.y);
  const zc = ox * b.fx + oy * b.fy;
  if (zc < 2 || zc > R.distance) return null;
  const fxm = Math.sin(yaw), fym = -Math.cos(yaw);
  const rxm = Math.cos(yaw), rym = Math.sin(yaw);
  const pitch = opts.pitch || 0, cp = Math.cos(pitch), sp = Math.sin(pitch);
  const flash = opts.flash || 0;
  const fog = R.fogAt(zc);
  const half = R.w / 2, focal = R.focal, pf = focal * VSCALE;
  const size = model.size * scale * 0.62;
  const vox = model.vox;
  for (let i = 0; i < vox.length; i++) {
    const v = vox[i];
    let lx = v[0] * scale, ly = v[1] * scale, lh = v[2] * scale;
    if (pitch) { const ny = ly * cp - lh * sp; lh = ly * sp + lh * cp; ly = ny; }
    const wx = ox + rxm * lx + fxm * ly, wy = oy + rym * lx + fym * ly;
    const z = wx * b.fx + wy * b.fy;
    if (z < 1) continue;
    const xr = wx * b.rx + wy * b.ry;
    const sx = half + xr * focal / z;
    const sy = R.horizon + (sx - half) * R.tanRoll + (c.h - h - lh) * pf / z;
    let col = v[3];
    if (flash > 0) col = scaleColor(col, 1 + flash * 2);
    if (fog > 0) col = mixRgb(col, R.fogColor, fog);
    const s = Math.max(0.5, size * focal / z);
    fillRect(R, sx, sy, s, s * VSCALE + 0.5, z, col, 1);
  }
  const p = R.project(x, y, h, tmp);
  return p ? { sx: p.sx, sy: p.sy, z: p.z, scale: p.scale } : null;
}

function mixRgb(a, b, t) {
  const ar = a & 255, ag = (a >> 8) & 255, ab = (a >> 16) & 255;
  return (0xff000000 | (((ab + (((b >> 16) & 255) - ab) * t) | 0) << 16) |
    (((ag + (((b >> 8) & 255) - ag) * t) | 0) << 8) | ((ar + ((b & 255) - ar) * t) | 0)) >>> 0;
}

// Rotor disc for helicopters: two blades spinning around the mast.
export function drawRotor(R, x, y, h, angle, radius, col) {
  for (let blade = 0; blade < 2; blade++) {
    const a = angle + blade * Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let r = -radius; r <= radius; r += 1.2) {
      drawPoint(R, x + ca * r, y + sa * r, h, 0.5, col, 1);
    }
  }
}

// World-space point sprite (particles, bullets). size is world radius.
export function drawPoint(R, x, y, h, size, col, alpha = 1) {
  const p = R.project(x, y, h, tmp);
  if (!p || p.z > R.distance) return;
  const s = Math.max(0.6, size * p.scale);
  fillRect(R, p.sx, p.sy, s, s * VSCALE + 0.3, p.z, col, alpha);
}
