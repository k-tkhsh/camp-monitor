// ============================================================
// assets.js — 画像ファイルを使わず、テクスチャとスプライトを手続き的に生成する
// すべて {w,h,data:Uint32Array}（0xAABBGGRR）形式で返す
// ============================================================
import { mulberry32, clamp } from './core.js';

const TEX = 64;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** canvas → スプライト（Uint32Array） */
function toSprite(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { w: canvas.width, h: canvas.height, data: new Uint32Array(img.data.buffer.slice(0)) };
}

function shade(hex, mul) {
  const r = clamp(Math.round(((hex >> 16) & 255) * mul), 0, 255);
  const g = clamp(Math.round(((hex >> 8) & 255) * mul), 0, 255);
  const b = clamp(Math.round((hex & 255) * mul), 0, 255);
  return `rgb(${r},${g},${b})`;
}

// ── 壁テクスチャ ────────────────────────────────────────────
function brickTexture(seed, base, mortar, opts = {}) {
  const c = makeCanvas(TEX, TEX);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  g.fillStyle = shade(mortar, 1);
  g.fillRect(0, 0, TEX, TEX);
  const rows = opts.rows ?? 8;
  const bh = TEX / rows;
  for (let r = 0; r < rows; r += 1) {
    const offset = r % 2 === 0 ? 0 : bh;
    for (let x = -bh * 2; x < TEX; x += bh * 2) {
      const v = 0.78 + rng() * 0.34;
      g.fillStyle = shade(base, v);
      g.fillRect(x + offset + 1, r * bh + 1, bh * 2 - 2, bh - 2);
      // ハイライトと影で立体感を出す
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x + offset + 1, r * bh + 1, bh * 2 - 2, 1);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + offset + 1, (r + 1) * bh - 2, bh * 2 - 2, 1);
    }
  }
  // 汚れ
  for (let i = 0; i < 90; i += 1) {
    g.fillStyle = `rgba(0,0,0,${rng() * 0.16})`;
    g.fillRect(rng() * TEX, rng() * TEX, 1 + rng() * 3, 1 + rng() * 3);
  }
  return toSprite(c);
}

function panelTexture(seed, base, accent) {
  const c = makeCanvas(TEX, TEX);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  const grd = g.createLinearGradient(0, 0, 0, TEX);
  grd.addColorStop(0, shade(base, 1.15));
  grd.addColorStop(1, shade(base, 0.7));
  g.fillStyle = grd;
  g.fillRect(0, 0, TEX, TEX);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.strokeRect(3, 3, TEX - 6, TEX - 6);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  g.strokeRect(6, 6, TEX - 12, TEX - 12);
  g.fillStyle = shade(accent, 1);
  g.fillRect(8, TEX / 2 - 2, TEX - 16, 4);
  // リベット
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (const [x, y] of [[8, 8], [TEX - 9, 8], [8, TEX - 9], [TEX - 9, TEX - 9]]) {
    g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 60; i += 1) {
    g.fillStyle = `rgba(255,255,255,${rng() * 0.05})`;
    g.fillRect(rng() * TEX, rng() * TEX, 2, 1);
  }
  return toSprite(c);
}

function hazardTexture(seed) {
  const c = makeCanvas(TEX, TEX);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  g.fillStyle = '#2a2620';
  g.fillRect(0, 0, TEX, TEX);
  g.save();
  g.beginPath(); g.rect(0, 10, TEX, TEX - 20); g.clip();
  g.fillStyle = '#c9a227';
  g.fillRect(0, 10, TEX, TEX - 20);
  g.fillStyle = '#26221b';
  for (let i = -TEX; i < TEX * 2; i += 16) {
    g.beginPath();
    g.moveTo(i, 10); g.lineTo(i + 8, 10); g.lineTo(i + 8 - TEX, TEX - 10); g.lineTo(i - TEX, TEX - 10);
    g.closePath(); g.fill();
  }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, TEX, 4);
  g.fillRect(0, TEX - 4, TEX, 4);
  for (let i = 0; i < 120; i += 1) {
    g.fillStyle = `rgba(0,0,0,${rng() * 0.2})`;
    g.fillRect(rng() * TEX, rng() * TEX, 1 + rng() * 2, 1 + rng() * 2);
  }
  return toSprite(c);
}

function pipeTexture(seed, base) {
  const c = makeCanvas(TEX, TEX);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  g.fillStyle = shade(base, 0.75);
  g.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 200; i += 1) {
    g.fillStyle = `rgba(0,0,0,${rng() * 0.25})`;
    g.fillRect(rng() * TEX, rng() * TEX, 2, 2);
  }
  for (const px of [12, 34, 52]) {
    const grd = g.createLinearGradient(px - 5, 0, px + 5, 0);
    grd.addColorStop(0, shade(base, 0.5));
    grd.addColorStop(0.4, shade(base, 1.35));
    grd.addColorStop(1, shade(base, 0.55));
    g.fillStyle = grd;
    g.fillRect(px - 5, 0, 10, TEX);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(px - 6, 20, 12, 5);
    g.fillRect(px - 6, 46, 12, 5);
  }
  return toSprite(c);
}

function floorTexture(seed) {
  const c = makeCanvas(TEX, TEX);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  g.fillStyle = '#2a2d35';
  g.fillRect(0, 0, TEX, TEX);
  g.fillStyle = '#232631';
  g.fillRect(0, 0, TEX / 2, TEX / 2);
  g.fillRect(TEX / 2, TEX / 2, TEX / 2, TEX / 2);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, TEX, TEX);
  g.beginPath(); g.moveTo(TEX / 2, 0); g.lineTo(TEX / 2, TEX); g.moveTo(0, TEX / 2); g.lineTo(TEX, TEX / 2); g.stroke();
  for (let i = 0; i < 260; i += 1) {
    g.fillStyle = `rgba(255,255,255,${rng() * 0.045})`;
    g.fillRect(rng() * TEX, rng() * TEX, 1, 1);
  }
  return toSprite(c);
}

function ceilingTexture(seed) {
  const c = makeCanvas(TEX, TEX);
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  g.fillStyle = '#191b22';
  g.fillRect(0, 0, TEX, TEX);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  for (let i = 0; i <= TEX; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, TEX); g.moveTo(0, i); g.lineTo(TEX, i); g.stroke();
  }
  for (let i = 0; i < 160; i += 1) {
    g.fillStyle = `rgba(0,0,0,${rng() * 0.3})`;
    g.fillRect(rng() * TEX, rng() * TEX, 2, 2);
  }
  return toSprite(c);
}

// ── モンスター ──────────────────────────────────────────────
const SW = 96;
const SH = 128;

/**
 * 二足歩行モンスターを描く。frame: 0,1=歩行 / 2=攻撃 / 3=被弾
 */
function drawMonster(g, cfg, frame) {
  const cx = SW / 2;
  const ground = SH - 6;
  const walk = frame === 1 ? 1 : 0;
  const attacking = frame === 2;
  const hurt = frame === 3;
  const lean = attacking ? 4 : 0;
  const bodyW = cfg.bodyW;
  const bodyH = cfg.bodyH;
  const bodyTop = ground - cfg.legH - bodyH;

  const limb = (x, y, w, h, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x - w / 2, y, w, h, w / 2);
    g.fill();
  };

  // 影
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.ellipse(cx, ground + 2, bodyW * 0.62, 6, 0, 0, Math.PI * 2);
  g.fill();

  // 脚
  const legSwing = walk ? 7 : 0;
  limb(cx - bodyW * 0.26 + legSwing, ground - cfg.legH, cfg.legW, cfg.legH + 2, cfg.dark);
  limb(cx + bodyW * 0.26 - legSwing, ground - cfg.legH, cfg.legW, cfg.legH + 2, cfg.dark);

  // 胴
  const grd = g.createLinearGradient(cx - bodyW / 2, bodyTop, cx + bodyW / 2, bodyTop + bodyH);
  grd.addColorStop(0, cfg.light);
  grd.addColorStop(0.55, cfg.body);
  grd.addColorStop(1, cfg.dark);
  g.fillStyle = grd;
  g.beginPath();
  g.roundRect(cx - bodyW / 2 + lean * 0.4, bodyTop, bodyW, bodyH, cfg.round);
  g.fill();
  // 胸のプレート
  g.fillStyle = cfg.accent;
  g.beginPath();
  g.roundRect(cx - bodyW * 0.24 + lean * 0.4, bodyTop + bodyH * 0.22, bodyW * 0.48, bodyH * 0.34, 5);
  g.fill();

  // 腕
  const armY = bodyTop + bodyH * 0.16;
  const armLen = cfg.armLen * (attacking ? 1.25 : 1);
  const armSwing = walk ? -5 : 0;
  limb(cx - bodyW * 0.56 - lean, armY + (attacking ? -10 : armSwing), cfg.armW, armLen, cfg.body);
  limb(cx + bodyW * 0.56 + lean, armY + (attacking ? -10 : -armSwing), cfg.armW, armLen, cfg.body);
  if (cfg.claws) {
    g.fillStyle = cfg.clawColor;
    for (const side of [-1, 1]) {
      const ax = cx + side * bodyW * 0.56 + side * lean;
      const ay = armY + (attacking ? -10 : side * armSwing) + armLen;
      for (let i = -1; i <= 1; i += 1) {
        g.beginPath();
        g.moveTo(ax + i * 4, ay - 2);
        g.lineTo(ax + i * 4 + 2, ay + 9);
        g.lineTo(ax + i * 4 - 2, ay + 9);
        g.closePath();
        g.fill();
      }
    }
  }
  if (cfg.cannon) {
    // 右腕を砲身に
    const ax = cx + bodyW * 0.56 + lean;
    g.fillStyle = cfg.dark;
    g.beginPath();
    g.roundRect(ax - 9, armY + armLen - 6, 18, 22, 4);
    g.fill();
    g.fillStyle = attacking ? '#ffe9a8' : cfg.accent;
    g.beginPath();
    g.arc(ax, armY + armLen + 14, attacking ? 9 : 5, 0, Math.PI * 2);
    g.fill();
  }

  // 頭
  const headR = cfg.headR;
  const headY = bodyTop - headR * 0.6 + (hurt ? 3 : 0);
  g.fillStyle = cfg.body;
  g.beginPath();
  g.ellipse(cx + lean * 0.6, headY, headR * 1.05, headR, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = cfg.dark;
  g.beginPath();
  g.ellipse(cx + lean * 0.6, headY + headR * 0.35, headR * 0.95, headR * 0.5, 0, 0, Math.PI * 2);
  g.fill();

  // 目（発光）
  const eyeColor = hurt ? '#ffffff' : cfg.eye;
  g.shadowColor = eyeColor;
  g.shadowBlur = 12;
  g.fillStyle = eyeColor;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + lean * 0.6 + side * headR * 0.42, headY - headR * 0.08, headR * 0.24, headR * (attacking ? 0.3 : 0.2), 0, 0, Math.PI * 2);
    g.fill();
  }
  g.shadowBlur = 0;

  // 口／牙
  if (cfg.fangs) {
    g.fillStyle = '#f6f2e8';
    for (let i = -2; i <= 2; i += 1) {
      g.beginPath();
      g.moveTo(cx + i * 5 + lean * 0.6, headY + headR * 0.45);
      g.lineTo(cx + i * 5 + 2.4 + lean * 0.6, headY + headR * 0.45);
      g.lineTo(cx + i * 5 + 1.2 + lean * 0.6, headY + headR * (attacking ? 0.95 : 0.75));
      g.closePath();
      g.fill();
    }
  }
}

const MONSTERS = {
  grunt: {
    body: '#5f9e4a', light: '#8fd06f', dark: '#2f5a26', accent: '#31431f', eye: '#ffd24a',
    bodyW: 40, bodyH: 44, legH: 26, legW: 13, armW: 12, armLen: 30, headR: 15, round: 12,
    claws: true, clawColor: '#e8e2cf', fangs: true,
  },
  shooter: {
    body: '#7a5fbf', light: '#b49bef', dark: '#3d2d6b', accent: '#2a1f4d', eye: '#66f0ff',
    bodyW: 36, bodyH: 42, legH: 30, legW: 11, armW: 11, armLen: 28, headR: 13, round: 10,
    claws: false, cannon: true, fangs: false,
  },
  brute: {
    body: '#b2483c', light: '#e8836f', dark: '#5e1f1a', accent: '#3a1512', eye: '#ffe066',
    bodyW: 56, bodyH: 54, legH: 24, legW: 18, armW: 17, armLen: 34, headR: 17, round: 16,
    claws: true, clawColor: '#2b2b2b', fangs: true,
  },
};

function monsterFrames(type) {
  const cfg = MONSTERS[type];
  return [0, 1, 2, 3].map((frame) => {
    const c = makeCanvas(SW, SH);
    const g = c.getContext('2d');
    drawMonster(g, cfg, frame);
    return toSprite(c);
  });
}

// ── アイテム・弾・粒子 ──────────────────────────────────────
function medkitSprite() {
  const c = makeCanvas(48, 48);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath(); g.ellipse(24, 42, 15, 4, 0, 0, Math.PI * 2); g.fill();
  const grd = g.createLinearGradient(0, 8, 0, 42);
  grd.addColorStop(0, '#f2f5f7');
  grd.addColorStop(1, '#b9c2c9');
  g.fillStyle = grd;
  g.beginPath(); g.roundRect(8, 12, 32, 28, 5); g.fill();
  g.strokeStyle = '#7d868d'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#e53935';
  g.fillRect(21, 18, 6, 16);
  g.fillRect(16, 23, 16, 6);
  return toSprite(c);
}

function ammoSprite(color, label) {
  const c = makeCanvas(48, 48);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath(); g.ellipse(24, 42, 15, 4, 0, 0, Math.PI * 2); g.fill();
  const grd = g.createLinearGradient(0, 14, 0, 40);
  grd.addColorStop(0, color);
  grd.addColorStop(1, '#3a3327');
  g.fillStyle = grd;
  g.beginPath(); g.roundRect(9, 16, 30, 24, 3); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(9, 25, 30, 4);
  g.fillStyle = '#1b1b1b';
  g.font = 'bold 13px sans-serif';
  g.textAlign = 'center';
  g.fillText(label, 24, 38);
  return toSprite(c);
}

function weaponPickupSprite(kind) {
  const c = makeCanvas(64, 48);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath(); g.ellipse(32, 42, 20, 4, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#33373f';
  g.strokeStyle = '#8a929c';
  g.lineWidth = 2;
  if (kind === 'shotgun') {
    g.beginPath(); g.roundRect(8, 20, 44, 8, 3); g.fill(); g.stroke();
    g.fillStyle = '#6b4b2a';
    g.beginPath(); g.roundRect(40, 24, 16, 12, 3); g.fill();
    g.fillStyle = '#2b2f36';
    g.beginPath(); g.roundRect(20, 28, 8, 8, 2); g.fill();
  } else {
    g.beginPath(); g.roundRect(12, 18, 38, 10, 3); g.fill(); g.stroke();
    g.fillStyle = '#2b2f36';
    g.beginPath(); g.roundRect(24, 28, 9, 14, 2); g.fill();
    g.beginPath(); g.roundRect(40, 26, 12, 8, 2); g.fill();
  }
  g.shadowColor = '#7fd4ff';
  g.shadowBlur = 10;
  g.strokeStyle = 'rgba(127,212,255,0.8)';
  g.lineWidth = 1.5;
  g.strokeRect(6, 14, 52, 26);
  g.shadowBlur = 0;
  return toSprite(c);
}

function glowSprite(size, inner, outer) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.45, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return toSprite(c);
}

function dotSprite(color) {
  const c = makeCanvas(16, 16);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grd.addColorStop(0, color);
  grd.addColorStop(0.6, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(8, 8, 8, 0, Math.PI * 2); g.fill();
  return toSprite(c);
}

/** ゲーム開始時に一度だけ呼ぶ */
export function buildAssets() {
  return {
    walls: {
      1: brickTexture(11, 0x8a8f9c, 0x3b3f4a),
      2: panelTexture(22, 0x46586e, 0x7fd4ff),
      3: brickTexture(33, 0x6f7a5a, 0x333a2c, { rows: 4 }),
      4: hazardTexture(44),
      5: pipeTexture(55, 0x8e4a3f),
    },
    floor: floorTexture(66),
    ceiling: ceilingTexture(77),
    monsters: {
      grunt: monsterFrames('grunt'),
      shooter: monsterFrames('shooter'),
      brute: monsterFrames('brute'),
    },
    items: {
      health: medkitSprite(),
      shell: ammoSprite('#c8a02a', '12G'),
      bullet: ammoSprite('#9aa4b0', '9mm'),
      shotgun: weaponPickupSprite('shotgun'),
      smg: weaponPickupSprite('smg'),
    },
    plasma: glowSprite(32, 'rgba(255,255,255,0.95)', 'rgba(120,230,255,0.75)'),
    fireball: glowSprite(32, 'rgba(255,240,190,0.95)', 'rgba(255,140,60,0.7)'),
    particles: {
      blood: dotSprite('rgba(190,40,40,0.95)'),
      spark: dotSprite('rgba(255,220,140,0.95)'),
      goo: dotSprite('rgba(140,255,170,0.9)'),
      smoke: dotSprite('rgba(160,160,170,0.55)'),
    },
  };
}
