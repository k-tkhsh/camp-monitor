// ============================================================
// render.js — レイキャスティング描画（Canvas 2D の ImageData に直接書き込む）
// 壁・床・天井・スプライトをすべて 1 枚のピクセルバッファに合成する
// ============================================================
import { tileAt, clamp } from './core.js';

const FOG_COLOR = { r: 12, g: 14, b: 22 };
const MAX_DIST = 26;      // これより遠い壁は霧に溶ける

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.quality = 0.55;
    this.buf = null;
    this.zbuf = null;
    this.width = 0;
    this.height = 0;
    this.inner = document.createElement('canvas');
    this.innerCtx = this.inner.getContext('2d', { alpha: false });
    this.resize();
  }

  /** CSS サイズに合わせてバッファを作り直す */
  resize(quality = this.quality) {
    this.quality = quality;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(240, this.canvas.clientHeight || window.innerHeight);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;

    const w = Math.max(160, Math.round(cssW * quality));
    const h = Math.max(120, Math.round(cssH * quality));
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.inner.width = w;
      this.inner.height = h;
      this.image = this.innerCtx.createImageData(w, h);
      this.buf = new Uint32Array(this.image.data.buffer);
      this.zbuf = new Float32Array(w);
    }
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * @param {object} scene {map, player:{x,y,angle,pitch,bobZ}, sprites:[], flash:number}
   */
  render(scene) {
    const { map, player } = scene;
    const w = this.width;
    const h = this.height;

    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const aspect = w / h;
    const planeLen = 0.5 * Math.max(aspect, 1.2) * 0.94;   // 縦長の画面でも視野を確保
    const planeX = -dirY * planeLen;
    const planeY = dirX * planeLen;
    const horizon = Math.round(h * 0.5 + (player.pitch ?? 0) * h * 0.5 + (player.bobZ ?? 0) * h);
    const flash = scene.flash ?? 0;

    this.#drawFloorCeiling(map, player, dirX, dirY, planeX, planeY, horizon, flash);
    this.#drawWalls(map, player, dirX, dirY, planeX, planeY, horizon, flash);

    // スプライトは奥から順に
    const sprites = scene.sprites;
    for (const s of sprites) {
      s._d = (s.x - player.x) * (s.x - player.x) + (s.y - player.y) * (s.y - player.y);
    }
    sprites.sort((a, b) => b._d - a._d);
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    for (const s of sprites) this.#drawSprite(s, player, dirX, dirY, planeX, planeY, invDet, horizon, flash);

    this.innerCtx.putImageData(this.image, 0, 0);
    this.ctx.drawImage(this.inner, 0, 0, w, h, 0, 0, this.canvas.width, this.canvas.height);
  }

  // ── 床と天井（フロアキャスティング）──────────────────────
  #drawFloorCeiling(map, player, dirX, dirY, planeX, planeY, horizon, flash) {
    const w = this.width;
    const h = this.height;
    const buf = this.buf;
    const floorTex = this.assets.floor;
    const ceilTex = this.assets.ceiling;
    const ft = floorTex.data;
    const ct = ceilTex.data;
    const ts = floorTex.w;

    const rayX0 = dirX - planeX;
    const rayY0 = dirY - planeY;
    const rayX1 = dirX + planeX;
    const rayY1 = dirY + planeY;

    for (let y = 0; y < h; y += 1) {
      const isFloor = y > horizon;
      const p = isFloor ? y - horizon : horizon - y;
      if (p <= 0) {
        // 地平線ぴったりの行は霧色で埋める
        const c = 0xff000000 | (FOG_COLOR.b << 16) | (FOG_COLOR.g << 8) | FOG_COLOR.r;
        buf.fill(c, y * w, y * w + w);
        continue;
      }
      const rowDist = (0.5 * h) / p;
      const stepX = (rowDist * (rayX1 - rayX0)) / w;
      const stepY = (rowDist * (rayY1 - rayY0)) / w;
      let fx = player.x + rowDist * rayX0;
      let fy = player.y + rowDist * rayY0;

      let light = 1 - clamp(rowDist / MAX_DIST, 0, 1);
      light *= isFloor ? 0.92 : 0.66;
      light += flash * Math.max(0, 1 - rowDist / 7);
      light = clamp(light, 0, 1.6);
      const f = (light * 256) | 0;
      const inv = Math.max(0, 256 - f);
      const fr = (FOG_COLOR.r * inv) >> 8;
      const fg = (FOG_COLOR.g * inv) >> 8;
      const fb = (FOG_COLOR.b * inv) >> 8;
      const tex = isFloor ? ft : ct;
      const row = y * w;

      for (let x = 0; x < w; x += 1) {
        const tx = (((fx * ts) | 0) % ts + ts) % ts;
        const ty = (((fy * ts) | 0) % ts + ts) % ts;
        const c = tex[ty * ts + tx];
        const r = Math.min(255, (((c & 255) * f) >> 8) + fr);
        const g = Math.min(255, ((((c >> 8) & 255) * f) >> 8) + fg);
        const b = Math.min(255, ((((c >> 16) & 255) * f) >> 8) + fb);
        buf[row + x] = 0xff000000 | (b << 16) | (g << 8) | r;
        fx += stepX;
        fy += stepY;
      }
    }
  }

  // ── 壁 ────────────────────────────────────────────────────
  #drawWalls(map, player, dirX, dirY, planeX, planeY, horizon, flash) {
    const w = this.width;
    const h = this.height;
    const buf = this.buf;
    const zbuf = this.zbuf;
    const walls = this.assets.walls;

    for (let x = 0; x < w; x += 1) {
      const camX = (2 * x) / w - 1;
      const rayX = dirX + planeX * camX;
      const rayY = dirY + planeY * camX;

      let mapX = Math.floor(player.x);
      let mapY = Math.floor(player.y);
      const deltaX = rayX === 0 ? Infinity : Math.abs(1 / rayX);
      const deltaY = rayY === 0 ? Infinity : Math.abs(1 / rayY);
      let stepX, stepY, sideX, sideY;
      if (rayX < 0) { stepX = -1; sideX = (player.x - mapX) * deltaX; } else { stepX = 1; sideX = (mapX + 1 - player.x) * deltaX; }
      if (rayY < 0) { stepY = -1; sideY = (player.y - mapY) * deltaY; } else { stepY = 1; sideY = (mapY + 1 - player.y) * deltaY; }

      let side = 0;
      let tile = 0;
      let perp = MAX_DIST;
      for (let guard = 0; guard < 256; guard += 1) {
        if (sideX < sideY) { perp = sideX; sideX += deltaX; mapX += stepX; side = 0; }
        else { perp = sideY; sideY += deltaY; mapY += stepY; side = 1; }
        if (perp > MAX_DIST) { tile = 0; break; }
        tile = tileAt(map, mapX, mapY);
        if (tile > 0) break;
      }
      zbuf[x] = tile > 0 ? perp : MAX_DIST;
      if (tile <= 0) continue;

      const tex = walls[tile] ?? walls[1];
      const ts = tex.w;
      let wallX = side === 0 ? player.y + perp * rayY : player.x + perp * rayX;
      wallX -= Math.floor(wallX);
      let texX = (wallX * ts) | 0;
      if (side === 0 && rayX > 0) texX = ts - texX - 1;
      if (side === 1 && rayY < 0) texX = ts - texX - 1;

      const lineH = Math.round(h / perp);
      const drawStart = Math.max(0, horizon - (lineH >> 1));
      const drawEnd = Math.min(h - 1, horizon + (lineH >> 1));

      let light = 1 - clamp(perp / MAX_DIST, 0, 1);
      light *= side === 1 ? 0.72 : 1;
      light += flash * Math.max(0, 1 - perp / 7);
      light = clamp(light, 0, 1.6);
      const f = (light * 256) | 0;
      const inv = Math.max(0, 256 - f);
      const fr = (FOG_COLOR.r * inv) >> 8;
      const fg = (FOG_COLOR.g * inv) >> 8;
      const fb = (FOG_COLOR.b * inv) >> 8;

      const texStep = ts / lineH;
      let texPos = (drawStart - horizon + (lineH >> 1)) * texStep;
      const col = texX;
      for (let y = drawStart; y <= drawEnd; y += 1) {
        const ty = ((texPos | 0) % ts + ts) % ts;
        texPos += texStep;
        const c = tex.data[ty * ts + col];
        const r = Math.min(255, (((c & 255) * f) >> 8) + fr);
        const g = Math.min(255, ((((c >> 8) & 255) * f) >> 8) + fg);
        const b = Math.min(255, ((((c >> 16) & 255) * f) >> 8) + fb);
        buf[y * w + x] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    }
  }

  // ── スプライト（ビルボード）────────────────────────────────
  #drawSprite(s, player, dirX, dirY, planeX, planeY, invDet, horizon, flash) {
    const w = this.width;
    const h = this.height;
    const buf = this.buf;
    const zbuf = this.zbuf;
    const tex = s.sprite;
    if (!tex) return;

    const relX = s.x - player.x;
    const relY = s.y - player.y;
    const transX = invDet * (dirY * relX - dirX * relY);
    const transY = invDet * (-planeY * relX + planeX * relY);   // 奥行き
    if (transY <= 0.08) return;

    const screenX = Math.round((w / 2) * (1 + transX / transY));
    const scale = s.size ?? 1;
    const spriteH = Math.abs(Math.round((h / transY) * scale));
    const spriteW = Math.round(spriteH * (tex.w / tex.h));
    const vShift = Math.round(((s.vOffset ?? 0) / transY) * h);
    const centerY = horizon + vShift + Math.round((h / transY) * (0.5 - scale * 0.5));

    const drawStartY = Math.max(0, centerY - (spriteH >> 1));
    const drawEndY = Math.min(h - 1, centerY + (spriteH >> 1));
    const drawStartX = Math.max(0, screenX - (spriteW >> 1));
    const drawEndX = Math.min(w - 1, screenX + (spriteW >> 1));
    if (spriteH <= 0 || spriteW <= 0) return;

    let light = 1 - clamp(transY / MAX_DIST, 0, 1);
    light += flash * Math.max(0, 1 - transY / 7);
    light = clamp(light * (s.light ?? 1), 0, 1.8);
    const f = (light * 256) | 0;
    const inv = Math.max(0, 256 - f);
    const fr = (FOG_COLOR.r * inv) >> 8;
    const fg = (FOG_COLOR.g * inv) >> 8;
    const fb = (FOG_COLOR.b * inv) >> 8;
    const alpha = clamp(s.alpha ?? 1, 0, 1);
    const tint = clamp(s.tint ?? 0, 0, 1);     // 1 で真っ白（被弾フラッシュ）

    for (let x = drawStartX; x <= drawEndX; x += 1) {
      if (transY >= zbuf[x]) continue;
      const tx = (((x - (screenX - (spriteW >> 1))) * tex.w) / spriteW) | 0;
      if (tx < 0 || tx >= tex.w) continue;
      for (let y = drawStartY; y <= drawEndY; y += 1) {
        const ty = (((y - (centerY - (spriteH >> 1))) * tex.h) / spriteH) | 0;
        if (ty < 0 || ty >= tex.h) continue;
        const c = tex.data[ty * tex.w + tx];
        const a = ((c >>> 24) & 255) / 255 * alpha;
        if (a <= 0.02) continue;
        let r = Math.min(255, (((c & 255) * f) >> 8) + fr);
        let g = Math.min(255, ((((c >> 8) & 255) * f) >> 8) + fg);
        let b = Math.min(255, ((((c >> 16) & 255) * f) >> 8) + fb);
        if (tint > 0) {
          r = r + (255 - r) * tint;
          g = g + (255 - g) * tint;
          b = b + (255 - b) * tint;
        }
        const idx = y * w + x;
        if (a >= 0.99) {
          buf[idx] = 0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
        } else {
          const d = buf[idx];
          const dr = d & 255;
          const dg = (d >> 8) & 255;
          const db = (d >> 16) & 255;
          const nr = (dr + (r - dr) * a) | 0;
          const ng = (dg + (g - dg) * a) | 0;
          const nb = (db + (b - db) * a) | 0;
          buf[idx] = 0xff000000 | (nb << 16) | (ng << 8) | nr;
        }
      }
    }
  }
}
