// ============================================================
// input.js — キーボード / マウス（ポインタロック）/ タッチ操作
// ============================================================

const KEY_ACTIONS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', KeyQ: 'left',
  KeyD: 'right', KeyE: 'right',
  ArrowLeft: 'turnLeft', ArrowRight: 'turnRight',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'fire',
  Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3',
  KeyM: 'map', Tab: 'map',
  Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm', KeyR: 'confirm',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.firing = false;
    this.sensitivity = 1;
    this.locked = false;
    this.freeLook = false;      // ポインタロックが使えない環境（iframe など）用
    this.touch = { move: { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0 }, lookId: null, lookX: 0, lookY: 0 };
    this.onLockChange = null;
    this.#bind();
  }

  #press(action) {
    if (!action) return;
    if (!this.down.has(action)) this.pressed.add(action);
    this.down.add(action);
  }

  #release(action) {
    if (!action) return;
    this.down.delete(action);
  }

  #bind() {
    window.addEventListener('keydown', (e) => {
      const a = KEY_ACTIONS[e.code];
      if (a) {
        if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
        this.#press(a);
      }
    });
    window.addEventListener('keyup', (e) => this.#release(KEY_ACTIONS[e.code]));
    window.addEventListener('blur', () => { this.down.clear(); this.firing = false; });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.firing = true; this.pressed.add('fire'); }
      if (e.button === 2) this.pressed.add('altfire');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.freeLook) return;
      this.mouseDX += (e.movementX || 0) * 0.0022 * this.sensitivity;
      this.mouseDY += (e.movementY || 0) * 0.0018 * this.sensitivity;
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.pressed.add(e.deltaY > 0 ? 'nextWeapon' : 'prevWeapon');
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    // ロックを拒否された場合はカーソルを出したまま視点移動できるようにする
    document.addEventListener('pointerlockerror', () => this.#enableFreeLook());

    // ── タッチ（左半分＝移動スティック / 右半分＝視点）──────
    const rect = () => this.canvas.getBoundingClientRect();
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const r = rect();
        const x = t.clientX - r.left;
        if (x < r.width * 0.45 && !this.touch.move.active) {
          this.touch.move = { x: 0, y: 0, active: true, id: t.identifier, ox: t.clientX, oy: t.clientY };
        } else if (this.touch.lookId === null) {
          this.touch.lookId = t.identifier;
          this.touch.lookX = t.clientX;
          this.touch.lookY = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move.id) {
          const dx = t.clientX - this.touch.move.ox;
          const dy = t.clientY - this.touch.move.oy;
          const max = 56;
          const len = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, len / max) / len;
          this.touch.move.x = dx * k;
          this.touch.move.y = dy * k;
        } else if (t.identifier === this.touch.lookId) {
          this.mouseDX += (t.clientX - this.touch.lookX) * 0.006 * this.sensitivity;
          this.mouseDY += (t.clientY - this.touch.lookY) * 0.004 * this.sensitivity;
          this.touch.lookX = t.clientX;
          this.touch.lookY = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move.id) this.touch.move = { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0 };
        if (t.identifier === this.touch.lookId) this.touch.lookId = null;
      }
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  }

  /** 画面上のボタン（スマホ用）から呼ぶ */
  bindButton(el, action, { hold = false } = {}) {
    if (!el) return;
    const start = (e) => {
      e.preventDefault();
      if (hold) this.down.add(action);
      this.pressed.add(action);
      if (action === 'fire' && hold) this.firing = true;
    };
    const end = (e) => {
      e.preventDefault();
      if (hold) this.down.delete(action);
      if (action === 'fire' && hold) this.firing = false;
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', end);
    el.addEventListener('mouseleave', end);
  }

  #enableFreeLook() {
    if (this.freeLook) return;
    this.freeLook = true;
    this.locked = false;
    if (this.onFreeLook) this.onFreeLook();
  }

  requestLock() {
    if (this.freeLook || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => this.#enableFreeLook());
    } catch {
      this.#enableFreeLook();
    }
  }

  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  isDown(action) { return this.down.has(action); }
  consumePressed(action) {
    if (this.pressed.has(action)) { this.pressed.delete(action); return true; }
    return false;
  }
  endFrame() { this.pressed.clear(); }

  /** 移動入力を -1..1 で返す（キーボードとタッチを合成）*/
  moveAxis() {
    let x = 0;
    let y = 0;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('left')) x -= 1;
    if (this.touch.move.active) {
      x += this.touch.move.x / 56;
      y += -this.touch.move.y / 56;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /** 視点移動量を取り出してリセットする */
  takeLook() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }
}
