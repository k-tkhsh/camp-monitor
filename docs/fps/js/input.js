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
    this.touchUsed = false;
    this.touch = {
      // スティック（画面左側）: 位置は HUD で描くためキャンバス座標でも持つ
      move: { active: false, id: null, ox: 0, oy: 0, bx: 0, by: 0, cx: 0, cy: 0, x: 0, y: 0, mag: 0, radius: 60 },
      // 視点（画面右側）: 短いタップは射撃として扱う
      look: { id: null, x: 0, y: 0, startTime: 0, travel: 0 },
    };
    this.onLockChange = null;
    this.onFirstTouch = null;
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

    // ── タッチ（左半分＝移動スティック / 右半分＝視点・タップで射撃）──
    const canvasPoint = (t) => {
      const r = this.canvas.getBoundingClientRect();
      const scale = this.canvas.width / (r.width || 1);
      return { x: (t.clientX - r.left) * scale, y: (t.clientY - r.top) * scale, rect: r };
    };

    this.canvas.addEventListener('touchstart', (e) => {
      if (!this.touchUsed) {
        this.touchUsed = true;
        if (this.onFirstTouch) this.onFirstTouch();
      }
      for (const t of e.changedTouches) {
        const p = canvasPoint(t);
        const leftSide = t.clientX - p.rect.left < p.rect.width * 0.45;
        if (leftSide && !this.touch.move.active) {
          const radius = Math.max(44, Math.min(p.rect.width, p.rect.height) * 0.14);
          this.touch.move = {
            active: true, id: t.identifier,
            ox: t.clientX, oy: t.clientY,
            bx: p.x, by: p.y, cx: p.x, cy: p.y, x: 0, y: 0, mag: 0,
            radius,
          };
        } else if (this.touch.look.id === null) {
          this.touch.look = { id: t.identifier, x: t.clientX, y: t.clientY, startTime: performance.now(), travel: 0 };
        }
      }
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const move = this.touch.move;
        if (t.identifier === move.id) {
          const dx = t.clientX - move.ox;
          const dy = t.clientY - move.oy;
          const len = Math.hypot(dx, dy) || 1;
          const k = Math.min(len, move.radius) / len;   // 半径で頭打ちにした変位
          move.x = dx * k;
          move.y = dy * k;
          move.mag = Math.min(1, len / move.radius);
          const p = canvasPoint(t);
          move.cx = p.x;
          move.cy = p.y;
        } else if (t.identifier === this.touch.look.id) {
          const look = this.touch.look;
          const dx = t.clientX - look.x;
          const dy = t.clientY - look.y;
          look.travel += Math.hypot(dx, dy);
          this.mouseDX += dx * 0.006 * this.sensitivity;
          this.mouseDY += dy * 0.004 * this.sensitivity;
          look.x = t.clientX;
          look.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move.id) {
          this.touch.move = { active: false, id: null, ox: 0, oy: 0, bx: 0, by: 0, cx: 0, cy: 0, x: 0, y: 0, mag: 0, radius: 60 };
        }
        if (t.identifier === this.touch.look.id) {
          // ほとんど動かさない短いタップは射撃
          const look = this.touch.look;
          if (performance.now() - look.startTime < 260 && look.travel < 14) this.pressed.add('fire');
          this.touch.look = { id: null, x: 0, y: 0, startTime: 0, travel: 0 };
        }
      }
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch)
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

  isDown(action) {
    // スティックを大きく倒したときはダッシュ扱いにする
    if (action === 'sprint' && this.touch.move.active && this.touch.move.mag > 0.93) return true;
    return this.down.has(action);
  }
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
      x += this.touch.move.x / this.touch.move.radius;
      y += -this.touch.move.y / this.touch.move.radius;
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
