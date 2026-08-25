// ============================================================
// game.js — ゲーム進行（ウェーブ制サバイバル）とメインループ
// ============================================================
import {
  parseMap, MAP_ROWS, makePlayer, PLAYER, WEAPONS, ENEMY_TYPES,
  makeEnemy, stepEnemy, damageEnemy, damageAtRange, scoreForKill,
  waveQueue, totalEnemies, chooseSpawn, castRay, pickEnemyHit, moveEntity,
  buildFlowField,
  hasAmmo, addAmmo, healPlayer, cycleWeapon, distance,
  mulberry32, randRange, clamp, rotate, isSolid, readHiscore, writeHiscore,
} from './core.js';
import { buildAssets } from './assets.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';

const INTERMISSION = 5;

// パーティクルの見た目（種類ごと）
const PARTICLE_STYLE = {
  blood: { spread: 1.0, vz: [0.3, 1.5], life: [0.25, 0.5], size: [0.025, 0.06], light: 1.0 },
  spark: { spread: 1.3, vz: [0.4, 1.8], life: [0.15, 0.35], size: [0.02, 0.045], light: 1.5 },
  goo: { spread: 1.0, vz: [0.3, 1.4], life: [0.25, 0.5], size: [0.03, 0.06], light: 1.2 },
  smoke: { spread: 0.4, vz: [0.4, 1.0], life: [0.5, 0.9], size: [0.06, 0.14], light: 0.9 },
};

export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.assets = buildAssets();
    this.renderer = new Renderer(canvas, this.assets);
    this.hud = new Hud();
    this.input = new Input(canvas);
    this.sfx = new Sfx();
    this.rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
    this.state = 'menu';               // menu | playing | paused | gameover
    this.qualityMode = 'auto';
    this.showMap = true;
    this.frameTimes = [];
    this.hiscore = readHiscore(window.localStorage);
    this.touchUi = this.isTouch();

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.isTouch()) this.pause();
    };
    window.addEventListener('resize', () => this.renderer.resize());
    this.reset();
  }

  isTouch() {
    return window.matchMedia('(pointer: coarse)').matches;
  }

  // ── 初期化 ────────────────────────────────────────────────
  reset() {
    this.map = parseMap(MAP_ROWS);
    this.player = makePlayer(this.map.spawn);
    this.player.angle = Math.PI * 0.25;
    this.enemies = [];
    this.items = [];
    this.projectiles = [];
    this.particles = [];
    this.score = 0;
    this.wave = 0;
    this.queue = [];
    this.enemyId = 1;
    this.spawnTimer = 0;
    this.intermission = 2.0;
    this.flowField = null;
    this.flowTile = '';
    this.enemiesLeft = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.elapsed = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.damageFlash = 0;
    this.muzzle = 0;
    this.muzzleSeed = 0;
    this.flash = 0;
    this.shake = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.weaponSwitch = 0;
    this.reloadAnim = 0;
    this.crosshairSpread = 0;
    this.aimingAtEnemy = false;
    this.hud.messages = [];
  }

  start() {
    this.reset();
    this.state = 'playing';
    this.sfx.unlock();
    this.ui.hideAll();
    if (!this.isTouch()) this.input.requestLock();
    this.hud.message('ウェーブ 1 開始まで少し待て', '#7fd4ff', 2.4);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.ui.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hideAll();
    if (!this.isTouch()) this.input.requestLock();
  }

  gameOver() {
    this.state = 'gameover';
    this.input.exitLock();
    this.sfx.play('gameover');
    this.hiscore = writeHiscore(window.localStorage, this.score);
    this.ui.showGameOver(this);
  }

  // ── ウェーブ ──────────────────────────────────────────────
  startWave() {
    this.wave += 1;
    this.queue = waveQueue(this.wave, this.rng);
    this.enemiesLeft = totalEnemies(this.wave);
    this.spawnTimer = 0;
    this.sfx.play('wave');
    this.hud.message(`WAVE ${this.wave} 開始`, '#ff7043', 2.2);

    if (this.wave === 2 && !this.player.owned.shotgun) this.dropWeapon('shotgun');
    if (this.wave === 3 && !this.player.owned.smg) this.dropWeapon('smg');
    if (this.wave % 2 === 0) this.spawnItem('health');
  }

  dropWeapon(kind) {
    const p = this.nearbyFloor(6);
    this.items.push({ kind, x: p.x, y: p.y, sprite: this.assets.items[kind], size: 0.34, bob: this.rng() * 6 });
    this.hud.message(`${WEAPONS[kind].name}がどこかに落ちた`, '#7fd4ff', 2.6);
  }

  nearbyFloor(maxDist = 8) {
    const p = this.player;
    const cands = this.map.open.filter((c) => {
      const d = distance(c.x, c.y, p.x, p.y);
      return d > 2 && d < maxDist;
    });
    const pool = cands.length ? cands : this.map.open;
    return pool[Math.floor(this.rng() * pool.length)];
  }

  spawnItem(kind, at = null) {
    const p = at ?? this.nearbyFloor(10);
    const sprite = this.assets.items[kind];
    this.items.push({ kind, x: p.x, y: p.y, sprite, size: kind === 'health' ? 0.26 : 0.22, bob: this.rng() * 6 });
    // 取り残しが溜まりすぎないよう、古い消耗品から消す
    const consumables = this.items.filter((it) => it.kind !== 'shotgun' && it.kind !== 'smg');
    if (consumables.length > 14) {
      const oldest = consumables[0];
      this.items = this.items.filter((it) => it !== oldest);
    }
  }

  spawnEnemy() {
    const type = this.queue.shift();
    if (!type) return;
    if (!this.flowField) this.flowField = buildFlowField(this.map, this.player.x, this.player.y);
    const spot = chooseSpawn(this.map, this.rng, this.player.x, this.player.y, 8, this.flowField);
    const e = makeEnemy(type, spot.x, spot.y, this.wave, this.enemyId++);
    this.enemies.push(e);
    if (this.rng() < 0.35) this.sfx.play('growl');
  }

  // ── 射撃 ──────────────────────────────────────────────────
  tryFire() {
    const p = this.player;
    const weapon = WEAPONS[p.weapon];
    if (p.cooldown > 0 || this.weaponSwitch > 0) return;
    if (!hasAmmo(p, p.weapon)) {
      p.cooldown = 0.3;
      this.sfx.play('empty');
      this.hud.message('弾切れ！ ハンドガンに切り替えた', '#ef5350', 1.6);
      this.selectWeapon('pistol');               // 手ぶらにならないよう自動で持ち替える
      return;
    }
    p.cooldown = weapon.interval;
    if (weapon.ammo) p.ammo[weapon.ammo] -= 1;
    this.shotsFired += 1;
    this.sfx.play(weapon.sound);
    this.muzzle = 0.06;
    this.muzzleSeed = this.rng() * Math.PI * 2;
    this.flash = 0.55;
    this.shake = weapon.shake;
    p.kick = weapon.kick * 8;
    this.crosshairSpread = Math.min(1, this.crosshairSpread + weapon.recoil * 0.35);
    p.pitch = clamp(p.pitch - weapon.kick * 0.5, -0.9, 0.9);
    if (p.weapon === 'shotgun') this.reloadAnim = 1;

    // 銃声で近くの敵が気づく
    for (const e of this.enemies) {
      if (e.alive && e.state === 'idle' && distance(e.x, e.y, p.x, p.y) < 16) e.state = 'chase';
    }

    let hitAny = false;
    for (let i = 0; i < weapon.pellets; i += 1) {
      const spread = weapon.spread * (0.35 + this.crosshairSpread);
      const ang = randRange(this.rng, -spread, spread) + (i === 0 ? 0 : randRange(this.rng, -spread, spread) * 0.5);
      const dir = rotate(Math.cos(p.angle), Math.sin(p.angle), ang);
      const wall = castRay(this.map, p.x, p.y, dir.x, dir.y, weapon.range);
      const hit = pickEnemyHit(this.enemies, p.x, p.y, dir.x, dir.y, wall.dist);
      if (hit) {
        const dmg = damageAtRange(weapon, hit.dist);
        const killed = damageEnemy(hit.enemy, dmg);
        hitAny = true;
        this.spawnParticles('blood', p.x + dir.x * hit.dist, p.y + dir.y * hit.dist, 0.55, killed ? 14 : 4);
        if (killed) this.onKill(hit.enemy);
      } else if (wall.hit) {
        this.spawnParticles('spark', wall.hitX - dir.x * 0.02, wall.hitY - dir.y * 0.02, 0.5, 3);
      }
    }
    if (hitAny) {
      this.shotsHit += 1;
      this.hud.hitMarker = 0.25;
      this.sfx.play('hit');
    }
  }

  onKill(enemy) {
    this.comboTimer = 2.5;
    this.combo = Math.min(4, this.combo + 1);
    const gained = scoreForKill(enemy, this.wave, 1 + (this.combo - 1) * 0.25);
    this.score += gained;
    this.kills += 1;
    this.enemiesLeft = Math.max(0, this.enemiesLeft - 1);
    this.sfx.play('kill');
    if (this.combo >= 2) this.hud.message(`${this.combo} KILL COMBO ×${(1 + (this.combo - 1) * 0.25).toFixed(2)}`, '#ffd54f', 1.4);
    // ドロップ
    const r = this.rng();
    if (r < 0.16) this.spawnItem('health', { x: enemy.x, y: enemy.y });
    else if (r < 0.42 && this.player.owned.smg) this.spawnItem('bullet', { x: enemy.x, y: enemy.y });
    else if (r < 0.6 && this.player.owned.shotgun) this.spawnItem('shell', { x: enemy.x, y: enemy.y });
  }

  spawnParticles(kind, x, y, z, count) {
    const sprite = this.assets.particles[kind];
    const cfg = PARTICLE_STYLE[kind] ?? PARTICLE_STYLE.spark;
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        x, y, z,
        vx: randRange(this.rng, -cfg.spread, cfg.spread),
        vy: randRange(this.rng, -cfg.spread, cfg.spread),
        vz: randRange(this.rng, cfg.vz[0], cfg.vz[1]),
        life: randRange(this.rng, cfg.life[0], cfg.life[1]),
        size: randRange(this.rng, cfg.size[0], cfg.size[1]),
        light: cfg.light,
        sprite,
      });
    }
  }

  hurtPlayer(amount) {
    const p = this.player;
    p.hp -= amount;
    this.damageFlash = Math.min(1, this.damageFlash + 0.5 + amount / 60);
    this.shake = Math.max(this.shake, 6);
    this.sfx.play('hurt');
    this.combo = 0;
    if (p.hp <= 0) {
      p.hp = 0;
      this.gameOver();
    }
  }

  // ── 更新 ──────────────────────────────────────────────────
  update(dt) {
    const p = this.player;
    this.elapsed += dt;

    // 視点
    const look = this.input.takeLook();
    p.angle += look.dx;
    p.pitch = clamp(p.pitch + look.dy * 0.6, -0.55, 0.55);
    if (this.input.isDown('turnLeft')) p.angle -= 2.2 * dt;
    if (this.input.isDown('turnRight')) p.angle += 2.2 * dt;
    this.swayX += (clamp(-look.dx * 14, -1, 1) - this.swayX) * Math.min(1, dt * 6);
    this.swayY += (clamp(-look.dy * 10, -1, 1) - this.swayY) * Math.min(1, dt * 6);

    // 移動
    const axis = this.input.moveAxis();
    const sprint = this.input.isDown('sprint') ? PLAYER.sprintMul : 1;
    const speed = PLAYER.speed * sprint;
    const fx = Math.cos(p.angle);
    const fy = Math.sin(p.angle);
    const dx = (fx * axis.y - fy * axis.x) * speed * dt;
    const dy = (fy * axis.y + fx * axis.x) * speed * dt;
    const moved = moveEntity(this.map, p.x, p.y, dx, dy, PLAYER.radius);
    const movedDist = distance(p.x, p.y, moved.x, moved.y);
    p.x = moved.x;
    p.y = moved.y;

    // 揺れ
    const speedRatio = clamp(movedDist / (PLAYER.speed * PLAYER.sprintMul * dt || 1), 0, 1);
    this.bobPhase += movedDist * 9;
    this.bobAmount += (speedRatio - this.bobAmount) * Math.min(1, dt * 8);
    p.bobZ = Math.sin(this.bobPhase) * 0.012 * this.bobAmount;

    // 武器の切り替え
    if (this.input.consumePressed('weapon1')) this.selectWeapon('pistol');
    if (this.input.consumePressed('weapon2')) this.selectWeapon('shotgun');
    if (this.input.consumePressed('weapon3')) this.selectWeapon('smg');
    if (this.input.consumePressed('nextWeapon')) this.selectWeapon(cycleWeapon(p, 1));
    if (this.input.consumePressed('prevWeapon')) this.selectWeapon(cycleWeapon(p, -1));
    if (this.input.consumePressed('swapWeapon')) this.selectWeapon(cycleWeapon(p, 1));
    if (this.input.consumePressed('map')) this.showMap = !this.showMap;

    // 射撃
    const weapon = WEAPONS[p.weapon];
    const tapped = this.input.consumePressed('fire');   // ボタンを短く押しただけでも撃てるように
    const held = this.input.firing || this.input.isDown('fire');
    if (tapped || (held && (weapon.auto || !this.prevFire))) this.tryFire();
    this.prevFire = held;

    p.cooldown = Math.max(0, p.cooldown - dt);
    p.kick += (0 - p.kick) * Math.min(1, dt * 12);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.shake = Math.max(0, this.shake - dt * 26);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.3);
    this.weaponSwitch = Math.max(0, this.weaponSwitch - dt * 4);
    this.reloadAnim = Math.max(0, this.reloadAnim - dt * 2.2);
    this.crosshairSpread = Math.max(0, this.crosshairSpread - dt * 1.6);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    this.updateWave(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateItems(dt);
    this.updateParticles(dt);
    this.updateAim();
    this.hud.update(dt);
    this.input.endFrame();
  }

  selectWeapon(id) {
    const p = this.player;
    if (!id || !p.owned[id] || p.weapon === id) return;
    p.weapon = id;
    this.weaponSwitch = 1;
    this.sfx.play('switch');
  }

  updateWave(dt) {
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startWave();
      return;
    }
    const alive = this.enemies.filter((e) => e.alive).length;
    const maxAlive = Math.min(16, 4 + this.wave * 2);
    if (this.queue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && alive < maxAlive) {
        this.spawnEnemy();
        this.spawnTimer = Math.max(0.35, 1.4 - this.wave * 0.06);
      }
    } else if (alive === 0) {
      this.intermission = INTERMISSION;
      const bonus = 200 * this.wave;
      this.score += bonus;
      this.hud.message(`WAVE ${this.wave} クリア！ +${bonus}`, '#3ddc84', 2.6);
      healPlayer(this.player, 15);
      this.spawnItem('health');
      if (this.player.owned.shotgun) this.spawnItem('shell');
      if (this.player.owned.smg) this.spawnItem('bullet');
    }
  }

  updateEnemies(dt) {
    // プレイヤーが別のマスへ移った時だけ経路を作り直す
    const tile = `${Math.floor(this.player.x)},${Math.floor(this.player.y)}`;
    if (tile !== this.flowTile) {
      this.flowTile = tile;
      this.flowField = buildFlowField(this.map, this.player.x, this.player.y);
    }

    const events = [];
    for (const e of this.enemies) {
      stepEnemy(e, this.map, this.player, dt, events, this.flowField);
    }
    this.separateEnemies();
    for (const ev of events) {
      if (ev.type === 'melee') {
        const d = distance(ev.enemy.x, ev.enemy.y, this.player.x, this.player.y);
        if (d <= ENEMY_TYPES[ev.enemy.type].attackRange + 0.35) this.hurtPlayer(ev.damage);
      } else if (ev.type === 'shoot') {
        const base = ENEMY_TYPES[ev.enemy.type];
        const jitter = randRange(this.rng, -0.05, 0.05);
        const dir = rotate(ev.dirX, ev.dirY, jitter);
        this.projectiles.push({
          x: ev.enemy.x + dir.x * 0.4,
          y: ev.enemy.y + dir.y * 0.4,
          vx: dir.x * base.projectileSpeed,
          vy: dir.y * base.projectileSpeed,
          damage: ev.damage,
          life: 4,
          sprite: this.assets.plasma,
        });
        this.sfx.play('enemyShoot');
      }
    }
    // 死体の後始末
    this.enemies = this.enemies.filter((e) => e.alive || e.deadTime < 1.6);
  }

  /** 敵同士が重ならないよう軽く押し合う */
  separateEnemies() {
    const list = this.enemies.filter((e) => e.alive);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        const ma = moveEntity(this.map, a.x, a.y, -nx * push, -ny * push, a.radius);
        const mb = moveEntity(this.map, b.x, b.y, nx * push, ny * push, b.radius);
        a.x = ma.x; a.y = ma.y;
        b.x = mb.x; b.y = mb.y;
      }
    }
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (const b of this.projectiles) {
      b.life -= dt;
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      if (isSolid(this.map, nx, ny)) {
        b.life = 0;
        this.spawnParticles('spark', b.x, b.y, 0.5, 5);
        this.sfx.play('plasmaHit');
        continue;
      }
      b.x = nx;
      b.y = ny;
      if (distance(b.x, b.y, p.x, p.y) < 0.4) {
        b.life = 0;
        this.hurtPlayer(b.damage);
        this.spawnParticles('spark', b.x, b.y, 0.5, 6);
      }
    }
    this.projectiles = this.projectiles.filter((b) => b.life > 0);
  }

  updateItems(dt) {
    const p = this.player;
    const kept = [];
    for (const it of this.items) {
      it.bob += dt * 3;
      if (distance(it.x, it.y, p.x, p.y) < 0.6) {
        if (this.collectItem(it)) continue;
      }
      kept.push(it);
    }
    this.items = kept;
  }

  collectItem(it) {
    const p = this.player;
    if (it.kind === 'health') {
      if (p.hp >= PLAYER.maxHp) return false;
      const got = healPlayer(p, 30);
      this.hud.message(`体力 +${got}`, '#3ddc84', 1.2);
    } else if (it.kind === 'shell' || it.kind === 'bullet') {
      const amount = it.kind === 'shell' ? 12 : 60;
      const got = addAmmo(p, it.kind, amount);
      if (got === 0) return false;
      this.hud.message(`${it.kind === 'shell' ? 'シェル' : '9mm 弾'} +${got}`, '#ffd54f', 1.2);
    } else {
      p.owned[it.kind] = true;
      addAmmo(p, WEAPONS[it.kind].ammo, it.kind === 'shotgun' ? 24 : 120);
      this.selectWeapon(it.kind);
      this.hud.message(`${WEAPONS[it.kind].name}を入手！`, '#7fd4ff', 2.2);
      this.sfx.play('weapon');
      return true;
    }
    this.sfx.play('pickup');
    return true;
  }

  updateParticles(dt) {
    for (const q of this.particles) {
      q.life -= dt;
      q.vz -= 9 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      if (q.z < 0.03) { q.z = 0.03; q.vz = 0; q.vx *= 0.5; q.vy *= 0.5; }
    }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  /** 照準先に敵がいるか（クロスヘアの色に使う）*/
  updateAim() {
    const p = this.player;
    const dirX = Math.cos(p.angle);
    const dirY = Math.sin(p.angle);
    const wall = castRay(this.map, p.x, p.y, dirX, dirY, 40);
    const hit = pickEnemyHit(this.enemies, p.x, p.y, dirX, dirY, wall.dist);
    this.aimingAtEnemy = !!hit;
  }

  // ── 描画 ──────────────────────────────────────────────────
  buildSprites() {
    const sprites = [];
    for (const e of this.enemies) {
      const frames = this.assets.monsters[e.type];
      let frame;
      if (!e.alive) frame = 3;
      else if (e.state === 'attack') frame = 2;
      else if (e.hurtFlash > 0) frame = 3;
      else frame = Math.floor(e.anim * 5) % 2;
      const deathT = e.alive ? 0 : clamp(e.deadTime / 1.2, 0, 1);
      sprites.push({
        x: e.x, y: e.y,
        sprite: frames[frame],
        size: e.size * (1 - deathT * 0.55),
        vOffset: deathT * 0.32,
        alpha: e.alive ? 1 : 1 - Math.max(0, (deathT - 0.6) / 0.4),
        tint: e.hurtFlash > 0 ? 0.55 : 0,
      });
    }
    for (const b of this.projectiles) {
      sprites.push({ x: b.x, y: b.y, sprite: b.sprite, size: 0.3, vOffset: -0.3, light: 1.6, alpha: 1 });
    }
    for (const it of this.items) {
      const hover = Math.sin(it.bob) * 0.015;
      sprites.push({ x: it.x, y: it.y, sprite: it.sprite, size: it.size, vOffset: -0.03 - hover, light: 1.15 });
    }
    for (const q of this.particles) {
      sprites.push({
        x: q.x, y: q.y, sprite: q.sprite, size: q.size,
        vOffset: -(q.z - q.size / 2),
        alpha: clamp(q.life / 0.25, 0, 1),
        light: q.light ?? 1.2,
      });
    }
    return sprites;
  }

  render() {
    const p = this.player;
    const shakeX = this.shake > 0 ? (this.rng() - 0.5) * this.shake * 0.0016 : 0;
    const shakeY = this.shake > 0 ? (this.rng() - 0.5) * this.shake * 0.0016 : 0;
    this.renderer.render({
      map: this.map,
      player: {
        x: p.x, y: p.y,
        angle: p.angle + shakeX,
        pitch: p.pitch + shakeY,
        bobZ: (p.bobZ ?? 0) - p.kick * 0.05,
      },
      sprites: this.buildSprites(),
      flash: this.flash * 0.5,
    });
    this.hud.draw(this.renderer.ctx, this);
  }

  // ── ループ ────────────────────────────────────────────────
  loop(ts) {
    const now = ts / 1000;
    if (!this.lastTime) this.lastTime = now;
    let dt = now - this.lastTime;
    this.lastTime = now;
    dt = Math.min(dt, 0.05);

    if (this.input.consumePressed('pause')) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }

    if (this.state === 'playing') {
      this.update(dt);
    } else {
      this.input.takeLook();
      this.input.endFrame();
    }
    if (this.state !== 'menu') this.render();
    this.#autoQuality(dt);
    requestAnimationFrame((t) => this.loop(t));
  }

  #autoQuality(dt) {
    if (this.qualityMode !== 'auto' || this.state !== 'playing') return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const q = this.renderer.quality;
    if (avg > 0.021 && q > 0.34) this.renderer.resize(Math.max(0.34, q - 0.07));
    else if (avg < 0.0125 && q < 0.78) this.renderer.resize(Math.min(0.78, q + 0.05));
  }

  run() {
    requestAnimationFrame((t) => this.loop(t));
  }

  accuracy() {
    return this.shotsFired === 0 ? 0 : Math.round((this.shotsHit / this.shotsFired) * 100);
  }
}
