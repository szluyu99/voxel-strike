// Player helicopter: simple arcade flight model, weapons and damage.

import { wrap, clamp, damp, rand, TAU } from './util.js';
import { VSCALE } from './renderer.js';

export class Player {
  constructor() { this.reset(512, 512, 0); }

  reset(x, y, ground) {
    this.x = x; this.y = y; this.h = ground + 40;
    this.vx = 0; this.vy = 0; this.vh = 0;
    this.yaw = 0; this.yawRate = 0; this.pitch = 0; this.roll = 0;
    this.hp = 100; this.maxHp = 100;
    this.ammo = 500; this.rockets = 24; this.flares = 12;
    this.gunHeat = 0; this.gunCool = 0; this.rocketCool = 0; this.flareCool = 0;
    this.rocketSide = 1; this.hurt = 0; this.dead = false; this.invuln = 2;
    this.speed = 0; this.agl = 40;
  }

  update(dt, g) {
    const k = g.input, T = g.terrain;
    if (this.dead) return;
    // --- steering -----------------------------------------------------------
    const mouseYaw = k.mouseDX * 0.0025 * g.settings.sensitivity;
    this.yawRate = damp(this.yawRate, k.axis('turn') * 1.9 + mouseYaw / Math.max(dt, 1e-3), 10, dt);
    this.yaw = (this.yaw + k.axis('turn') * 1.9 * dt + mouseYaw) % TAU;
    this.pitch = clamp(this.pitch + (k.axis('look') * 0.9 * dt) -
      k.mouseDY * 0.0022 * g.settings.sensitivity * (g.settings.invertY ? -1 : 1), -0.55, 0.45);
    k.mouseDX = 0; k.mouseDY = 0;

    // --- thrust in local frame ---------------------------------------------
    const fwd = k.axis('throttle'), side = k.axis('strafe'), up = k.axis('lift');
    const boost = k.down('boost') ? 1.7 : 1;
    const fx = Math.sin(this.yaw), fy = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), ry = Math.sin(this.yaw);
    const acc = 95 * boost;
    this.vx += (fx * fwd + rx * side) * acc * dt;
    this.vy += (fy * fwd + ry * side) * acc * dt;
    this.vh += up * 70 * dt;
    // drag
    const drag = Math.exp(-1.15 * dt), vdrag = Math.exp(-2.5 * dt);
    this.vx *= drag; this.vy *= drag; this.vh *= vdrag;
    const maxV = 85 * boost, sp = Math.hypot(this.vx, this.vy);
    if (sp > maxV) { this.vx *= maxV / sp; this.vy *= maxV / sp; }
    this.speed = sp;

    this.x = wrap(this.x + this.vx * dt);
    this.y = wrap(this.y + this.vy * dt);
    this.h += this.vh * dt;

    // --- terrain & ceiling --------------------------------------------------
    const ground = T.heightAt(this.x, this.y);
    const ahead = T.heightAt(this.x + this.vx * 0.25, this.y + this.vy * 0.25);
    const floor = Math.max(ground, ahead) + 6;
    if (this.h < floor) {
      const impact = Math.max(-this.vh, 0) + sp * 0.3;
      if (impact > 38 && this.invuln <= 0) this.damage(impact * 0.35, g, 'crash');
      this.h = floor; if (this.vh < 0) this.vh = 0;
    }
    if (this.h > 340) { this.h = 340; if (this.vh > 0) this.vh = 0; }
    this.agl = this.h - ground;

    // visual banking from strafe + turn
    const localSide = this.vx * rx + this.vy * ry;
    this.roll = damp(this.roll, clamp(-localSide * 0.004 - this.yawRate * 0.12, -0.45, 0.45), 6, dt);

    // --- weapons ------------------------------------------------------------
    this.gunCool -= dt; this.rocketCool -= dt; this.flareCool -= dt;
    this.gunHeat = Math.max(0, this.gunHeat - dt * 0.35);
    if (k.down('fire') && this.gunCool <= 0 && this.ammo > 0 && this.gunHeat < 1) {
      this.fireGun(g); this.gunCool = 0.075; this.gunHeat += 0.03; this.ammo--;
    }
    if (k.down('rocket') && this.rocketCool <= 0 && this.rockets > 0) {
      this.fireRocket(g); this.rocketCool = 0.45; this.rockets--;
    }
    if (k.down('flare') && this.flareCool <= 0 && this.flares > 0) {
      this.dropFlares(g); this.flareCool = 1.2; this.flares--;
    }
    if (this.hurt > 0) this.hurt -= dt;
    if (this.invuln > 0) this.invuln -= dt;
  }

  // Unit vector along the crosshair (screen center) taking view pitch into account.
  aimDir(g) {
    const fx = Math.sin(this.yaw), fy = -Math.cos(this.yaw);
    // Screen center satisfies pitch*focal + (camH - h)*focal*VSCALE/z = 0,
    // so the aim line climbs pitch/VSCALE height units per unit of depth.
    const slope = this.pitch / VSCALE;
    const l = Math.hypot(1, slope);
    return { x: fx / l, y: fy / l, h: slope / l };
  }

  fireGun(g) {
    const d = this.aimDir(g), s = 420, j = 0.012;
    const rx = Math.cos(this.yaw), ry = Math.sin(this.yaw);
    const off = rand(-1, 1);
    g.world.addProjectile({ kind: 'bullet', owner: 'player',
      x: this.x + rx * off + d.x * 4, y: this.y + ry * off + d.y * 4, h: this.h - 2,
      vx: (d.x + rand(-j, j)) * s + this.vx, vy: (d.y + rand(-j, j)) * s + this.vy,
      vh: (d.h + rand(-j, j)) * s, life: 1.6, damage: 4 });
    g.audio.play('gun');
  }

  fireRocket(g) {
    const d = this.aimDir(g), s = 160;
    const rx = Math.cos(this.yaw), ry = Math.sin(this.yaw);
    this.rocketSide = -this.rocketSide;
    const o = this.rocketSide * 4;
    g.world.addProjectile({ kind: 'rocket', owner: 'player',
      x: this.x + rx * o, y: this.y + ry * o, h: this.h - 3,
      vx: d.x * s + this.vx, vy: d.y * s + this.vy, vh: d.h * s, accel: 260, maxSpeed: 330,
      life: 3.5, damage: 45, splash: 22 });
    g.audio.play('rocket');
  }

  dropFlares(g) {
    for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU);
      g.world.addProjectile({ kind: 'flare', owner: 'player', x: this.x, y: this.y, h: this.h - 3,
        vx: this.vx * 0.5 + Math.cos(a) * 25, vy: this.vy * 0.5 + Math.sin(a) * 25, vh: rand(-5, 15),
        life: 3.2, damage: 0 });
    }
    g.audio.play('flare');
  }

  damage(n, g, cause) {
    if (this.dead || this.invuln > 0) return;
    this.hp -= n; this.hurt = 0.35;
    g.audio.play('hit');
    g.shake(Math.min(1.2, n / 15));
    if (this.hp <= 0) { this.hp = 0; this.dead = true; g.onPlayerDead(cause); }
  }
}
