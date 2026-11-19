// Projectiles, particles, pickups and collision resolution.

import { MODELS, drawModel, drawPoint } from './sprites.js';
import { rgb, wrap, wdelta, rand, pick, dist3, TAU } from './util.js';

const C = {
  bullet: rgb(255, 230, 120), ebullet: rgb(255, 90, 60), shell: rgb(255, 160, 60),
  rocket: rgb(240, 240, 240), sam: rgb(255, 255, 255), flare: rgb(255, 250, 200),
  fire: [rgb(255, 220, 90), rgb(255, 150, 40), rgb(230, 80, 20)],
  smoke: [rgb(70, 70, 70), rgb(100, 100, 100), rgb(130, 128, 120)],
  dust: rgb(160, 140, 110),
};

export class World {
  constructor(game) {
    this.g = game;
    this.projectiles = [];
    this.particles = [];
    this.pickups = [];
  }

  clear() { this.projectiles.length = 0; this.particles.length = 0; this.pickups.length = 0; }

  addProjectile(p) {
    p.trail = 0;
    if (p.speed === undefined) p.speed = Math.hypot(p.vx, p.vy, p.vh);
    this.projectiles.push(p);
  }

  particle(x, y, h, vx, vy, vh, life, size, col, opts = {}) {
    if (this.particles.length > 2500) return;
    this.particles.push({ x, y, h, vx, vy, vh, life, max: life, size, col,
      grow: opts.grow || 0, grav: opts.grav || 0, alpha: opts.alpha ?? 1 });
  }

  explosion(x, y, h, scale = 1) {
    const n = (30 * scale) | 0;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), e = rand(-0.3, 1.2), s = rand(10, 45) * scale;
      this.particle(x, y, h, Math.cos(a) * Math.cos(e) * s, Math.sin(a) * Math.cos(e) * s,
        Math.sin(e) * s, rand(0.3, 0.8), rand(0.8, 1.8) * scale, pick(C.fire), { grav: 10 });
    }
    for (let i = 0; i < n * 0.7; i++) {
      const a = rand(0, TAU), s = rand(3, 12) * scale;
      this.particle(x + rand(-3, 3), y + rand(-3, 3), h + rand(0, 4), Math.cos(a) * s, Math.sin(a) * s,
        rand(6, 16), rand(1.2, 2.6), rand(1.5, 3) * scale, pick(C.smoke), { grow: 2.2, alpha: 0.6 });
    }
    const d = dist3({ x, y, h }, this.g.player);
    this.g.audio.play(scale > 1.2 ? 'bigboom' : 'boom', d);
    if (d < 120) this.g.shake((1 - d / 120) * scale * 0.8);
  }

  muzzle(x, y, h) {
    for (let i = 0; i < 4; i++)
      this.particle(x, y, h, rand(-4, 4), rand(-4, 4), rand(0, 6), 0.3, 1.2, pick(C.smoke), { grow: 3, alpha: 0.5 });
  }

  dust(x, y, h) {
    for (let i = 0; i < 5; i++)
      this.particle(x, y, h, rand(-8, 8), rand(-8, 8), rand(2, 10), rand(0.4, 0.8), 0.9, C.dust, { grow: 2, alpha: 0.7, grav: 12 });
  }

  spawnPickup(x, y, type) {
    const T = this.g.terrain;
    this.pickups.push({ type, x, y, h: T.heightAt(x, y) + 10, t: rand(0, TAU), life: 40 });
  }

  update(dt) {
    const g = this.g, T = g.terrain, P = g.player;
    // --- projectiles ---
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.kind === 'rocket') {
        const sp = Math.hypot(p.vx, p.vy, p.vh);
        const ns = Math.min(p.maxSpeed, sp + p.accel * dt), k = ns / (sp || 1);
        p.vx *= k; p.vy *= k; p.vh *= k;
      } else if (p.kind === 'sam') this.steerMissile(p, dt);
      else if (p.kind === 'flare') { p.vh -= 12 * dt; p.vx *= 0.98; p.vy *= 0.98; }
      else if (p.kind === 'shell') p.vh -= 18 * dt;

      p.x = wrap(p.x + p.vx * dt); p.y = wrap(p.y + p.vy * dt); p.h += p.vh * dt;

      // smoke trails
      if (p.kind === 'rocket' || p.kind === 'sam' || p.kind === 'flare') {
        p.trail -= dt;
        if (p.trail <= 0) {
          p.trail = 0.025;
          const smoke = p.kind === 'flare' ? rgb(255, 200, 120) : rgb(200, 200, 200);
          this.particle(p.x, p.y, p.h, rand(-1, 1), rand(-1, 1), rand(0, 2), p.kind === 'flare' ? 0.4 : 1.1,
            0.8, smoke, { grow: 2.5, alpha: 0.55 });
        }
      }

      let hit = p.life <= 0;
      const ground = T.heightAt(p.x, p.y);
      if (!hit && p.h <= ground) {
        hit = true;
        if (p.kind === 'bullet' || p.kind === 'ebullet') this.dust(p.x, p.y, ground);
      }
      if (!hit && p.owner === 'player' && p.kind !== 'flare') {
        for (const e of g.enemies) {
          if (e.dead) continue;
          if (dist3(p, e) < e.radius + (p.kind === 'rocket' ? 2 : 0.5)) {
            e.damage(p.damage, g); hit = true;
            if (p.kind === 'bullet') this.particle(p.x, p.y, p.h, 0, 0, 3, 0.15, 1, C.bullet);
            break;
          }
        }
      }
      if (!hit && p.owner === 'enemy' && !P.dead) {
        const r = p.kind === 'sam' ? 7 : p.kind === 'shell' ? 5 : 4;
        if (dist3(p, P) < r) { P.damage(p.damage, g, p.kind); hit = true; }
      }
      if (hit) {
        if (p.kind === 'rocket' || p.kind === 'sam' || p.kind === 'shell') {
          this.explosion(p.x, p.y, Math.max(p.h, ground), p.kind === 'shell' ? 0.6 : 1);
          if (p.splash) this.splash(p);
        }
        this.projectiles.splice(i, 1);
      }
    }

    // --- particles ---
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) { this.particles.splice(i, 1); continue; }
      q.vh -= q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
      q.size += q.grow * dt;
      const d = Math.exp(-1.5 * dt); q.vx *= d; q.vy *= d;
    }

    // --- pickups ---
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.t += dt; k.life -= dt;
      if (k.life <= 0) { this.pickups.splice(i, 1); continue; }
      if (!P.dead && dist3(k, P) < 14) {
        if (k.type === 'repair') { P.hp = Math.min(P.maxHp, P.hp + 35); g.hud.toast('机体修复 +35'); }
        else { P.ammo = Math.min(800, P.ammo + 250); P.rockets = Math.min(36, P.rockets + 8); P.flares = Math.min(16, P.flares + 4); g.hud.toast('弹药补给'); }
        g.audio.play('pickup');
        this.pickups.splice(i, 1);
      }
    }
  }

  splash(p) {
    for (const e of this.g.enemies) {
      if (e.dead) continue;
      const d = dist3(p, e);
      if (d < p.splash) e.damage(p.damage * 0.6 * (1 - d / p.splash), this.g);
    }
  }

  // Proportional-ish homing. Flares nearby steal the lock.
  steerMissile(m, dt) {
    let target = m.target;
    for (const f of this.projectiles) {
      if (f.kind !== 'flare') continue;
      if (dist3(f, m) < 180 && Math.random() < dt * 3) { m.target = f; target = f; break; }
    }
    if (target && target.life !== undefined && target.life <= 0) m.target = target = null;
    m.speed = Math.min(m.maxSpeed, m.speed + 120 * dt);
    let vx = m.vx, vy = m.vy, vh = m.vh;
    if (target) {
      const dx = wdelta(target.x - m.x), dy = wdelta(target.y - m.y), dh = target.h - m.h;
      const l = Math.hypot(dx, dy, dh) || 1, cl = Math.hypot(vx, vy, vh) || 1;
      const k = Math.min(1, m.turn * dt);
      vx = vx / cl * (1 - k) + dx / l * k;
      vy = vy / cl * (1 - k) + dy / l * k;
      vh = vh / cl * (1 - k) + dh / l * k;
    }
    const l = Math.hypot(vx, vy, vh) || 1;
    m.vx = vx / l * m.speed; m.vy = vy / l * m.speed; m.vh = vh / l * m.speed;
  }

  draw(R) {
    for (const p of this.projectiles) {
      const col = C[p.kind] || C.bullet;
      const size = p.kind === 'sam' || p.kind === 'rocket' ? 0.9 : p.kind === 'flare' ? 1.1 : 0.45;
      drawPoint(R, p.x, p.y, p.h, size, col);
      if (p.kind === 'bullet' || p.kind === 'ebullet') // short tracer streak
        drawPoint(R, p.x - p.vx * 0.012, p.y - p.vy * 0.012, p.h - p.vh * 0.012, size * 0.8, col, 0.6);
    }
    for (const q of this.particles) {
      const a = q.alpha * Math.min(1, q.life / q.max * 2);
      drawPoint(R, q.x, q.y, q.h, q.size, q.col, a);
    }
    for (const k of this.pickups) {
      drawModel(R, MODELS[k.type], k.x, k.y, k.h + Math.sin(k.t * 2) * 2, k.t, 1);
    }
  }
}
