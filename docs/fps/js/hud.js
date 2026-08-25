// ============================================================
// hud.js — 照準・武器の見た目（ビューモデル）・体力/弾数・ミニマップ
// 画面座標にそのまま Canvas 2D で描く
// ============================================================
import { WEAPONS, PLAYER, clamp, tileAt } from './core.js';

const GLOVE = '#3d4450';
const GLOVE_DARK = '#252b34';
const METAL_DARK = '#23262c';

export class Hud {
  constructor() {
    this.hitMarker = 0;
    this.messages = [];
  }

  message(text, color = '#ffd54f', life = 2.2) {
    const last = this.messages[this.messages.length - 1];
    if (last && last.text === text) {          // 同じ文言は積み上げず時間だけ延ばす
      last.life = life;
      return;
    }
    this.messages.push({ text, color, life, max: life });
    if (this.messages.length > 4) this.messages.shift();
  }

  update(dt) {
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    for (const m of this.messages) m.life -= dt;
    this.messages = this.messages.filter((m) => m.life > 0);
  }

  draw(ctx, game) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    // 画面の短辺を基準にすると、横長でも縦長でも同じくらいの見た目になる
    const s = clamp(Math.min(w, h) / 720, 0.55, 3);
    const dpr = w / (ctx.canvas.clientWidth || w);
    ctx.save();
    this.#weapon(ctx, game, w, h, s);
    this.#damageVignette(ctx, game, w, h);
    this.#crosshair(ctx, game, w, h, s);
    this.#stats(ctx, game, w, h, s);
    this.#minimap(ctx, game, w, h, s, dpr);
    this.#stick(ctx, game, dpr);
    this.#messages(ctx, w, h, s);
    ctx.restore();
  }

  // ── 武器のビューモデル ────────────────────────────────────
  #weapon(ctx, game, w, h, s) {
    const p = game.player;
    const bobX = Math.sin(game.bobPhase) * 18 * s * game.bobAmount;
    const bobY = Math.abs(Math.cos(game.bobPhase)) * 14 * s * game.bobAmount;
    const kick = p.kick * 160 * s;
    const swayX = clamp(game.swayX, -1, 1) * 30 * s;
    const swayY = clamp(game.swayY, -1, 1) * 22 * s;
    const switchDrop = game.weaponSwitch * 340 * s;

    ctx.save();
    ctx.translate(w * 0.58 + bobX + swayX, h + 18 * s + bobY + kick + swayY + switchDrop);
    ctx.scale(s * 1.15, s * 1.15);

    if (p.weapon === 'pistol') this.#drawPistol(ctx, game);
    else if (p.weapon === 'shotgun') this.#drawShotgun(ctx, game);
    else this.#drawSmg(ctx, game);

    ctx.restore();
  }

  #muzzleFlash(ctx, game, x, y, size) {
    if (game.muzzle <= 0) return;
    const a = clamp(game.muzzle / 0.06, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, y);
    ctx.rotate(game.muzzleSeed);
    const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
    grd.addColorStop(0, `rgba(255,255,235,${0.95 * a})`);
    grd.addColorStop(0.35, `rgba(255,196,90,${0.75 * a})`);
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,235,180,${0.9 * a})`;
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const ang = (i / 6) * Math.PI * 2;
      ctx.lineTo(Math.cos(ang) * size * 0.95, Math.sin(ang) * size * 0.95);
      ctx.lineTo(Math.cos(ang + Math.PI / 6) * size * 0.32, Math.sin(ang + Math.PI / 6) * size * 0.32);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 手袋をした手。銃を握っているように見せる */
  #hand(ctx, x, y, w, h, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const grd = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grd.addColorStop(0, '#4a525f');
    grd.addColorStop(0.45, GLOVE);
    grd.addColorStop(1, GLOVE_DARK);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, w * 0.34);
    ctx.fill();
    // 指の割れ目
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i += 1) {
      const yy = -h / 2 + h * (0.3 + i * 0.2);
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 6, yy);
      ctx.lineTo(w / 2 - 6, yy);
      ctx.stroke();
    }
    // 親指
    ctx.fillStyle = GLOVE;
    ctx.beginPath();
    ctx.ellipse(-w / 2 + 4, -h * 0.18, w * 0.16, h * 0.2, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  #metal(ctx, x, y, w, h, r, dark = METAL_DARK, light = '#79808d') {
    const grd = ctx.createLinearGradient(x, 0, x + w, 0);
    grd.addColorStop(0, dark);
    grd.addColorStop(0.45, light);
    grd.addColorStop(1, dark);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  #drawPistol(ctx, game) {
    const slide = game.muzzle > 0 ? 14 : 0;
    ctx.save();
    ctx.translate(-10, -46);
    ctx.scale(1.24, 1.24);      // 他の銃より小さいので画面内で見えるよう大きめに
    ctx.save();
    // スライド（発射時に後退する）
    this.#metal(ctx, -32, -250 + slide, 64, 128, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(16, -230 + slide + i * 14, 12, 6);
    // フロントサイト
    ctx.fillStyle = METAL_DARK;
    ctx.fillRect(-6, -262 + slide, 12, 14);
    // フレーム
    this.#metal(ctx, -28, -140, 56, 60, 6, '#1c1f25', '#5a616c');
    // グリップ
    ctx.save();
    ctx.rotate(0.16);
    ctx.fillStyle = '#2a2e35';
    ctx.beginPath(); ctx.roundRect(-30, -110, 60, 150, 12); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 6; i += 1) ctx.fillRect(-24, -96 + i * 22, 48, 8);
    ctx.restore();
    // トリガーガード
    ctx.strokeStyle = '#22262c';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(-2, -92, 26, 0.1, Math.PI - 0.1);
    ctx.stroke();
    this.#muzzleFlash(ctx, game, 0, -262 + slide, 78);
    ctx.restore();
    this.#hand(ctx, 6, -50, 86, 132, 0.16);
    this.#hand(ctx, -54, -8, 80, 120, -0.35);
    ctx.restore();
  }

  #drawShotgun(ctx, game) {
    const pump = clamp(game.reloadAnim, 0, 1);
    ctx.save();
    ctx.translate(-6, 0);
    ctx.rotate(-0.05);
    // 銃身とマガジンチューブ
    this.#metal(ctx, -36, -360, 72, 300, 12, '#191c21', '#6b727d');
    ctx.fillStyle = '#15171b';
    ctx.beginPath(); ctx.roundRect(-30, -360, 22, 296, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(18, -352, 6, 284);
    // ポンプ（発射後に手前へ動く）
    ctx.fillStyle = '#6b4a2c';
    ctx.beginPath(); ctx.roundRect(-42, -215 + pump * 52, 84, 74, 12); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(-36, -204 + pump * 52 + i * 14, 72, 5);
    // レシーバーとストック
    this.#metal(ctx, -34, -100, 68, 78, 8, '#1b1e23', '#525963');
    ctx.fillStyle = '#7a5230';
    ctx.beginPath(); ctx.roundRect(-32, -34, 64, 120, 14); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.roundRect(-24, -20, 20, 96, 8); ctx.fill();
    this.#muzzleFlash(ctx, game, -4, -368, 104);
    ctx.restore();
    this.#hand(ctx, -58, -172 + pump * 52, 84, 116, 0.3);
    this.#hand(ctx, 22, -34, 90, 128, -0.12);
  }

  #drawSmg(ctx, game) {
    const shake = game.muzzle > 0 ? 7 : 0;
    ctx.save();
    ctx.translate(0, shake);
    ctx.rotate(-0.02);
    // レシーバー
    this.#metal(ctx, -34, -300, 68, 230, 10, '#1c1f25', '#5f6672');
    // 放熱カバー
    ctx.fillStyle = '#101216';
    for (let i = 0; i < 6; i += 1) {
      ctx.beginPath(); ctx.roundRect(-22, -290 + i * 26, 44, 12, 5); ctx.fill();
    }
    // フロントサイト
    ctx.fillStyle = METAL_DARK;
    ctx.fillRect(-7, -316, 14, 18);
    // マガジン
    ctx.fillStyle = '#33383f';
    ctx.beginPath(); ctx.roundRect(-26, -96, 52, 150, 10); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(-20, -80 + i * 26, 40, 6);
    // グリップ
    ctx.save();
    ctx.rotate(0.2);
    ctx.fillStyle = '#26292f';
    ctx.beginPath(); ctx.roundRect(14, -74, 52, 132, 12); ctx.fill();
    ctx.restore();
    this.#muzzleFlash(ctx, game, 0, -318, 72);
    ctx.restore();
    this.#hand(ctx, 42, -22 + shake, 86, 126, 0.2);
    this.#hand(ctx, -44, -108 + shake, 80, 112, 0.4);
  }

  // ── 照準 ──────────────────────────────────────────────────
  #crosshair(ctx, game, w, h, s) {
    const cx = w / 2;
    const cy = h / 2;
    const spread = (8 + game.crosshairSpread * 60) * s;
    const len = 10 * s;
    ctx.strokeStyle = game.aimingAtEnemy ? 'rgba(255,120,110,0.95)' : 'rgba(230,240,255,0.85)';
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.beginPath();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      ctx.moveTo(cx + dx * spread, cy + dy * spread);
      ctx.lineTo(cx + dx * (spread + len), cy + dy * (spread + len));
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(230,240,255,0.9)';
    ctx.fillRect(cx - 1 * s, cy - 1 * s, 2 * s, 2 * s);

    if (this.hitMarker > 0) {
      const a = clamp(this.hitMarker / 0.25, 0, 1);
      ctx.strokeStyle = `rgba(255,235,140,${a})`;
      ctx.lineWidth = 3 * s;
      const r1 = 8 * s;
      const r2 = 18 * s;
      ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(cx + dx * r1, cy + dy * r1);
        ctx.lineTo(cx + dx * r2, cy + dy * r2);
      }
      ctx.stroke();
    }
  }

  #damageVignette(ctx, game, w, h) {
    if (game.damageFlash <= 0) return;
    const a = clamp(game.damageFlash, 0, 1);
    const grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.65);
    grd.addColorStop(0, 'rgba(180,0,0,0)');
    grd.addColorStop(1, `rgba(190,10,10,${0.75 * a})`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  }

  // ── 体力・弾数・スコア ────────────────────────────────────
  #stats(ctx, game, w, h, s) {
    const p = game.player;
    const pad = 26 * s;
    const barW = 260 * s;
    const barH = 22 * s;
    const y = h - pad - barH;

    // 体力
    ctx.fillStyle = 'rgba(8,10,16,0.62)';
    ctx.beginPath(); ctx.roundRect(pad - 8 * s, y - 30 * s, barW + 16 * s, barH + 42 * s, 10 * s); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `${13 * s}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('HEALTH', pad, y - 12 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(pad, y, barW, barH);
    const hpRatio = clamp(p.hp / PLAYER.maxHp, 0, 1);
    const grd = ctx.createLinearGradient(pad, 0, pad + barW, 0);
    if (hpRatio > 0.5) { grd.addColorStop(0, '#3ddc84'); grd.addColorStop(1, '#7ef0a8'); }
    else if (hpRatio > 0.25) { grd.addColorStop(0, '#ffb300'); grd.addColorStop(1, '#ffd54f'); }
    else { grd.addColorStop(0, '#e53935'); grd.addColorStop(1, '#ff7043'); }
    ctx.fillStyle = grd;
    ctx.fillRect(pad, y, barW * hpRatio, barH);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${15 * s}px system-ui, sans-serif`;
    ctx.fillText(`${Math.ceil(p.hp)}`, pad + 8 * s, y + barH - 5 * s);

    // 武器と弾数
    const weapon = WEAPONS[p.weapon];
    const ammoText = weapon.ammo ? `${p.ammo[weapon.ammo]}` : '∞';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(8,10,16,0.62)';
    ctx.beginPath(); ctx.roundRect(w - pad - 210 * s, y - 30 * s, 210 * s, barH + 42 * s, 10 * s); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `${13 * s}px system-ui, sans-serif`;
    ctx.fillText(weapon.name, w - pad - 12 * s, y - 12 * s);
    ctx.fillStyle = weapon.ammo && p.ammo[weapon.ammo] === 0 ? '#ef5350' : '#ffd54f';
    ctx.font = `bold ${34 * s}px system-ui, sans-serif`;
    ctx.fillText(ammoText, w - pad - 12 * s, y + barH - 1 * s);

    // 所持武器スロット。タッチ操作時は右下のボタンとぶつかるので左側へ寄せる
    const slots = [['pistol', 'ハンドガン'], ['shotgun', 'ショットガン'], ['smg', 'SMG']];
    const owned = slots.filter(([id]) => p.owned[id]);
    const chipW = 104 * s;
    const chipH = 28 * s;
    const chipY = y - 30 * s - chipH - 10 * s;
    ctx.font = `${12 * s}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    owned.forEach(([id, label], i) => {
      const bx = game.touchUi
        ? pad - 8 * s + i * (chipW + 8 * s)
        : w - pad - (owned.length - i) * (chipW + 8 * s) + 8 * s;
      const active = id === p.weapon;
      ctx.fillStyle = active ? 'rgba(255,213,79,0.92)' : 'rgba(8,10,16,0.62)';
      ctx.beginPath(); ctx.roundRect(bx, chipY, chipW, chipH, 7 * s); ctx.fill();
      ctx.fillStyle = active ? '#1b1b1b' : 'rgba(255,255,255,0.68)';
      ctx.fillText(`${slots.findIndex(([sid]) => sid === id) + 1}  ${label}`, bx + chipW / 2, chipY + 19 * s);
    });

    // スコアとウェーブ
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.beginPath(); ctx.roundRect(pad - 8 * s, pad - 8 * s, 250 * s, 74 * s, 10 * s); ctx.fill();
    ctx.fillStyle = '#7fd4ff';
    ctx.font = `bold ${20 * s}px system-ui, sans-serif`;
    ctx.fillText(`WAVE ${game.wave}`, pad, pad + 18 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${14 * s}px system-ui, sans-serif`;
    ctx.fillText(`残り ${game.enemiesLeft} 体`, pad, pad + 40 * s);
    ctx.fillStyle = '#ffd54f';
    ctx.font = `bold ${16 * s}px system-ui, sans-serif`;
    ctx.fillText(`SCORE ${game.score.toLocaleString('ja-JP')}`, pad, pad + 60 * s);
  }

  // ── ミニマップ ────────────────────────────────────────────
  #minimap(ctx, game, w, h, s, dpr = 1) {
    if (!game.showMap) return;
    const size = (game.touchUi ? 150 : 190) * s;   // タッチ操作時は FIRE ボタンと重ならない大きさに
    const x0 = w - size - 26 * s;
    const y0 = 26 * s + (game.touchUi ? 72 * dpr : 0);   // ポーズボタンの下に置く
    const map = game.map;
    const cell = size / 15;                  // プレイヤー周囲 15 マス
    const p = game.player;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0, y0, size, size, 10 * s);
    ctx.fillStyle = 'rgba(6,8,14,0.7)';
    ctx.fill();
    ctx.clip();
    ctx.translate(x0 + size / 2, y0 + size / 2);

    for (let dy = -8; dy <= 8; dy += 1) {
      for (let dx = -8; dx <= 8; dx += 1) {
        const mx = Math.floor(p.x) + dx;
        const my = Math.floor(p.y) + dy;
        if (tileAt(map, mx, my) > 0) {
          ctx.fillStyle = 'rgba(120,140,180,0.75)';
          ctx.fillRect((mx - p.x) * cell, (my - p.y) * cell, cell - 1, cell - 1);
        }
      }
    }
    for (const e of game.enemies) {
      if (!e.alive) continue;
      ctx.fillStyle = e.type === 'brute' ? '#ff7043' : e.type === 'shooter' ? '#b39ddb' : '#ef5350';
      ctx.beginPath();
      ctx.arc((e.x - p.x) * cell, (e.y - p.y) * cell, cell * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const it of game.items) {
      ctx.fillStyle = it.kind === 'health' ? '#66bb6a' : '#ffd54f';
      ctx.fillRect((it.x - p.x) * cell - 2 * s, (it.y - p.y) * cell - 2 * s, 4 * s, 4 * s);
    }
    // プレイヤー
    ctx.rotate(p.angle + Math.PI / 2);
    ctx.fillStyle = '#7fd4ff';
    ctx.beginPath();
    ctx.moveTo(0, -cell * 0.55);
    ctx.lineTo(cell * 0.4, cell * 0.45);
    ctx.lineTo(-cell * 0.4, cell * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.roundRect(x0, y0, size, size, 10 * s); ctx.stroke();
  }

  /** タッチ操作中だけ、指を置いた場所に仮想スティックを描く */
  #stick(ctx, game, dpr) {
    const move = game.input?.touch?.move;
    if (!move?.active) return;
    const r = move.radius * dpr;
    const knobX = move.bx + move.x * dpr;
    const knobY = move.by + move.y * dpr;

    ctx.save();
    ctx.strokeStyle = 'rgba(200, 220, 255, 0.35)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(move.bx, move.by, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(12, 16, 26, 0.35)';
    ctx.fill();

    // 端まで倒すとダッシュ。リングを光らせて知らせる
    if (move.mag > 0.93) {
      ctx.strokeStyle = 'rgba(127, 212, 255, 0.9)';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.arc(move.bx, move.by, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const grd = ctx.createRadialGradient(knobX, knobY, 0, knobX, knobY, r * 0.42);
    grd.addColorStop(0, 'rgba(235, 243, 255, 0.85)');
    grd.addColorStop(1, 'rgba(140, 165, 210, 0.55)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(knobX, knobY, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  #messages(ctx, w, h, s) {
    ctx.textAlign = 'center';
    ctx.font = `bold ${18 * s}px system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6 * s;
    this.messages.forEach((m, i) => {
      ctx.globalAlpha = clamp(m.life / Math.min(0.6, m.max), 0, 1);
      ctx.fillStyle = m.color;
      ctx.fillText(m.text, w / 2, h * 0.3 + i * 28 * s);
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
  }
}
