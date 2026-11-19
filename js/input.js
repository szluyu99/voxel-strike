// Keyboard + mouse (pointer lock) + touch input, exposed as named actions/axes.

const BINDS = {
  throttle: [['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']],
  strafe: [['KeyD'], ['KeyA']],
  turn: [['ArrowRight', 'KeyE'], ['ArrowLeft', 'KeyQ']],
  lift: [['Space', 'KeyR'], ['ShiftLeft', 'KeyF', 'ControlLeft']],
  look: [['PageUp', 'KeyT'], ['PageDown', 'KeyG']],
};
const ACTIONS = {
  boost: ['KeyB', 'ShiftRight'],
  fire: ['KeyJ', 'Enter'],
  rocket: ['KeyK'],
  flare: ['KeyX'],
};

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.mouseDX = 0; this.mouseDY = 0;
    this.locked = false;
    this.touch = { throttle: 0, strafe: 0, turn: 0, lift: 0, fire: false, rocket: false, flare: false };
    this.pressed = new Set(); // edge-triggered presses for menus
    this.canvas = canvas;

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  lock() {
    if (this.locked || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // headless / iframes may refuse; keyboard still works
    } catch { /* ignore */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  axis(name) {
    const [pos, neg] = BINDS[name];
    let v = 0;
    if (pos.some((k) => this.keys.has(k))) v += 1;
    if (neg.some((k) => this.keys.has(k))) v -= 1;
    if (this.touch[name]) v += this.touch[name];
    return Math.max(-1, Math.min(1, v));
  }

  down(name) {
    if (name === 'fire' && (this.mouse.left || this.touch.fire)) return true;
    if (name === 'rocket' && (this.mouse.right || this.touch.rocket)) return true;
    if (name === 'flare' && this.touch.flare) return true;
    return (ACTIONS[name] || []).some((k) => this.keys.has(k));
  }

  wasPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }

  // On-screen joysticks / buttons for touch devices.
  bindTouch(root) {
    const stick = (el, ax, ay) => {
      let id = null, cx = 0, cy = 0;
      const knob = el.querySelector('.knob');
      el.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0]; id = t.identifier;
        const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        e.preventDefault();
      }, { passive: false });
      el.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== id) continue;
          const r = el.getBoundingClientRect().width / 2;
          let dx = (t.clientX - cx) / r, dy = (t.clientY - cy) / r;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.touch[ax] = dx; this.touch[ay] = -dy;
          knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
        }
        e.preventDefault();
      }, { passive: false });
      const end = () => { id = null; this.touch[ax] = 0; this.touch[ay] = 0; knob.style.transform = ''; };
      el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    };
    stick(root.querySelector('#stickL'), 'strafe', 'throttle');
    stick(root.querySelector('#stickR'), 'turn', 'lift');
    for (const b of root.querySelectorAll('[data-btn]')) {
      const name = b.dataset.btn;
      b.addEventListener('touchstart', (e) => { this.touch[name] = true; e.preventDefault(); }, { passive: false });
      b.addEventListener('touchend', () => { this.touch[name] = false; });
    }
  }
}
