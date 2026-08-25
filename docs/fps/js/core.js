// ============================================================
// core.js — FPS の純粋ロジック（マップ・レイキャスト・当たり判定・AI）
// DOM / Canvas に依存しないため Node からもテストできる
// ============================================================

// ── 数学ユーティリティ ──────────────────────────────────────
export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** -PI..PI に正規化した角度差 */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

export function distance(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

/** 決定的な擬似乱数（テストで再現できるように） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng, lo, hi) => lo + rng() * (hi - lo);
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ── マップ ──────────────────────────────────────────────────
// '.' 床 / '1'〜'5' 壁の種類 / 'S' プレイヤー開始地点
export const MAP_ROWS = [
  '1111111111111111111111111111',
  '1..........1..........1....1',
  '1.222.222..1..333.33..1.44.1',
  '1.2.....2.....3....3....44.1',
  '1.2.....2..1..3....3..1....1',
  '1.2.....2..1..33.333..1..1.1',
  '1.222.222..1..........1..1.1',
  '1..........1..........1..1.1',
  '1..111111..1..111111..1..1.1',
  '1.......1..1..1.......1....1',
  '1.5555..1.....1..5555......1',
  '1....5..1..1..1..5....111111',
  '1....5.....1.....5.........1',
  '1..S.5..1..1..1..5..1..222.1',
  '1....5..1..1..1..5..1..2...1',
  '1....5..1..1..1..5..1..2.2.1',
  '1.......1..1..1.....1....2.1',
  '1..111111..1..1111111..222.1',
  '1..........1...............1',
  '1..44444...1...3333333..44.1',
  '1......4...1...3.....3..44.1',
  '1......4.......3.....3.....1',
  '1..44444...1...3.....3..1..1',
  '1..........1...33.333...1..1',
  '1.222222...1...........11..1',
  '1......2...........1.......1',
  '1......2....1......1.......1',
  '1111111111111111111111111111',
];

/**
 * 文字列マップを解析する。
 * @returns {{w:number,h:number,cells:Uint8Array,spawn:{x:number,y:number},open:Array<{x:number,y:number}>}}
 */
export function parseMap(rows = MAP_ROWS) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const cells = new Uint8Array(w * h);
  let spawn = { x: 1.5, y: 1.5 };
  const open = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const ch = rows[y][x] ?? '1';
      if (ch >= '1' && ch <= '9') {
        cells[y * w + x] = Number(ch);
      } else {
        cells[y * w + x] = 0;
        if (ch === 'S') spawn = { x: x + 0.5, y: y + 0.5 };
        open.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  return { w, h, cells, spawn, open };
}

/** マップ外は壁扱い（レイが無限に伸びないようにする） */
export function tileAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return 1;
  return map.cells[y * map.w + x];
}

export function isSolid(map, x, y) {
  return tileAt(map, Math.floor(x), Math.floor(y)) > 0;
}

/**
 * DDA レイキャスト。壁までの距離とテクスチャ座標を返す。
 * dx,dy は正規化済みのベクトルを想定。
 */
export function castRay(map, ox, oy, dx, dy, maxDist = 64) {
  let mapX = Math.floor(ox);
  let mapY = Math.floor(oy);
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let stepX, stepY, sideX, sideY;
  if (dx < 0) { stepX = -1; sideX = (ox - mapX) * deltaX; } else { stepX = 1; sideX = (mapX + 1 - ox) * deltaX; }
  if (dy < 0) { stepY = -1; sideY = (oy - mapY) * deltaY; } else { stepY = 1; sideY = (mapY + 1 - oy) * deltaY; }

  let dist = 0;
  let side = 0;
  for (let guard = 0; guard < 512; guard += 1) {
    if (sideX < sideY) { dist = sideX; sideX += deltaX; mapX += stepX; side = 0; }
    else { dist = sideY; sideY += deltaY; mapY += stepY; side = 1; }
    if (dist > maxDist) break;
    const tile = tileAt(map, mapX, mapY);
    if (tile > 0) {
      const hitX = ox + dx * dist;
      const hitY = oy + dy * dist;
      let tex = side === 0 ? hitY - Math.floor(hitY) : hitX - Math.floor(hitX);
      if (side === 0 && dx > 0) tex = 1 - tex;
      if (side === 1 && dy < 0) tex = 1 - tex;
      return { hit: true, dist, side, tile, mapX, mapY, tex, hitX, hitY };
    }
  }
  return {
    hit: false, dist: maxDist, side: 0, tile: 0, mapX, mapY, tex: 0,
    hitX: ox + dx * maxDist, hitY: oy + dy * maxDist,
  };
}

function circleBlocked(map, x, y, r) {
  return (
    isSolid(map, x - r, y - r) || isSolid(map, x + r, y - r) ||
    isSolid(map, x - r, y + r) || isSolid(map, x + r, y + r) ||
    isSolid(map, x, y)
  );
}

/** 壁ずりありの移動。X と Y を別々に判定して引っかかりを減らす */
export function moveEntity(map, x, y, dx, dy, radius = 0.24) {
  // すでに壁へめり込んでいる場合は点判定に落として脱出できるようにする
  const r = circleBlocked(map, x, y, radius) ? 0 : radius;
  let nx = x;
  let ny = y;
  if (!circleBlocked(map, x + dx, y, r)) nx = x + dx;
  if (!circleBlocked(map, nx, y + dy, r)) ny = y + dy;
  return { x: nx, y: ny };
}

/** 2 点間に壁がないか */
export function hasLineOfSight(map, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const r = castRay(map, ax, ay, dx / len, dy / len, len);
  return !r.hit || r.dist >= len - 1e-3;
}

// ── 経路探索（プレイヤーへ向かうフローフィールド）──────────
/**
 * プレイヤーのいるマスからの BFS 距離マップ。到達できないマスは -1。
 * 28x28 程度なので毎フレーム作り直しても十分軽い。
 */
export function buildFlowField(map, tx, ty) {
  const n = map.w * map.h;
  const field = new Int32Array(n).fill(-1);
  const sx = clamp(Math.floor(tx), 0, map.w - 1);
  const sy = clamp(Math.floor(ty), 0, map.h - 1);
  const start = sy * map.w + sx;
  if (map.cells[start] > 0) return field;          // 壁の中なら諦める
  field[start] = 0;
  const queue = new Int32Array(n);
  queue[0] = start;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % map.w;
    const cy = (cur - cx) / map.w;
    const d = field[cur] + 1;
    for (let k = 0; k < 4; k += 1) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const idx = ny * map.w + nx;
      if (field[idx] >= 0 || map.cells[idx] > 0) continue;
      field[idx] = d;
      queue[tail++] = idx;
    }
  }
  return field;
}

/** フローフィールドをたどって次に進むべき方向（正規化済み）を返す */
export function flowStep(map, field, x, y) {
  if (!field) return null;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h) return null;
  const here = field[cy * map.w + cx];
  if (here < 0) return null;
  if (here === 0) return null;                     // すでに同じマスにいる
  let best = here;
  let bx = cx;
  let by = cy;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      // 斜め移動は角を突き抜けないときだけ許可する
      if (dx !== 0 && dy !== 0 && (tileAt(map, nx, cy) > 0 || tileAt(map, cx, ny) > 0)) continue;
      const d = field[ny * map.w + nx];
      if (d < 0 || d >= best) continue;
      best = d;
      bx = nx;
      by = ny;
    }
  }
  if (bx === cx && by === cy) return null;
  const dx = bx + 0.5 - x;
  const dy = by + 0.5 - y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// ── 射撃の当たり判定 ────────────────────────────────────────
/**
 * 円柱（敵）とレイの交差。手前側の交点までの距離を返す。当たらなければ null。
 */
export function rayCircleHit(ox, oy, dx, dy, cx, cy, radius) {
  const mx = ox - cx;
  const my = oy - cy;
  const b = mx * dx + my * dy;
  const c = mx * mx + my * my - radius * radius;
  if (c > 0 && b > 0) return null;      // 円の外側かつ遠ざかる向き
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;                 // 内側にいる場合は 0
}

/**
 * レイ上でもっとも手前の敵を返す。wallDist より奥のヒットは壁に遮られたとみなす。
 * @param {Array} enemies {x,y,radius,alive} を持つ配列
 */
export function pickEnemyHit(enemies, ox, oy, dx, dy, wallDist = Infinity) {
  let best = null;
  for (const e of enemies) {
    if (!e.alive) continue;
    const t = rayCircleHit(ox, oy, dx, dy, e.x, e.y, e.radius ?? 0.35);
    if (t === null || t > wallDist) continue;
    if (!best || t < best.dist) best = { enemy: e, dist: t };
  }
  return best;
}

/** 方向ベクトルを angle ラジアン回転する */
export function rotate(dx, dy, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

// ── 武器 ────────────────────────────────────────────────────
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'ハンドガン', slot: 1, ammo: null,
    damage: 26, pellets: 1, spread: 0.006, interval: 0.26, auto: false,
    range: 40, recoil: 0.7, kick: 0.010, shake: 2.2, sound: 'pistol',
  },
  shotgun: {
    id: 'shotgun', name: 'ショットガン', slot: 2, ammo: 'shell',
    damage: 13, pellets: 9, spread: 0.10, interval: 0.78, auto: false,
    range: 22, recoil: 1.7, kick: 0.030, shake: 7, sound: 'shotgun',
  },
  smg: {
    id: 'smg', name: 'サブマシンガン', slot: 3, ammo: 'bullet',
    damage: 11, pellets: 1, spread: 0.045, interval: 0.075, auto: true,
    range: 36, recoil: 0.5, kick: 0.008, shake: 1.6, sound: 'smg',
  },
};

/** 距離による威力減衰（近いほど強い。ショットガンで効く） */
export function damageAtRange(weapon, d) {
  const falloff = clamp(1 - (d / weapon.range) * 0.55, 0.45, 1);
  return weapon.damage * falloff;
}

// ── 敵 ──────────────────────────────────────────────────────
export const ENEMY_TYPES = {
  grunt: {
    id: 'grunt', name: 'グラント', hp: 60, speed: 1.9, radius: 0.34,
    attackRange: 1.15, attackDamage: 9, attackInterval: 1.0, score: 100, ranged: false, size: 0.95,
  },
  shooter: {
    id: 'shooter', name: 'シューター', hp: 45, speed: 1.5, radius: 0.32,
    attackRange: 9.5, attackDamage: 11, attackInterval: 1.8, score: 150, ranged: true, size: 0.92,
    keepDistance: 4.5, projectileSpeed: 6.2,
  },
  brute: {
    id: 'brute', name: 'ブルート', hp: 210, speed: 1.25, radius: 0.46,
    attackRange: 1.5, attackDamage: 26, attackInterval: 1.4, score: 320, ranged: false, size: 1.35,
  },
};

/** ウェーブごとの強化倍率 */
export function waveScaling(wave) {
  return {
    hp: 1 + (wave - 1) * 0.14,
    speed: Math.min(1.45, 1 + (wave - 1) * 0.035),
    damage: Math.min(2.0, 1 + (wave - 1) * 0.06),
  };
}

/** ウェーブの敵構成 */
export function waveComposition(wave) {
  const grunt = 3 + Math.floor(wave * 1.5);
  const shooter = wave >= 2 ? 1 + Math.floor((wave - 1) * 0.8) : 0;
  const brute = wave >= 4 ? Math.floor((wave - 2) / 3) + 1 : 0;
  return { grunt, shooter, brute };
}

export function totalEnemies(wave) {
  const c = waveComposition(wave);
  return c.grunt + c.shooter + c.brute;
}

/** ウェーブ構成を敵タイプの配列に展開する（出現順は混ぜる） */
export function waveQueue(wave, rng = Math.random) {
  const c = waveComposition(wave);
  const list = [];
  for (let i = 0; i < c.grunt; i += 1) list.push('grunt');
  for (let i = 0; i < c.shooter; i += 1) list.push('shooter');
  for (let i = 0; i < c.brute; i += 1) list.push('brute');
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function makeEnemy(type, x, y, wave, id = 0) {
  const base = ENEMY_TYPES[type];
  const s = waveScaling(wave);
  const hp = Math.round(base.hp * s.hp);
  return {
    id, type, x, y, alive: true,
    hp, maxHp: hp,
    speed: base.speed * s.speed,
    damage: base.attackDamage * s.damage,
    radius: base.radius,
    size: base.size,
    state: 'idle',      // idle | chase | attack | hurt | dead
    stateTime: 0,
    cooldown: randRange(Math.random, 0, 0.4),
    anim: Math.random() * 10,
    hurtFlash: 0,
    deadTime: 0,
    score: base.score,
  };
}

/** プレイヤーから minDist 以上離れた床タイルを選ぶ */
export function chooseSpawn(map, rng, px, py, minDist = 7, field = null) {
  const reachable = (p) => !field || field[Math.floor(p.y) * map.w + Math.floor(p.x)] >= 0;
  const far = map.open.filter((p) => dist2(p.x, p.y, px, py) >= minDist * minDist && reachable(p));
  const pool = far.length > 0 ? far : map.open.filter(reachable);
  return pick(rng, pool.length > 0 ? pool : map.open);
}

/**
 * 敵 1 体分の思考と移動。副作用は enemy とイベント配列のみ。
 * @returns {Array} 発生したイベント（{type:'melee'|'shoot', ...}）
 */
export function stepEnemy(enemy, map, player, dt, events = [], field = null) {
  const base = ENEMY_TYPES[enemy.type];
  enemy.anim += dt;
  enemy.stateTime += dt;
  enemy.cooldown = Math.max(0, enemy.cooldown - dt);
  enemy.hurtFlash = Math.max(0, enemy.hurtFlash - dt);

  if (!enemy.alive) {
    enemy.deadTime += dt;
    return events;
  }

  const d = distance(enemy.x, enemy.y, player.x, player.y);
  const sees = hasLineOfSight(map, enemy.x, enemy.y, player.x, player.y);

  if (enemy.state === 'hurt') {
    if (enemy.stateTime > 0.22) setState(enemy, 'chase');
    return events;
  }
  if (enemy.state === 'attack') {
    if (enemy.stateTime > 0.35) setState(enemy, 'chase');
    return events;
  }
  if (enemy.state === 'idle') {
    // 見つけたら追跡。見えなくてもしばらくすると足音を頼りに動き出す
    if ((sees && d < 18) || enemy.stateTime > 4) setState(enemy, 'chase');
    return events;
  }

  // chase
  const dirX = (player.x - enemy.x) / (d || 1);
  const dirY = (player.y - enemy.y) / (d || 1);

  if (sees && d <= base.attackRange && enemy.cooldown <= 0) {
    enemy.cooldown = base.attackInterval;
    setState(enemy, 'attack');
    events.push({ type: base.ranged ? 'shoot' : 'melee', enemy, damage: enemy.damage, dirX, dirY });
    return events;
  }

  let mx = dirX;
  let my = dirY;
  if (!sees) {
    // 見えていないときはフローフィールドをたどって回り込む
    const flow = flowStep(map, field, enemy.x, enemy.y);
    if (flow) { mx = flow.x; my = flow.y; }
    else {
      const s = rotate(dirX, dirY, Math.sin(enemy.anim * 1.7 + enemy.id * 2.3) * 1.2);
      mx = s.x; my = s.y;
    }
  } else if (base.ranged && d < base.keepDistance) {
    mx = -dirX; my = -dirY;                        // 近すぎたら後ずさり
  } else if (base.ranged) {
    const s = rotate(dirX, dirY, Math.sin(enemy.anim * 0.9 + enemy.id) * 0.9);
    mx = s.x; my = s.y;                            // 横に揺れながら接近
  }

  const step = enemy.speed * dt;
  const fromX = enemy.x;
  const fromY = enemy.y;
  const attempt = (vx, vy) => {
    const m = moveEntity(map, enemy.x, enemy.y, vx * step, vy * step, enemy.radius);
    return { m, progress: distance(enemy.x, enemy.y, m.x, m.y) };
  };

  let best = attempt(mx, my);
  // 見えていても壁の角で直進できないことがある。その場合は経路をたどる
  if (best.progress < step * 0.6 && sees) {
    const flow = flowStep(map, field, enemy.x, enemy.y);
    if (flow) {
      const alt = attempt(flow.x, flow.y);
      if (alt.progress > best.progress) {
        best = alt;
        mx = flow.x;
        my = flow.y;
      }
    }
  }
  let moved = best.m;
  enemy.x = moved.x;
  enemy.y = moved.y;

  // 壁ずりで少しずつ進めている間は放っておく。完全に止まったときだけ回り込む
  if (distance(fromX, fromY, enemy.x, enemy.y) < step * 0.2) {
    enemy.stuckTime = (enemy.stuckTime ?? 0) + dt;
  } else {
    enemy.stuckTime = 0;
    enemy.dodgeTime = 0;
  }
  if (enemy.stuckTime > 0.35) {
    enemy.dodgeTime = (enemy.dodgeTime ?? 0) - dt;
    if (enemy.dodgeTime <= 0) {
      enemy.dodge = -(enemy.dodge || (enemy.id % 2 === 0 ? 1 : -1));
      enemy.dodgeTime = 0.6;
    }
    const side = rotate(mx, my, enemy.dodge * Math.PI * 0.5);
    moved = moveEntity(map, enemy.x, enemy.y, side.x * step, side.y * step, enemy.radius);
    enemy.x = moved.x;
    enemy.y = moved.y;
  }
  return events;
}

function setState(enemy, state) {
  enemy.state = state;
  enemy.stateTime = 0;
}

/** ダメージ適用。倒したら true */
export function damageEnemy(enemy, amount) {
  if (!enemy.alive) return false;
  enemy.hp -= amount;
  enemy.hurtFlash = 0.12;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.alive = false;
    enemy.state = 'dead';
    enemy.stateTime = 0;
    enemy.deadTime = 0;
    return true;
  }
  if (enemy.state !== 'attack') setState(enemy, 'hurt');
  return false;
}

/** 撃破スコア（ウェーブが進むほど高い） */
export function scoreForKill(enemy, wave, combo = 1) {
  return Math.round(enemy.score * (1 + (wave - 1) * 0.1) * combo);
}

// ── プレイヤー ──────────────────────────────────────────────
export const PLAYER = {
  radius: 0.24,
  maxHp: 100,
  speed: 3.4,
  sprintMul: 1.55,
  maxAmmo: { shell: 60, bullet: 300 },
};

export function makePlayer(spawn) {
  return {
    x: spawn.x, y: spawn.y, angle: 0, pitch: 0,
    hp: PLAYER.maxHp,
    weapon: 'pistol',
    owned: { pistol: true, shotgun: false, smg: false },
    ammo: { shell: 0, bullet: 0 },
    cooldown: 0, bob: 0, kick: 0,
  };
}

export function hasAmmo(player, weaponId) {
  const w = WEAPONS[weaponId];
  if (!w.ammo) return true;
  return (player.ammo[w.ammo] ?? 0) > 0;
}

export function addAmmo(player, kind, amount) {
  const max = PLAYER.maxAmmo[kind] ?? 999;
  const before = player.ammo[kind] ?? 0;
  player.ammo[kind] = clamp(before + amount, 0, max);
  return player.ammo[kind] - before;
}

export function healPlayer(player, amount) {
  const before = player.hp;
  player.hp = clamp(player.hp + amount, 0, PLAYER.maxHp);
  return player.hp - before;
}

/** 所持している武器のうち次（dir=+1）/前（dir=-1）のものへ */
export function cycleWeapon(player, dir) {
  const order = ['pistol', 'shotgun', 'smg'].filter((id) => player.owned[id]);
  if (order.length === 0) return player.weapon;
  const i = order.indexOf(player.weapon);
  const next = order[(i + dir + order.length * 2) % order.length];
  return next;
}

// ── ハイスコア ──────────────────────────────────────────────
export const HISCORE_KEY = 'fps.hiscore.v1';

export function readHiscore(storage) {
  try {
    const v = Number(storage?.getItem(HISCORE_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

export function writeHiscore(storage, score) {
  const best = Math.max(readHiscore(storage), Math.round(score) || 0);
  try { storage?.setItem(HISCORE_KEY, String(best)); } catch { /* 保存できなくても続行 */ }
  return best;
}
