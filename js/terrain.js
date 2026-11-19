// Terrain data: 1024x1024 periodic color + height maps, plus two mip levels
// that the renderer uses for distant layers (less shimmer, fewer cache misses).

import { MAP_SIZE, MAP_MASK, wdelta } from './util.js';

export const MAPS = [
  ['C1W', 'D1', '沙漠峡谷'], ['C2W', 'D2', '绿色丘陵'], ['C3', 'D3', '岩石高原'],
  ['C4', 'D4', '红土荒原'], ['C5W', 'D5', '湖区'], ['C6W', 'D6', '雪线'],
  ['C7W', 'D7', '海岸'], ['C8', 'D6', '冰原'], ['C9W', 'D9', '河谷'],
  ['C10W', 'D10', '群岛'], ['C11W', 'D11', '火山'], ['C12W', 'D11', '火山之夜'],
  ['C13', 'D13', '平原'], ['C14', 'D14', '沙丘'], ['C14W', 'D14', '沙丘绿洲'],
  ['C15', 'D15', '山脉'], ['C16W', 'D16', '森林'], ['C17W', 'D17', '高山湖'],
  ['C18W', 'D18', '海峡'], ['C19W', 'D19', '盆地'], ['C20W', 'D20', '台地'],
  ['C21', 'D21', '戈壁'], ['C22W', 'D22', '沼泽'], ['C23W', 'D21', '绿洲'],
  ['C24W', 'D24', '冻土'], ['C25W', 'D25', '岛屿'], ['C26W', 'D18', '黄昏海峡'],
  ['C27W', 'D15', '秋山'], ['C28W', 'D25', '珊瑚岛'], ['C29W', 'D16', '雨林'],
];

function loadImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = MAP_SIZE; c.height = MAP_SIZE;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, MAP_SIZE, MAP_SIZE);
      resolve(ctx.getImageData(0, 0, MAP_SIZE, MAP_SIZE).data);
    };
    img.onerror = () => reject(new Error('无法加载地图 ' + url + '（请通过 http 服务器打开）'));
    img.src = url;
  });
}

// Box-filter one level down. Heights are averaged, colors averaged per channel.
function downsample(srcH, srcC, size) {
  const n = size >> 1;
  const h = new Uint8Array(n * n);
  const c = new Uint32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i0 = (y * 2) * size + x * 2, i1 = i0 + 1, i2 = i0 + size, i3 = i2 + 1;
      h[y * n + x] = (srcH[i0] + srcH[i1] + srcH[i2] + srcH[i3] + 2) >> 2;
      const a = srcC[i0], b = srcC[i1], d = srcC[i2], e = srcC[i3];
      const r = ((a & 255) + (b & 255) + (d & 255) + (e & 255)) >> 2;
      const g = (((a >> 8) & 255) + ((b >> 8) & 255) + ((d >> 8) & 255) + ((e >> 8) & 255)) >> 2;
      const bl = (((a >> 16) & 255) + ((b >> 16) & 255) + ((d >> 16) & 255) + ((e >> 16) & 255)) >> 2;
      c[y * n + x] = (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0;
    }
  }
  return { h, c, size: n, shift: Math.log2(n), mask: n - 1 };
}

export class Terrain {
  constructor() {
    const n = MAP_SIZE * MAP_SIZE;
    this.height = new Uint8Array(n);
    this.color = new Uint32Array(n).fill(0xff507000);
    this.levels = [];
    this.waterLevel = -1;
    this.buildMips();
  }

  async load(colorName, heightName, base = 'maps/') {
    const [dc, dh] = await Promise.all([
      loadImageData(base + colorName + '.png'),
      loadImageData(base + heightName + '.png'),
    ]);
    const n = MAP_SIZE * MAP_SIZE;
    for (let i = 0; i < n; i++) {
      const j = i << 2;
      this.color[i] = (0xff000000 | (dc[j + 2] << 16) | (dc[j + 1] << 8) | dc[j]) >>> 0;
      this.height[i] = dh[j];
    }
    this.buildMips();
  }

  buildMips() {
    const l0 = { h: this.height, c: this.color, size: MAP_SIZE, shift: 10, mask: MAP_MASK };
    const l1 = downsample(l0.h, l0.c, l0.size);
    const l2 = downsample(l1.h, l1.c, l1.size);
    this.levels = [l0, l1, l2];
  }

  // Bilinear height in world units. Works for any real coordinate (wraps).
  heightAt(x, y) {
    const fx = Math.floor(x), fy = Math.floor(y);
    const tx = x - fx, ty = y - fy;
    const x0 = fx & MAP_MASK, y0 = fy & MAP_MASK;
    const x1 = (x0 + 1) & MAP_MASK, y1 = (y0 + 1) & MAP_MASK;
    const H = this.height;
    const a = H[(y0 << 10) | x0], b = H[(y0 << 10) | x1];
    const c = H[(y1 << 10) | x0], d = H[(y1 << 10) | x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  colorAt(x, y) {
    return this.color[((Math.floor(y) & MAP_MASK) << 10) | (Math.floor(x) & MAP_MASK)];
  }

  // Max terrain height in a small neighbourhood (for safe spawn heights).
  maxHeightAround(x, y, r) {
    let m = 0;
    for (let dy = -r; dy <= r; dy += 4)
      for (let dx = -r; dx <= r; dx += 4) m = Math.max(m, this.heightAt(x + dx, y + dy));
    return m;
  }

  // Terrain slope magnitude (height units per world unit).
  slopeAt(x, y) {
    const hx = this.heightAt(x + 2, y) - this.heightAt(x - 2, y);
    const hy = this.heightAt(x, y + 2) - this.heightAt(x, y - 2);
    return Math.hypot(hx, hy) / 4;
  }

  // True when the segment a->b dips under the terrain anywhere in the middle.
  blocked(a, b, step = 8) {
    const dx = wdelta(b.x - a.x), dy = wdelta(b.y - a.y), dh = b.h - a.h;
    const len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.ceil(len / step));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.heightAt(a.x + dx * t, a.y + dy * t) > a.h + dh * t + 1) return true;
    }
    return false;
  }
}
