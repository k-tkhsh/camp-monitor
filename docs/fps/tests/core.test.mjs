// node --test docs/fps/tests/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';

const map = core.parseMap();
const openMap = core.parseMap([
  '11111',
  '1...1',
  '1.S.1',
  '1...1',
  '11111',
]);

test('parseMap: 大きさ・開始地点・床の数', () => {
  assert.equal(map.w, 28);
  assert.equal(map.h, 28);
  assert.ok(map.open.length > 100);
  assert.equal(core.tileAt(map, 0, 0), 1);            // 外周は壁
  assert.equal(core.isSolid(map, map.spawn.x, map.spawn.y), false);
  assert.deepEqual(openMap.spawn, { x: 2.5, y: 2.5 });
});

test('tileAt: マップ外は壁として扱う', () => {
  assert.equal(core.tileAt(map, -1, 5), 1);
  assert.equal(core.tileAt(map, 5, 999), 1);
});

test('castRay: 壁までの距離とテクスチャ座標', () => {
  const r = core.castRay(openMap, 2.5, 2.5, 1, 0);
  assert.equal(r.hit, true);
  assert.equal(r.side, 0);
  assert.ok(Math.abs(r.dist - 1.5) < 1e-9);
  assert.ok(r.tex >= 0 && r.tex <= 1);

  const up = core.castRay(openMap, 2.5, 2.5, 0, -1);
  assert.equal(up.side, 1);
  assert.ok(Math.abs(up.dist - 1.5) < 1e-9);

  // 斜めでも必ず壁に当たって終わる（無限ループしない）
  const diag = core.castRay(openMap, 2.5, 2.5, Math.SQRT1_2, Math.SQRT1_2);
  assert.equal(diag.hit, true);
  assert.ok(diag.dist <= 2.2);
});

test('moveEntity: 壁をすり抜けず、壁ずり移動する', () => {
  const straight = core.moveEntity(openMap, 2.5, 2.5, 0.2, 0, 0.2);
  assert.ok(straight.x > 2.5);

  // 右の壁に向かって斜めに進むと X は止まり Y だけ動く
  const slide = core.moveEntity(openMap, 3.6, 2.5, 0.5, 0.3, 0.2);
  assert.ok(slide.x < 3.7, '壁の向こうへは進まない');
  assert.ok(slide.y > 2.5, 'Y 方向へは滑る');
  assert.equal(core.isSolid(openMap, slide.x, slide.y), false);
});

test('hasLineOfSight: 壁を挟むと見えない', () => {
  assert.equal(core.hasLineOfSight(openMap, 1.5, 1.5, 3.5, 3.5), true);
  const walled = core.parseMap([
    '11111',
    '1.1.1',
    '1.1.1',
    '1.1.1',
    '11111',
  ]);
  assert.equal(core.hasLineOfSight(walled, 1.5, 2.5, 3.5, 2.5), false);
});

test('rayCircleHit: 交差判定', () => {
  assert.ok(Math.abs(core.rayCircleHit(0, 0, 1, 0, 5, 0, 1) - 4) < 1e-9);
  assert.equal(core.rayCircleHit(0, 0, 1, 0, 5, 3, 1), null);   // 外れる
  assert.equal(core.rayCircleHit(0, 0, -1, 0, 5, 0, 1), null);  // 逆向き
  assert.equal(core.rayCircleHit(5, 0, 1, 0, 5, 0, 1), 0);      // 内側
});

test('pickEnemyHit: 手前の敵を選び、壁より奥は無視する', () => {
  const enemies = [
    { x: 3, y: 0, radius: 0.35, alive: true, id: 'near' },
    { x: 6, y: 0, radius: 0.35, alive: true, id: 'far' },
    { x: 1, y: 0, radius: 0.35, alive: false, id: 'dead' },
  ];
  const hit = core.pickEnemyHit(enemies, 0, 0, 1, 0, 20);
  assert.equal(hit.enemy.id, 'near');
  const blocked = core.pickEnemyHit(enemies, 0, 0, 1, 0, 1.5);
  assert.equal(blocked, null);
  const miss = core.pickEnemyHit(enemies, 0, 5, 1, 0, 20);
  assert.equal(miss, null);
});

test('damageAtRange: 距離で減衰するが下限がある', () => {
  const w = core.WEAPONS.shotgun;
  const near = core.damageAtRange(w, 0);
  const far = core.damageAtRange(w, w.range);
  assert.equal(near, w.damage);
  assert.ok(far < near);
  assert.ok(far >= w.damage * 0.45 - 1e-9);
});

test('ウェーブ構成は進むほど増える', () => {
  assert.ok(core.totalEnemies(5) > core.totalEnemies(1));
  assert.equal(core.waveComposition(1).shooter, 0);
  assert.ok(core.waveComposition(4).brute > 0);
  const rng = core.mulberry32(7);
  const q = core.waveQueue(3, rng);
  assert.equal(q.length, core.totalEnemies(3));
  assert.deepEqual([...new Set(q)].sort(), ['grunt', 'shooter']);
});

test('makeEnemy: ウェーブが進むと強くなる', () => {
  const a = core.makeEnemy('grunt', 1, 1, 1);
  const b = core.makeEnemy('grunt', 1, 1, 10);
  assert.ok(b.maxHp > a.maxHp);
  assert.ok(b.speed >= a.speed);
  assert.equal(a.alive, true);
});

test('damageEnemy: HP 0 で撃破', () => {
  const e = core.makeEnemy('grunt', 1, 1, 1);
  assert.equal(core.damageEnemy(e, 10), false);
  assert.equal(e.state, 'hurt');
  assert.equal(core.damageEnemy(e, 999), true);
  assert.equal(e.alive, false);
  assert.equal(core.damageEnemy(e, 999), false, '倒した敵は二重に数えない');
});

test('stepEnemy: 見つけたら近づき、間合いで攻撃する', () => {
  const player = { x: 2.5, y: 2.5 };
  const e = core.makeEnemy('grunt', 1.2, 1.2, 1, 1);
  e.cooldown = 0;
  const before = core.distance(e.x, e.y, player.x, player.y);
  core.stepEnemy(e, openMap, player, 0.1);         // idle → chase
  assert.equal(e.state, 'chase');
  for (let i = 0; i < 5; i += 1) core.stepEnemy(e, openMap, player, 0.1);
  assert.ok(core.distance(e.x, e.y, player.x, player.y) < before);

  const close = core.makeEnemy('grunt', 2.5, 3.2, 1, 2);
  close.state = 'chase';
  close.cooldown = 0;
  const events = [];
  core.stepEnemy(close, openMap, player, 0.05, events);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'melee');
  assert.ok(events[0].damage > 0);
  assert.ok(close.cooldown > 0, '連射しないようクールダウンが入る');
});

test('stepEnemy: シューターは弾を撃つイベントを出す', () => {
  const player = { x: 2.5, y: 2.5 };
  const s = core.makeEnemy('shooter', 1.5, 2.5, 1, 3);
  s.state = 'chase';
  s.cooldown = 0;
  const events = [];
  core.stepEnemy(s, openMap, player, 0.05, events);
  assert.equal(events[0].type, 'shoot');
});

test('プレイヤー: 弾薬・回復・武器切替', () => {
  const p = core.makePlayer({ x: 1.5, y: 1.5 });
  assert.equal(core.hasAmmo(p, 'pistol'), true, 'ハンドガンは弾切れしない');
  assert.equal(core.hasAmmo(p, 'shotgun'), false);
  assert.equal(core.addAmmo(p, 'shell', 12), 12);
  assert.equal(core.hasAmmo(p, 'shotgun'), true);
  assert.equal(core.addAmmo(p, 'shell', 9999), core.PLAYER.maxAmmo.shell - 12);

  p.hp = 40;
  assert.equal(core.healPlayer(p, 30), 30);
  assert.equal(core.healPlayer(p, 999), 30, '最大値を超えない');

  assert.equal(core.cycleWeapon(p, 1), 'pistol', '未所持の武器には切り替わらない');
  p.owned.shotgun = true;
  assert.equal(core.cycleWeapon(p, 1), 'shotgun');
  assert.equal(core.cycleWeapon(p, -1), 'shotgun');
});

test('scoreForKill: ウェーブとコンボで増える', () => {
  const e = core.makeEnemy('grunt', 1, 1, 1);
  assert.ok(core.scoreForKill(e, 5, 1) > core.scoreForKill(e, 1, 1));
  assert.ok(core.scoreForKill(e, 1, 2) > core.scoreForKill(e, 1, 1));
});

test('ハイスコアの読み書き', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  assert.equal(core.readHiscore(storage), 0);
  assert.equal(core.writeHiscore(storage, 1200), 1200);
  assert.equal(core.writeHiscore(storage, 800), 1200, '低いスコアで上書きしない');
  assert.equal(core.readHiscore(storage), 1200);
  // localStorage が使えない環境でも例外を投げない
  const broken = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
  assert.equal(core.readHiscore(broken), 0);
  assert.equal(core.writeHiscore(broken, 10), 10);
});

test('mulberry32: 同じ種なら同じ列', () => {
  const a = core.mulberry32(42);
  const b = core.mulberry32(42);
  assert.equal(a(), b());
  assert.equal(a(), b());
});
