// node --test docs/hiragana/tests/trace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as trace from '../js/trace.js';
import * as action from '../js/action.js';
import { STROKES, STROKE_BOX } from '../js/strokes.js';
import { KANA } from '../js/data.js';

/** まっすぐな画（左から右へ）を等間隔に切った点 */
const line = (n = 41) => Array.from({ length: n }, (_, i) => ({ x: 10 + (i * 80) / (n - 1), y: 50 }));
/** 弓なりの画（下にふくらむ） */
const arc = (n = 41) => Array.from({ length: n }, (_, i) => {
  const t = i / (n - 1);
  return { x: 15 + t * 79, y: 30 + Math.sin(t * Math.PI) * 40 };
});
const feedAll = (tracer, pts) => { pts.forEach((p) => tracer.feed(p)); return tracer.result(); };

test('なぞり通りに動かせば合格になる', () => {
  const pts = line();
  assert.equal(feedAll(trace.createTracer(pts), pts).ok, true);
});

test('多少ふらついても合格にする（小さい子の指はまっすぐ動かない）', () => {
  const pts = arc();
  const wobbly = pts.map((p, i) => ({ x: p.x + (i % 3) * 3 - 3, y: p.y + Math.sin(i) * 5 }));
  assert.equal(feedAll(trace.createTracer(arc()), wobbly).ok, true);
});

test('線から大きく外れたままだと合格にしない', () => {
  const pts = arc();
  const off = pts.map((p) => ({ x: p.x, y: p.y - 34 }));
  const r = feedAll(trace.createTracer(pts), off);
  assert.equal(r.ok, false);
  assert.ok(r.progress < 0.5, `ほとんど進まないこと (実際: ${r.progress.toFixed(2)})`);
});

test('弓なりの画を まっすぐ横切っても合格にしない', () => {
  const pts = arc();
  const straight = trace.interpolate(pts[0], pts[pts.length - 1], 1.5);
  const r = feedAll(trace.createTracer(pts), [pts[0], ...straight]);
  assert.equal(r.ok, false);
  assert.ok(r.progress < 0.8, `途中で止まること (実際: ${r.progress.toFixed(2)})`);
});

test('終わりから書き始めたら「はんたい」と分かる', () => {
  const pts = line();
  const r = feedAll(trace.createTracer(pts), pts.slice().reverse());
  assert.equal(r.reversed, true);
  assert.equal(r.ok, false);
});

test('途中でやめたら合格にしない', () => {
  const pts = line();
  const r = feedAll(trace.createTracer(pts), pts.slice(0, 20));
  assert.equal(r.ok, false);
  // 指の少し先までは進んだことにする（ゆるめの判定）ぶん、半分よりは大きくなる
  assert.ok(r.progress > 0.4 && r.progress < 0.8, `実際: ${r.progress.toFixed(2)}`);
});

test('書き始めから終わりへ 飛ばして触っても合格にしない', () => {
  const pts = line();
  const tracer = trace.createTracer(pts);
  tracer.feed(pts[0]);
  tracer.feed(pts[pts.length - 1]);
  assert.equal(tracer.result().ok, false);
});

test('interpolate は 飛んだ指の間を うめる', () => {
  const filled = trace.interpolate({ x: 0, y: 0 }, { x: 30, y: 40 }, 5);
  assert.equal(filled.length, 10);
  assert.deepEqual(filled[filled.length - 1], { x: 30, y: 40 });
  assert.deepEqual(trace.interpolate({ x: 0, y: 0 }, { x: 1, y: 0 }, 5), [{ x: 1, y: 0 }]);
});

test('見本アニメーションの長さは 画の長さで決まり、上限と下限がある', () => {
  assert.equal(trace.demoDuration(0), 700);
  assert.equal(trace.demoDuration(1000), 2200);
  assert.ok(trace.demoDuration(80) > trace.demoDuration(40));
});

test('書き順データは 46字ぶんそろっていて 画数がただしい', () => {
  assert.equal(Object.keys(STROKES).length, 46);
  KANA.forEach((e) => assert.ok(STROKES[e.k]?.length, `${e.k} の書き順がある`));
  assert.equal(STROKES['あ'].length, 3);
  assert.equal(STROKES['い'].length, 2);
  assert.equal(STROKES['し'].length, 1);
  assert.equal(STROKES['き'].length, 4);
  assert.equal(STROKES['ほ'].length, 4);
  assert.equal(STROKES['ん'].length, 1);
  Object.entries(STROKES).forEach(([k, list]) => {
    list.forEach((d) => assert.ok(/^M[\d.]/.test(d), `${k} の線は M で始まる`));
  });
  assert.equal(STROKE_BOX, 109);
});

test('ふうせんは のぼって、空の上まで行くと消える', () => {
  const b = action.makeBalloon('あ', 0, () => 0.5);
  assert.ok(b.y < 0, '地面の下から出てくる');
  const first = action.updateBalloons([b], 1);
  assert.equal(first.balloons.length, 1);
  assert.ok(first.balloons[0].y > b.y, '上にのぼる');
  let list = [b];
  for (let i = 0; i < 60; i += 1) list = action.updateBalloons(list, 1).balloons;
  assert.equal(list.length, 0, 'そのままにすると にげていく');
  const escaped = action.updateBalloons([{ ...b, y: action.FIELD + 15 }], 1).escaped;
  assert.equal(escaped.length, 1);
  assert.equal(action.updateBalloons([{ ...b, y: 50 }], 0.1).escaped.length, 0, '画面の中では消えない');
});

test('速さは だんだん上がるが 上限で止まる', () => {
  assert.ok(action.speedFor(0) < action.speedFor(5));
  assert.equal(action.speedFor(1000), 10);
  assert.equal(action.balloonLimit(0), 4);
  assert.equal(action.balloonLimit(12), 6);
});

test('さがしている文字が画面に無ければ かならず出す', () => {
  const pool = ['あ', 'い', 'う', 'え'];
  assert.equal(action.nextKana('あ', ['い', 'う'], pool), 'あ');
  const other = action.nextKana('あ', ['あ'], pool, () => 0);
  assert.notEqual(other, 'あ');
  assert.ok(pool.includes(other));
  // 全部出ているときは 同じ文字でも返す（画面が止まらないように）
  assert.ok(pool.includes(action.nextKana('あ', pool, pool, () => 0)));
});
