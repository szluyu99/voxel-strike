// HUD drawn on a full-resolution overlay canvas on top of the low-res voxel view.

import { wdelta, clamp, TAU } from './util.js';

const KIND_NAME = { tank: '坦克', sam: '防空导弹', heli: '武装直升机' };

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.toasts = [];
    this.warning = null;
    this.banner = null;
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.w = w; this.h = h;
  }

  toast(text) { this.toasts.push({ text, t: 2.2 }); if (this.toasts.length > 4) this.toasts.shift(); }
  warn(text) { this.warning = { text, t: 2.5 }; }
  showBanner(title, sub = '', t = 2.5) { this.banner = { title, sub, t, max: t }; }

  update(dt) {
    for (const m of this.toasts) m.t -= dt;
    this.toasts = this.toasts.filter((m) => m.t > 0);
    if (this.warning && (this.warning.t -= dt) <= 0) this.warning = null;
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
  }

  draw(g) {
    const c = this.ctx, W = this.w, H = this.h, P = g.player, R = g.renderer;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!g.playing && !g.paused) return;
    const kx = W / R.w, ky = H / R.h;
    c.font = '600 13px ui-monospace, Menlo, monospace';
    c.textBaseline = 'middle';

    // damage flash
    if (P.hurt > 0) {
      const gr = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
      gr.addColorStop(0, 'rgba(255,0,0,0)');
      gr.addColorStop(1, `rgba(255,0,0,${(P.hurt / 0.35) * 0.45})`);
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
    }
    if (P.hp < 30 && !P.dead) {
      c.fillStyle = `rgba(255,40,0,${0.08 + 0.06 * Math.sin(g.time * 8)})`; c.fillRect(0, 0, W, H);
    }

    // target markers
    let best = null, bestD = 1e9;
    for (const e of g.enemies) {
      const s = e.screen;
      if (e.dead || !s) continue;
      const x = s.sx * kx, y = s.sy * ky;
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
      const d = Math.hypot(wdelta(e.x - P.x), wdelta(e.y - P.y), e.h - P.h);
      const r = clamp(e.radius * s.scale * kx * 0.9, 9, 60);
      const col = e.kind === 'sam' && e.tracking ? '#ff4040' : '#ffd040';
      c.strokeStyle = col; c.lineWidth = 1.5;
      bracket(c, x, y, r);
      if (d < 500) {
        c.fillStyle = col; c.textAlign = 'center';
        c.fillText(`${KIND_NAME[e.kind]} ${Math.round(d)}m`, x, y - r - 9);
        const hw = r; // hp bar
        c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(x - hw, y + r + 5, hw * 2, 3);
        c.fillStyle = col; c.fillRect(x - hw, y + r + 5, hw * 2 * (e.hp / e.maxHp), 3);
      }
      const cd = Math.hypot(x - W / 2, y - H / 2);
      if (cd < r + 18 && d < bestD) { best = e; bestD = d; }
    }

    // crosshair
    const cx = W / 2, cy = H / 2;
    c.strokeStyle = best ? '#ff5050' : 'rgba(180,255,180,0.9)'; c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx - 16, cy); c.lineTo(cx - 6, cy); c.moveTo(cx + 6, cy); c.lineTo(cx + 16, cy);
    c.moveTo(cx, cy - 16); c.lineTo(cx, cy - 6); c.moveTo(cx, cy + 6); c.lineTo(cx, cy + 16);
    c.stroke();
    c.beginPath(); c.arc(cx, cy, 2, 0, TAU); c.stroke();
    // gun heat arc
    if (P.gunHeat > 0.02) {
      c.strokeStyle = P.gunHeat > 0.85 ? '#ff4040' : 'rgba(255,200,80,0.8)'; c.lineWidth = 3;
      c.beginPath(); c.arc(cx, cy, 24, Math.PI * 0.75, Math.PI * (0.75 + 0.5 * P.gunHeat)); c.stroke();
    }

    this.drawRadar(g, c, W);
    this.drawStatus(g, c, W, H);
    this.drawMessages(g, c, W, H);
  }

  drawRadar(g, c, W) {
    const P = g.player, R0 = 70, x0 = W - R0 - 16, y0 = R0 + 16, range = 600;
    c.save();
    c.fillStyle = 'rgba(0,20,0,0.55)'; c.strokeStyle = 'rgba(120,255,120,0.6)'; c.lineWidth = 1;
    c.beginPath(); c.arc(x0, y0, R0, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.arc(x0, y0, R0 / 2, 0, TAU); c.stroke();
    // view cone (fov 90°)
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 - R0 * 0.7, y0 - R0 * 0.7);
    c.moveTo(x0, y0); c.lineTo(x0 + R0 * 0.7, y0 - R0 * 0.7); c.stroke();
    const fx = Math.sin(P.yaw), fy = -Math.cos(P.yaw), rx = Math.cos(P.yaw), ry = Math.sin(P.yaw);
    const plot = (wx, wy) => {
      const dx = wdelta(wx - P.x), dy = wdelta(wy - P.y);
      let u = (dx * rx + dy * ry) / range, v = (dx * fx + dy * fy) / range;
      const l = Math.hypot(u, v); if (l > 1) { u /= l; v /= l; }
      return [x0 + u * R0, y0 - v * R0, l > 1];
    };
    for (const e of g.enemies) {
      if (e.dead) continue;
      const [x, y, edge] = plot(e.x, e.y);
      c.fillStyle = e.kind === 'sam' ? (e.tracking ? '#ff3030' : '#ff9030') : e.kind === 'heli' ? '#ff60ff' : '#ffe040';
      c.globalAlpha = edge ? 0.5 : 1;
      if (e.kind === 'heli') { c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill(); }
      else c.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    c.globalAlpha = 1;
    for (const k of g.world.pickups) {
      const [x, y] = plot(k.x, k.y);
      c.fillStyle = k.type === 'repair' ? '#40ff80' : '#40c0ff';
      c.fillRect(x - 2, y - 2, 4, 4);
    }
    for (const p of g.world.projectiles) {
      if (p.kind !== 'sam') continue;
      const [x, y] = plot(p.x, p.y);
      c.fillStyle = '#fff'; c.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    c.fillStyle = '#9f9';
    c.beginPath(); c.moveTo(x0, y0 - 6); c.lineTo(x0 - 4, y0 + 4); c.lineTo(x0 + 4, y0 + 4); c.fill();
    // compass
    const hd = ((P.yaw % TAU) + TAU) % TAU;
    c.textAlign = 'center'; c.fillStyle = '#cfc';
    c.fillText(`${String(Math.round(hd * 180 / Math.PI)).padStart(3, '0')}°`, x0, y0 + R0 + 12);
    c.restore();
  }

  drawStatus(g, c, W, H) {
    const P = g.player;
    c.textAlign = 'left';
    // score / wave
    c.fillStyle = '#fff'; c.font = '700 18px ui-monospace, Menlo, monospace';
    c.fillText(`分数 ${g.score}`, 16, 24);
    c.font = '600 13px ui-monospace, Menlo, monospace';
    c.fillStyle = '#ddd';
    c.fillText(`第 ${g.wave} 波  剩余敌人 ${g.enemies.filter((e) => !e.dead).length}`, 16, 46);
    c.fillText(`最高分 ${g.highScore}`, 16, 64);
    if (g.combo > 1) { c.fillStyle = '#ffd040'; c.fillText(`连击 x${g.combo}`, 16, 82); }

    // bottom-left bars
    const bx = 16, by = H - 92, bw = 200;
    bar(c, bx, by, bw, 12, P.hp / P.maxHp, P.hp < 30 ? '#ff4040' : '#50e070', `机体 ${Math.ceil(P.hp)}`);
    c.fillStyle = '#eee';
    c.fillText(`机炮 ${P.ammo}${P.gunHeat >= 1 ? '  过热!' : ''}`, bx, by + 30);
    c.fillText(`火箭 ${P.rockets}`, bx, by + 48);
    c.fillText(`干扰弹 ${P.flares}`, bx, by + 66);

    // bottom-right flight data
    c.textAlign = 'right';
    const lowAlt = P.agl < 18;
    c.fillStyle = '#cfc';
    c.fillText(`速度 ${Math.round(P.speed * 3)} km/h`, W - 16, H - 66);
    c.fillText(`高度 ${Math.round(P.h)}`, W - 16, H - 48);
    c.fillStyle = lowAlt ? '#7fdcff' : '#cfc';
    c.fillText(`离地 ${Math.round(P.agl)}${lowAlt ? '  雷达隐蔽' : ''}`, W - 16, H - 30);
    c.textAlign = 'left';
  }

  drawMessages(g, c, W, H) {
    c.textAlign = 'center';
    let y = H * 0.68;
    for (const m of this.toasts) {
      c.globalAlpha = Math.min(1, m.t * 2);
      c.font = '600 15px system-ui, sans-serif'; c.fillStyle = '#fff';
      c.fillText(m.text, W / 2, y); y += 22;
    }
    c.globalAlpha = 1;
    if (this.warning && Math.floor(g.time * 6) % 2 === 0) {
      c.font = '800 20px system-ui, sans-serif'; c.fillStyle = '#ff3030';
      c.fillText(this.warning.text, W / 2, H * 0.28);
    }
    const missile = g.world.projectiles.some((p) => p.kind === 'sam' && p.target === g.player);
    if (missile && !this.warning && Math.floor(g.time * 4) % 2 === 0) {
      c.font = '800 16px system-ui, sans-serif'; c.fillStyle = '#ff5050';
      c.fillText('⚠ 导弹锁定', W / 2, H * 0.28);
    }
    if (this.banner) {
      const b = this.banner, a = Math.min(1, b.t * 2, (b.max - b.t) * 3);
      c.globalAlpha = a;
      c.font = '800 34px system-ui, sans-serif'; c.fillStyle = '#fff';
      c.fillText(b.title, W / 2, H * 0.38);
      if (b.sub) { c.font = '500 16px system-ui, sans-serif'; c.fillStyle = '#ddd'; c.fillText(b.sub, W / 2, H * 0.38 + 34); }
      c.globalAlpha = 1;
    }
  }
}

function bracket(c, x, y, r) {
  const k = r * 0.45;
  c.beginPath();
  c.moveTo(x - r, y - r + k); c.lineTo(x - r, y - r); c.lineTo(x - r + k, y - r);
  c.moveTo(x + r - k, y - r); c.lineTo(x + r, y - r); c.lineTo(x + r, y - r + k);
  c.moveTo(x + r, y + r - k); c.lineTo(x + r, y + r); c.lineTo(x + r - k, y + r);
  c.moveTo(x - r + k, y + r); c.lineTo(x - r, y + r); c.lineTo(x - r, y + r - k);
  c.stroke();
}

function bar(c, x, y, w, h, t, col, label) {
  c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(x, y, w, h);
  c.fillStyle = col; c.fillRect(x, y, w * clamp(t, 0, 1), h);
  c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w, h);
  c.fillStyle = '#fff'; c.fillText(label, x + w + 8, y + h / 2);
}
