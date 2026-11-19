// Enemy units. Every enemy exposes update(dt, g), draw(R, g) and the fields
// x, y, h, hp, maxHp, radius, score, kind, dead.

import { MODELS, drawModel, drawRotor } from './sprites.js';
import { rgb, wrap, wdelta, angleDiff, approach, rand, dist3, TAU } from './util.js';

const ROTOR = rgb(30, 30, 30);

class Enemy {
  constructor(kind, x, y, hp, radius, score) {
    this.kind = kind; this.x = wrap(x); this.y = wrap(y); this.h = 0;
    this.hp = hp; this.maxHp = hp; this.radius = radius; this.score = score;
    this.yaw = rand(0, TAU); this.flash = 0; this.dead = false; this.screen = null;
  }
  damage(n, g) {
    if (this.dead) return;
    this.hp -= n; this.flash = 0.12;
    if (this.hp <= 0) { this.dead = true; g.onEnemyKilled(this); }
  }
  // Direction and distance to the player, honoring wrap-around.
  toPlayer(g) {
    const p = g.player;
    const dx = wdelta(p.x - this.x), dy = wdelta(p.y - this.y), dh = p.h - this.h;
    return { dx, dy, dh, d: Math.hypot(dx, dy, dh), d2: Math.hypot(dx, dy) };
  }
  canSee(g, eyeH = 4) {
    return !g.terrain.blocked({ x: this.x, y: this.y, h: this.h + eyeH },
      { x: this.x + wdelta(g.player.x - this.x), y: this.y + wdelta(g.player.y - this.y), h: g.player.h });
  }
  // Fire a straight projectile at the player with simple lead.
  fireAt(g, speed, damage, kind, spread = 0, mh = 4) {
    const p = g.player;
    const sx = this.x, sy = this.y, sh = this.h + mh;
    let dx = wdelta(p.x - sx), dy = wdelta(p.y - sy), dh = p.h - sh;
    const t = Math.hypot(dx, dy, dh) / speed;
    dx += p.vx * t * 0.8; dy += p.vy * t * 0.8; dh += p.vh * t * 0.8;
    dx += rand(-spread, spread) * t * speed; dy += rand(-spread, spread) * t * speed;
    const l = Math.hypot(dx, dy, dh) || 1;
    g.world.addProjectile({ kind, owner: 'enemy', x: sx, y: sy, h: sh,
      vx: dx / l * speed, vy: dy / l * speed, vh: dh / l * speed, life: 4, damage });
  }
}

export class Tank extends Enemy {
  constructor(x, y, diff) {
    super('tank', x, y, 60, 7, 100);
    this.turret = this.yaw; this.cool = rand(1.5, 4); this.diff = diff;
    this.wp = null; this.speed = rand(6, 10);
  }
  update(dt, g) {
    const T = g.terrain;
    if (!this.wp || Math.hypot(wdelta(this.wp.x - this.x), wdelta(this.wp.y - this.y)) < 6) {
      const a = rand(0, TAU), r = rand(40, 140);
      this.wp = { x: this.x + Math.cos(a) * r, y: this.y + Math.sin(a) * r };
    }
    const want = Math.atan2(wdelta(this.wp.x - this.x), -wdelta(this.wp.y - this.y));
    this.yaw += approach(0, angleDiff(this.yaw, want), 1.2 * dt);
    const nx = this.x + Math.sin(this.yaw) * this.speed * dt;
    const ny = this.y - Math.cos(this.yaw) * this.speed * dt;
    if (Math.abs(T.heightAt(nx, ny) - T.heightAt(this.x, this.y)) < 0.8) {
      this.x = wrap(nx); this.y = wrap(ny);
    } else this.wp = null;
    this.h = T.heightAt(this.x, this.y);

    const v = this.toPlayer(g);
    const aim = Math.atan2(v.dx, -v.dy);
    this.turret += approach(0, angleDiff(this.turret, aim), 1.5 * dt);
    this.cool -= dt;
    if (this.cool <= 0 && v.d < 460 && Math.abs(angleDiff(this.turret, aim)) < 0.15) {
      if (this.canSee(g)) {
        this.fireAt(g, 220, 8 + 2 * this.diff, 'shell', 0.02);
        g.world.muzzle(this.x + Math.sin(this.turret) * 9, this.y - Math.cos(this.turret) * 9, this.h + 5);
        g.audio.play('shell', v.d);
      }
      this.cool = rand(2.6, 4.2) / (1 + this.diff * 0.12);
    }
    if (this.flash > 0) this.flash -= dt;
  }
  draw(R) {
    this.screen = drawModel(R, MODELS.tank, this.x, this.y, this.h, this.yaw, 1, { flash: this.flash });
    drawModel(R, MODELS.tankGun, this.x, this.y, this.h, this.turret, 1, { flash: this.flash });
  }
}

export class SamSite extends Enemy {
  constructor(x, y, diff) {
    super('sam', x, y, 80, 7, 150);
    this.cool = rand(3, 6); this.diff = diff;
  }
  update(dt, g) {
    this.h = g.terrain.heightAt(this.x, this.y);
    const v = this.toPlayer(g);
    this.yaw = Math.atan2(v.dx, -v.dy);
    this.cool -= dt;
    // Radar cannot see a helicopter hugging the ground: fly low to stay safe.
    const agl = g.player.h - g.terrain.heightAt(g.player.x, g.player.y);
    this.tracking = v.d < 680 && agl > 18 && this.canSee(g, 10);
    if (this.cool <= 0 && this.tracking) {
      g.world.addProjectile({ kind: 'sam', owner: 'enemy', x: this.x, y: this.y, h: this.h + 10,
        vx: 0, vy: 0, vh: 50, speed: 50, maxSpeed: 135 + this.diff * 6, turn: 1.4 + this.diff * 0.06,
        target: g.player, life: 7.5, damage: 22 });
      g.audio.play('launch', v.d);
      g.hud.warn('导弹来袭！按 X 释放干扰弹');
      this.cool = rand(6.5, 9) / (1 + this.diff * 0.1);
    }
    if (this.flash > 0) this.flash -= dt;
  }
  draw(R) {
    this.screen = drawModel(R, MODELS.sam, this.x, this.y, this.h, this.yaw, 1, { flash: this.flash });
  }
}

export class Helicopter extends Enemy {
  constructor(x, y, diff) {
    super('heli', x, y, 50, 8, 200);
    this.diff = diff; this.orbit = rand(0, TAU); this.dir = Math.random() < 0.5 ? 1 : -1;
    this.radius0 = rand(140, 220); this.cool = rand(2, 4); this.burst = 0; this.burstT = 0;
    this.rotor = 0; this.vx = 0; this.vy = 0; this.alt = rand(30, 55);
  }
  update(dt, g) {
    const T = g.terrain, p = g.player;
    this.orbit += this.dir * dt * 0.35;
    const tx = p.x + Math.cos(this.orbit) * this.radius0, ty = p.y + Math.sin(this.orbit) * this.radius0;
    const dx = wdelta(tx - this.x), dy = wdelta(ty - this.y), l = Math.hypot(dx, dy) || 1;
    const sp = Math.min(48 + this.diff * 2, l * 0.8);
    this.vx += (dx / l * sp - this.vx) * Math.min(1, dt * 1.5);
    this.vy += (dy / l * sp - this.vy) * Math.min(1, dt * 1.5);
    this.x = wrap(this.x + this.vx * dt); this.y = wrap(this.y + this.vy * dt);
    const ground = T.maxHeightAround(this.x, this.y, 12);
    const wantH = Math.max(ground + this.alt, Math.min(p.h, ground + 120));
    this.h += (wantH - this.h) * Math.min(1, dt * 1.2);
    if (this.h < ground + 8) this.h = ground + 8;

    const v = this.toPlayer(g);
    this.yaw += approach(0, angleDiff(this.yaw, Math.atan2(v.dx, -v.dy)), 2 * dt);
    this.rotor += dt * 30;
    this.cool -= dt;
    if (this.cool <= 0 && v.d < 420 && this.canSee(g, 0)) { this.burst = 5 + this.diff; this.cool = rand(3, 5); }
    if (this.burst > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.fireAt(g, 320, 3 + this.diff * 0.5, 'ebullet', 0.03, 0);
        g.audio.play('egun', v.d);
        this.burst--; this.burstT = 0.11;
      }
    }
    if (this.flash > 0) this.flash -= dt;
  }
  draw(R) {
    this.screen = drawModel(R, MODELS.heli, this.x, this.y, this.h, this.yaw, 1, { flash: this.flash });
    drawRotor(R, this.x, this.y, this.h + 3, this.rotor, 11, ROTOR);
  }
}

export function enemyDistance(e, p) { return dist3(e, p); }
