// Voxel Strike: game state, waves, menus and main loop.

import { Terrain, MAPS } from './terrain.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';
import { World } from './world.js';
import { Tank, SamSite, Helicopter } from './enemies.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { rgb, rand, wrap, wdelta, clamp, TAU } from './util.js';

const QUALITY = {
  low: { scale: 0.33, distance: 650, detail: 1.4 },
  medium: { scale: 0.5, distance: 950, detail: 1.1 },
  high: { scale: 0.75, distance: 1300, detail: 1 },
};
const DIFF = { easy: 0, normal: 1, hard: 2 };
const $ = (s) => document.querySelector(s);

function loadSettings() {
  const def = { map: 0, quality: 'medium', difficulty: 'normal', sensitivity: 1, invertY: false, volume: 0.6 };
  try { return { ...def, ...JSON.parse(localStorage.getItem('voxelstrike.settings') || '{}') }; }
  catch { return def; }
}

// Sky palette by map mood.
function skyFor(name) {
  if (name.includes('夜')) return [rgb(8, 10, 28), rgb(70, 40, 50)];
  if (name.includes('黄昏')) return [rgb(60, 50, 110), rgb(240, 150, 90)];
  if (/雪|冰|冻/.test(name)) return [rgb(90, 120, 170), rgb(220, 228, 238)];
  if (/沙|戈壁|荒/.test(name)) return [rgb(70, 110, 170), rgb(225, 205, 170)];
  return [rgb(48, 92, 170), rgb(192, 210, 228)];
}

class Game {
  constructor() {
    this.view = $('#view');
    this.hudCanvas = $('#hud');
    this.settings = loadSettings();
    this.terrain = new Terrain();
    this.renderer = new Renderer(this.view);
    this.player = new Player();
    this.world = new World(this);
    this.input = new Input(this.view);
    this.audio = new Audio();
    this.hud = new Hud(this.hudCanvas);
    this.enemies = [];
    this.playing = false; this.paused = false; this.over = false;
    this.time = 0; this.score = 0; this.wave = 0; this.combo = 0; this.comboT = 0;
    this.kills = 0; this.waveDelay = 0; this.deadT = 0; this.shakeAmt = 0;
    this.highScore = +(localStorage.getItem('voxelstrike.high') || 0);
    this.loadedMap = -1;
    this.fps = 0; this.fpsAcc = 0; this.fpsN = 0;

    this.buildMenu();
    this.applySettings();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.input.bindTouch(document.body);
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.playing && !this.player.dead) this.pause(true);
    });
    this.view.addEventListener('click', () => { if (this.playing && !this.paused) this.input.lock(); });

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    this.loadMap(this.settings.map);
  }

  // ---------------------------------------------------------------- menus
  buildMenu() {
    const sel = $('#mapSelect');
    MAPS.forEach(([c, d, name], i) => {
      const o = document.createElement('option'); o.value = i; o.textContent = `${i + 1}. ${name}`;
      sel.appendChild(o);
    });
    const s = this.settings;
    sel.value = s.map;
    $('#quality').value = s.quality; $('#difficulty').value = s.difficulty;
    $('#sens').value = s.sensitivity; $('#invertY').checked = s.invertY; $('#volume').value = s.volume;
    sel.onchange = () => { s.map = +sel.value; this.saveSettings(); this.loadMap(s.map); };
    $('#quality').onchange = (e) => { s.quality = e.target.value; this.saveSettings(); this.applySettings(); };
    $('#difficulty').onchange = (e) => { s.difficulty = e.target.value; this.saveSettings(); };
    $('#sens').oninput = (e) => { s.sensitivity = +e.target.value; this.saveSettings(); };
    $('#invertY').onchange = (e) => { s.invertY = e.target.checked; this.saveSettings(); };
    $('#volume').oninput = (e) => { s.volume = +e.target.value; this.audio.setVolume(s.volume); this.saveSettings(); };
    $('#startBtn').onclick = () => this.start();
    $('#resumeBtn').onclick = () => this.pause(false);
    $('#quitBtn').onclick = () => this.toMenu();
    $('#againBtn').onclick = () => this.start();
    $('#menuBtn').onclick = () => this.toMenu();
    $('#randomMap').onclick = () => { sel.value = (Math.random() * MAPS.length) | 0; sel.onchange(); };
    $('#highScore').textContent = this.highScore;
  }

  saveSettings() { localStorage.setItem('voxelstrike.settings', JSON.stringify(this.settings)); }

  applySettings() {
    const q = QUALITY[this.settings.quality] || QUALITY.medium;
    this.renderer.setDistance(q.distance);
    this.renderer.setDetail(q.detail);
    this.audio.setVolume(this.settings.volume);
    this.resize();
  }

  show(id) {
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== id);
  }

  resize() {
    const W = innerWidth, H = innerHeight, q = QUALITY[this.settings.quality] || QUALITY.medium;
    this.renderer.resize(Math.round(W * q.scale), Math.round(H * q.scale));
    this.hud.resize(W, H, Math.min(2, devicePixelRatio || 1));
  }

  async loadMap(i) {
    i = clamp(i | 0, 0, MAPS.length - 1);
    const [c, d, name] = MAPS[i];
    $('#loading').classList.remove('hidden');
    try {
      await this.terrain.load(c, d);
      this.loadedMap = i;
      this.renderer.setSky(...skyFor(name));
      $('#mapName').textContent = name;
      // menu fly-by camera
      this.player.reset(rand(0, 1024), rand(0, 1024), 0);
      this.player.h = this.terrain.maxHeightAround(this.player.x, this.player.y, 40) + 60;
    } catch (e) {
      $('#error').textContent = e.message;
    }
    $('#loading').classList.add('hidden');
  }

  async start() {
    this.audio.init();
    if (this.loadedMap !== this.settings.map) await this.loadMap(this.settings.map);
    this.world.clear();
    this.enemies = [];
    const p = this.player;
    const s = this.findSpawn();
    p.reset(s.x, s.y, this.terrain.heightAt(s.x, s.y));
    p.yaw = rand(0, TAU);
    this.score = 0; this.wave = 0; this.combo = 0; this.kills = 0;
    this.time = 0; this.deadT = 0; this.over = false;
    this.playing = true; this.paused = false;
    this.diff = DIFF[this.settings.difficulty] ?? 1;
    this.show(null);
    this.input.lock();
    this.waveDelay = 1.5;
    this.hud.showBanner(MAPS[this.loadedMap][2], '摧毁所有敌方单位 · 低空飞行可躲避防空雷达', 3);
  }

  pause(on) {
    if (!this.playing || this.over) return;
    this.paused = on;
    if (on) { this.show('pause'); this.input.unlock(); }
    else { this.show(null); this.input.lock(); this.last = performance.now(); }
  }

  toMenu() {
    this.playing = false; this.paused = false; this.over = false;
    this.input.unlock();
    this.world.clear(); this.enemies = [];
    $('#highScore').textContent = this.highScore;
    this.show('menu');
  }

  // ---------------------------------------------------------------- spawning
  isWater(x, y) {
    const c = this.terrain.colorAt(x, y);
    const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
    return b > r + 25 && b > g;
  }

  findSpawn() {
    // Prefer a low-ish valley so the start is not inside a mountain.
    let best = null;
    for (let i = 0; i < 40; i++) {
      const x = rand(0, 1024), y = rand(0, 1024), h = this.terrain.maxHeightAround(x, y, 20);
      if (!best || h < best.h) best = { x, y, h };
    }
    return best;
  }

  spawnPoint(minR, maxR, ground) {
    const P = this.player;
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU), r = rand(minR, maxR);
      const x = wrap(P.x + Math.cos(a) * r), y = wrap(P.y + Math.sin(a) * r);
      if (!ground) return { x, y };
      if (!this.isWater(x, y) && this.terrain.slopeAt(x, y) < 3) return { x, y };
    }
    return { x: wrap(P.x + rand(-maxR, maxR)), y: wrap(P.y + rand(-maxR, maxR)) };
  }

  nextWave() {
    this.wave++;
    const w = this.wave, d = this.diff;
    const tanks = Math.min(14, 2 + w + d);
    const sams = Math.min(6, Math.floor((w + d) / 2));
    const helis = Math.min(6, Math.max(0, Math.floor((w - 2 + d) / 2)));
    // tanks come in platoons around a few centers
    for (let i = 0; i < tanks; i++) {
      const c = this.spawnPoint(220, 520, true);
      this.enemies.push(new Tank(c.x + rand(-25, 25), c.y + rand(-25, 25), d + w * 0.25));
    }
    for (let i = 0; i < sams; i++) {
      const c = this.spawnPoint(300, 600, true);
      this.enemies.push(new SamSite(c.x, c.y, d + w * 0.2));
    }
    for (let i = 0; i < helis; i++) {
      const c = this.spawnPoint(350, 550, false);
      const e = new Helicopter(c.x, c.y, d + w * 0.2);
      e.h = this.terrain.maxHeightAround(c.x, c.y, 10) + 50;
      this.enemies.push(e);
    }
    for (const e of this.enemies) if (e.kind !== 'heli') e.h = this.terrain.heightAt(e.x, e.y);
    const parts = [`坦克 ${tanks}`];
    if (sams) parts.push(`防空导弹 ${sams}`);
    if (helis) parts.push(`直升机 ${helis}`);
    this.hud.showBanner(`第 ${w} 波`, parts.join(' · '), 2.8);
    this.audio.play('wave');
  }

  // ---------------------------------------------------------------- callbacks
  shake(n) { this.shakeAmt = Math.min(1.5, Math.max(this.shakeAmt, n)); }

  onEnemyKilled(e) {
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 4;
    const pts = e.score * (1 + (this.combo - 1) * 0.25) | 0;
    this.score += pts; this.kills++;
    this.world.explosion(e.x, e.y, e.h + 3, e.kind === 'heli' ? 1.4 : 1.6);
    this.hud.toast(`击毁${{ tank: '坦克', sam: '防空导弹', heli: '直升机' }[e.kind]} +${pts}`);
    const P = this.player;
    if (Math.random() < (P.hp < 50 ? 0.35 : 0.2)) {
      const type = P.hp < 60 && Math.random() < 0.65 ? 'repair'
        : P.rockets < 8 || P.ammo < 150 ? 'ammo' : Math.random() < 0.5 ? 'repair' : 'ammo';
      this.world.spawnPickup(e.x, e.y, type);
    }
  }

  onPlayerDead(cause) {
    this.world.explosion(this.player.x, this.player.y, this.player.h, 2);
    this.deadT = 2.8;
    this.deathCause = { crash: '坠毁', sam: '被防空导弹击落', shell: '被坦克炮击落', ebullet: '被敌机击落' }[cause] || '被击落';
  }

  gameOver() {
    this.over = true;
    this.input.unlock();
    const best = this.score > this.highScore;
    if (best) { this.highScore = this.score; localStorage.setItem('voxelstrike.high', String(this.score)); }
    $('#goTitle').textContent = this.deathCause || '任务失败';
    $('#goStats').innerHTML =
      `分数 <b>${this.score}</b>${best ? ' · <span class="new">新纪录！</span>' : ''}<br>` +
      `到达第 ${this.wave} 波 · 击毁 ${this.kills} 个目标 · 存活 ${Math.floor(this.time)} 秒`;
    this.show('gameover');
  }

  // ---------------------------------------------------------------- loop
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }

    const k = this.input;
    if (this.playing && !this.over && (k.wasPressed('Escape') || k.wasPressed('KeyP'))) {
      // Escape exits pointer lock (and the lock handler pauses); P toggles directly.
      if (k.wasPressed('KeyP') || !this.paused) this.pause(!this.paused);
    }
    if (!this.playing && k.wasPressed('Enter') && !$('#menu').classList.contains('hidden')) this.start();

    if (this.playing && !this.paused && !this.over) this.update(dt);
    else if (!this.playing) this.attract(dt);
    this.audio.setRotor(this.playing && !this.paused && !this.player.dead ? 0.6 + Math.abs(k.axis('lift')) * 0.4 : 0,
      this.player.speed);

    this.draw(dt);
    k.endFrame();
  }

  attract(dt) {
    // slow cinematic fly-over behind the menu
    const p = this.player;
    p.yaw += dt * 0.05;
    p.x = wrap(p.x + Math.sin(p.yaw) * 30 * dt); p.y = wrap(p.y - Math.cos(p.yaw) * 30 * dt);
    const want = this.terrain.maxHeightAround(p.x + Math.sin(p.yaw) * 60, p.y - Math.cos(p.yaw) * 60, 30) + 55;
    p.h += (want - p.h) * Math.min(1, dt * 0.8);
    p.pitch = -0.18; p.roll = Math.sin(this.time * 0.3) * 0.05;
    this.time += dt;
  }

  update(dt) {
    this.time += dt;
    this.player.update(dt, this);
    for (const e of this.enemies) if (!e.dead) e.update(dt, this);
    this.world.update(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.hud.update(dt);
    if (this.comboT > 0 && (this.comboT -= dt) <= 0) this.combo = 0;

    if (this.player.dead) {
      this.player.h -= 20 * dt; this.player.roll += dt * 2;
      if ((this.deadT -= dt) <= 0) this.gameOver();
      return;
    }
    if (this.enemies.length === 0) {
      if (this.waveDelay <= 0) {
        this.waveDelay = 3.5;
        if (this.wave > 0) {
          const bonus = 500 * this.wave;
          this.score += bonus;
          const P = this.player;
          P.ammo = Math.min(800, P.ammo + 200); P.rockets = Math.min(36, P.rockets + 6);
          P.flares = Math.min(16, P.flares + 3); P.hp = Math.min(P.maxHp, P.hp + 20);
          this.hud.showBanner('区域肃清', `奖励 +${bonus} · 补给已送达`, 3);
        }
      }
      if ((this.waveDelay -= dt) <= 0) this.nextWave();
    } else this.waveDelay = 0;
  }

  draw(dt) {
    const R = this.renderer, P = this.player, cam = R.cam;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const s = this.shakeAmt;
    cam.x = P.x; cam.y = P.y; cam.h = P.h + rand(-s, s) * 1.5;
    cam.yaw = P.yaw + rand(-s, s) * 0.01;
    cam.pitch = P.pitch + rand(-s, s) * 0.02;
    cam.roll = P.roll;
    R.render(this.terrain);
    for (const e of this.enemies) e.draw(R, this);
    this.world.draw(R);
    R.present();
    this.hud.draw(this);
    if (this.settings.showFps !== false) {
      const c = this.hud.ctx;
      c.textAlign = 'left'; c.font = '11px ui-monospace, monospace'; c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fillText(`${this.fps} fps · ${R.w}×${R.h}`, 8, innerHeight - 10);
    }
  }
}

window.game = new Game();

// ?debug logs game state every 2 s; ?autoplay also starts a game and holds
// throttle + fire with a slow turn, for automated smoke tests.
const params = new URLSearchParams(location.search);
if (params.has('debug') || params.has('autoplay')) {
  const g = window.game;
  setInterval(() => {
    const p = g.player;
    console.log('[state] ' + JSON.stringify({
      fps: g.fps, res: `${g.renderer.w}x${g.renderer.h}`, playing: g.playing, wave: g.wave,
      score: g.score, enemies: g.enemies.length, hp: Math.round(p.hp), ammo: p.ammo, rockets: p.rockets,
      pos: [p.x | 0, p.y | 0, p.h | 0], agl: p.agl | 0, proj: g.world.projectiles.length,
      particles: g.world.particles.length, dead: p.dead, over: g.over, auto: g.autoDbg,
    }));
  }, 2000);
  if (params.has('autoplay')) {
    const wait = setInterval(() => {
      if (g.loadedMap < 0) return;
      clearInterval(wait);
      g.start().then(() => {
        g.input.keys.add('KeyJ');
        // crude aimbot: face the nearest enemy and pitch the crosshair onto it
        const aim = () => {
          requestAnimationFrame(aim);
          const p = g.player;
          let best = null, bd = 1e9;
          for (const e of g.enemies) {
            const d = Math.hypot(wdelta(e.x - p.x), wdelta(e.y - p.y));
            if (d < bd) { bd = d; best = e; }
          }
          if (!best) return;
          const dx = wdelta(best.x - p.x), dy = wdelta(best.y - p.y);
          p.yaw = Math.atan2(dx, -dy);
          p.pitch = clamp(0.75 * (best.h + 2 - p.h) / Math.max(bd, 1), -0.55, 0.45);
          if (bd > 120) g.input.keys.add('KeyW'); else g.input.keys.delete('KeyW');
          // climb when terrain blocks the line of fire, otherwise hold altitude
          const occluded = g.terrain.blocked({ x: p.x, y: p.y, h: p.h }, { x: best.x, y: best.y, h: best.h + 2 });
          if (occluded || p.agl < 25) g.input.keys.add('Space'); else g.input.keys.delete('Space');
          g.autoDbg = { near: bd | 0, kind: best.kind, occluded };
        };
        aim();
        setInterval(() => { // fire rockets periodically
          g.input.keys.add('KeyK'); setTimeout(() => g.input.keys.delete('KeyK'), 100);
        }, 1500);
      });
    }, 100);
  }
}
