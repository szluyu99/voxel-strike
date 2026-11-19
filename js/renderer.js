// Voxel Space renderer, column ray-cast variant.
//
// Differences from the original demo (VoxelSpace.html):
//  * one ray per screen column, front to back, stops as soon as the column is full
//  * camera-plane rays (no fish-eye), so depth == distance along the view axis
//  * step size grows with distance and far samples read pre-filtered mip levels
//  * bilinear height close to the camera, distance fog, sky gradient
//  * roll via per-column horizon shear, pitch via horizon shift (like Comanche)
//  * a per-pixel depth buffer so sprites/particles are occluded by terrain

import { rgb, mixColor, clamp, wdelta } from './util.js';

export const VSCALE = 0.75; // vertical exaggeration of terrain/entities on screen

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fov = Math.PI / 2;
    this.distance = 1000;
    this.detail = 1;
    this.skyTop = rgb(48, 92, 170);
    this.skyHorizon = rgb(192, 210, 228);
    this.fogColor = this.skyHorizon;
    this.cam = { x: 512, y: 512, h: 120, yaw: 0, pitch: 0, roll: 0 };
    this.basis = { fx: 0, fy: -1, rx: 1, ry: 0 };
    this.horizon = 0;
    this.tanRoll = 0;
    this.resize(640, 360);
  }

  resize(w, h) {
    w = Math.max(160, w | 0); h = Math.max(90, h | 0);
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    this.image = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.depth = new Float32Array(w * h);
    this.focal = (w / 2) / Math.tan(this.fov / 2);
    this.buildSky();
    this.stepsDirty = true;
  }

  setSky(top, horizon) {
    this.skyTop = top; this.skyHorizon = horizon; this.fogColor = horizon;
    this.buildSky();
  }

  setDistance(d) { this.distance = d; this.stepsDirty = true; }
  setDetail(k) { this.detail = k; this.stepsDirty = true; }

  buildSky() {
    const n = this.h * 6;
    this.skyOff = this.h * 3;
    this.sky = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i - this.skyOff; // pixels above the horizon
      if (k <= 0) { this.sky[i] = this.fogColor; continue; }
      const t = Math.pow(Math.min(1, k / (this.h * 0.9)), 0.6);
      this.sky[i] = mixColor(this.skyHorizon, this.skyTop, t);
    }
  }

  // The sample distances are identical for every column, so fog weight,
  // 1/z and mip level are computed once per settings change.
  buildSteps() {
    const D = this.distance;
    const spacingK = 2 * Math.tan(this.fov / 2) / this.w;
    const zs = [], fog = [], lvl = [];
    let z = 1;
    while (z < D) {
      const dz = (0.25 + z * 0.0055) * this.detail;
      zs.push(z);
      fog.push(this.fogAt(z));
      const res = Math.max(dz, z * spacingK);
      lvl.push(res >= 4 ? 2 : res >= 2 ? 1 : 0);
      z += dz;
    }
    this.zs = Float32Array.from(zs);
    this.invz = Float32Array.from(zs, (v) => 1 / v);
    this.fogT = Float32Array.from(fog);
    this.lvl = Uint8Array.from(lvl);
    this.stepsDirty = false;
  }

  fogAt(z) {
    const D = this.distance;
    const t = clamp((z - D * 0.35) / (D * 0.65), 0, 1);
    return t * t * (3 - 2 * t);
  }

  render(terrain) {
    if (this.stepsDirty) this.buildSteps();
    const { w, h, buf, depth, sky, skyOff, zs, invz, fogT, lvl } = this;
    const cam = this.cam;
    const L = terrain.levels;
    const H0 = L[0].h, C0 = L[0].c, H1 = L[1].h, C1 = L[1].c, H2 = L[2].h, C2 = L[2].c;
    const fx = Math.sin(cam.yaw), fy = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), ry = Math.sin(cam.yaw);
    this.basis.fx = fx; this.basis.fy = fy; this.basis.rx = rx; this.basis.ry = ry;
    const tanHalf = Math.tan(this.fov / 2);
    const tanRoll = Math.tan(cam.roll);
    const horizon = h / 2 + cam.pitch * this.focal;
    this.horizon = horizon; this.tanRoll = tanRoll;
    const pf = this.focal * VSCALE;
    const camX = cam.x, camY = cam.y, camH = cam.h;
    const fogC = this.fogColor;
    const fr = fogC & 255, fg = (fogC >> 8) & 255, fb = (fogC >> 16) & 255;
    const nSteps = zs.length, skyMax = sky.length - 1, half = w / 2;

    for (let i = 0; i < w; i++) {
      const u = (2 * (i + 0.5) / w - 1) * tanHalf;
      const dx = fx + rx * u, dy = fy + ry * u;
      const hor = horizon + (i - half) * tanRoll;
      let ybuf = h;
      for (let s = 0; s < nSteps; s++) {
        const z = zs[s];
        const px = camX + dx * z, py = camY + dy * z;
        const l = lvl[s];
        let ht, col;
        if (l === 0) {
          const idx = ((Math.floor(py) & 1023) << 10) | (Math.floor(px) & 1023);
          ht = z < 90 ? terrain.heightAt(px, py) : H0[idx];
          col = C0[idx];
        } else if (l === 1) {
          const idx = ((Math.floor(py * 0.5) & 511) << 9) | (Math.floor(px * 0.5) & 511);
          ht = H1[idx]; col = C1[idx];
        } else {
          const idx = ((Math.floor(py * 0.25) & 255) << 8) | (Math.floor(px * 0.25) & 255);
          ht = H2[idx]; col = C2[idx];
        }
        const scr = (hor + (camH - ht) * pf * invz[s]) | 0;
        if (scr < ybuf) {
          const f = fogT[s];
          if (f > 0) {
            const r = col & 255, g = (col >> 8) & 255, b = (col >> 16) & 255;
            col = (0xff000000 | (((b + (fb - b) * f) | 0) << 16) |
              (((g + (fg - g) * f) | 0) << 8) | ((r + (fr - r) * f) | 0)) >>> 0;
          }
          const top = scr < 0 ? 0 : scr;
          let p = top * w + i;
          for (let y = top; y < ybuf; y++) { buf[p] = col; depth[p] = z; p += w; }
          ybuf = top;
          if (ybuf <= 0) break;
        }
      }
      let p = i;
      for (let y = 0; y < ybuf; y++) {
        let k = ((hor - y) | 0) + skyOff;
        k = k < 0 ? 0 : k > skyMax ? skyMax : k;
        buf[p] = sky[k]; depth[p] = 1e9; p += w;
      }
    }
  }

  // World point -> screen. Returns null when behind the camera.
  project(x, y, h, out = {}) {
    const c = this.cam, b = this.basis;
    const dx = wdelta(x - c.x), dy = wdelta(y - c.y);
    const z = dx * b.fx + dy * b.fy;
    if (z < 0.5) return null;
    const xr = dx * b.rx + dy * b.ry;
    const sx = this.w / 2 + xr * this.focal / z;
    const hor = this.horizon + (sx - this.w / 2) * this.tanRoll;
    out.sx = sx;
    out.sy = hor + (c.h - h) * this.focal * VSCALE / z;
    out.z = z;
    out.scale = this.focal / z;
    return out;
  }

  present() { this.ctx.putImageData(this.image, 0, 0); }
}
