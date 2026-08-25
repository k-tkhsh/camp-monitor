// なぞりがき：書き順どおりに 1画ずつ 指でなぞる。
// 判定は trace.js（純粋なロジック）、字の形と書き順は strokes.js のデータを使う。
import { BY_KANA } from './data.js';
import { STROKES, STROKE_BOX } from './strokes.js';
import * as audio from './audio.js';
import * as trace from './trace.js';

const NS = 'http://www.w3.org/2000/svg';
const STEP = 2;                 // 見本の線を切る間隔
const LOOSE_AFTER = 2;          // ○回つまずいたら 判定をゆるめる

let ctx = null;
let pad = null;
let layers = null;
let target = null;              // いま書いている字
let strokes = [];               // [{ d, points, length }]
let index = 0;                  // いま何画目か
let tracer = null;
let inkPoints = [];
let fails = 0;
let demoRaf = 0;
let active = false;

export function startWrite(context) {
  ctx = context;
  pad = document.getElementById('writePad');
  layers = {
    guide: document.getElementById('wGuide'),
    done: document.getElementById('wDone'),
    current: document.getElementById('wCurrent'),
    start: document.getElementById('wStart'),
    ink: document.getElementById('wInk'),
    dot: document.getElementById('wDot'),
  };
  if (!pad.dataset.bound) {
    pad.addEventListener('pointerdown', onDown);
    pad.addEventListener('pointermove', onMove);
    pad.addEventListener('pointerup', onUp);
    pad.addEventListener('pointercancel', onUp);
    document.getElementById('writeDemo').addEventListener('click', () => { audio.sfx.tap(); playDemo(); });
    document.getElementById('writeNext').addEventListener('click', () => { audio.sfx.tap(); nextKana(); });
    pad.dataset.bound = '1';
  }
  active = true;
  nextKana();
}

export function stopWrite() {
  active = false;
  cancelAnimationFrame(demoRaf);
}

/* ────────────── 出題 ────────────── */

function nextKana() {
  const pool = ctx.pool('write');
  const picked = ctx.pickWritingTarget(pool, target && target.k);
  if (!picked) return;
  target = picked;
  index = 0;
  fails = 0;
  strokes = (STROKES[target.k] || []).map((d) => sample(d));
  renderWord();
  renderStrokes();
  audio.speak(`${target.k}。 ${target.word} の ${target.k}。 なぞって みよう`)
    .then(() => { if (active) playDemo(); });
}

/** 見本の線を、等間隔の点の列にする（判定と見本アニメーションに使う）。 */
function sample(d) {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  layers.guide.appendChild(p);            // 測るために いったん画面に入れる
  const length = p.getTotalLength();
  const points = [];
  for (let l = 0; l <= length; l += STEP) {
    const pt = p.getPointAtLength(l);
    points.push({ x: pt.x, y: pt.y });
  }
  const end = p.getPointAtLength(length);
  points.push({ x: end.x, y: end.y });
  p.remove();
  return { d, points, length };
}

function renderWord() {
  document.getElementById('writeWord').innerHTML = `
    <span class="write-emoji" aria-hidden="true">${target.emoji}</span>
    <span class="write-text"><b>${target.k}</b><small>${target.word}</small></span>`;
  renderCount();
}

function renderCount() {
  document.getElementById('writeCount').innerHTML = strokes.map((_, i) =>
    `<span class="dot${i < index ? ' on' : ''}"></span>`).join('');
}

function renderStrokes() {
  // うすい字全体（どんな形になるかの目印）
  layers.guide.innerHTML = strokes.map((s) => `<path d="${s.d}" class="s-guide"/>`).join('');
  // 書けたところ
  layers.done.innerHTML = strokes.slice(0, index).map((s) => `<path d="${s.d}" class="s-done"/>`).join('');
  layers.ink.setAttribute('d', '');
  inkPoints = [];

  const cur = strokes[index];
  if (!cur) {
    layers.current.setAttribute('d', '');
    layers.start.innerHTML = '';
    layers.dot.style.opacity = '0';
    return;
  }
  layers.current.setAttribute('d', cur.d);
  layers.current.style.strokeDasharray = '';
  layers.current.style.strokeDashoffset = '';
  const p0 = cur.points[0];
  layers.start.innerHTML = `
    <circle cx="${p0.x}" cy="${p0.y}" r="7.5" class="s-start"/>
    <text x="${p0.x}" y="${p0.y + 3.2}" class="s-num">${index + 1}</text>`;
  tracer = null;
  renderCount();
}

/* ────────────── 見本アニメーション ────────────── */

function playDemo() {
  const cur = strokes[index];
  if (!cur || !active) return;
  cancelAnimationFrame(demoRaf);
  const dur = trace.demoDuration(cur.length);
  const path = layers.current;
  path.style.strokeDasharray = `${cur.length}`;
  path.style.strokeDashoffset = `${cur.length}`;
  const dot = layers.dot;
  dot.style.opacity = '1';
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const at = cur.points[Math.min(cur.points.length - 1, Math.round(t * (cur.points.length - 1)))];
    path.style.strokeDashoffset = `${cur.length * (1 - t)}`;
    dot.setAttribute('cx', at.x);
    dot.setAttribute('cy', at.y);
    if (t < 1 && active) demoRaf = requestAnimationFrame(step);
    else setTimeout(() => { dot.style.opacity = '0'; }, 260);
  };
  demoRaf = requestAnimationFrame(step);
}

/* ────────────── 指でなぞる ────────────── */

function toPad(ev) {
  const r = pad.getBoundingClientRect();
  return {
    x: ((ev.clientX - r.left) / r.width) * STROKE_BOX,
    y: ((ev.clientY - r.top) / r.height) * STROKE_BOX,
  };
}

function onDown(ev) {
  if (!active || !strokes[index]) return;
  pad.setPointerCapture?.(ev.pointerId);
  cancelAnimationFrame(demoRaf);
  layers.dot.style.opacity = '0';
  // 見本の途中でさわられても、なぞる線が消えたままにならないようにする
  layers.current.style.strokeDasharray = '';
  layers.current.style.strokeDashoffset = '';
  tracer = trace.createTracer(strokes[index].points, {
    required: fails >= LOOSE_AFTER ? 0.68 : 0.82,
    tolerance: fails >= LOOSE_AFTER ? 16 : 13,
  });
  inkPoints = [];
  addInk(toPad(ev));
}

function onMove(ev) {
  if (!tracer) return;
  ev.preventDefault();
  const p = toPad(ev);
  const from = inkPoints[inkPoints.length - 1] || p;
  trace.interpolate(from, p).forEach((q) => tracer.feed(q));
  addInk(p);
}

function addInk(p) {
  inkPoints.push(p);
  if (tracer) tracer.feed(p);
  const d = inkPoints.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join('');
  layers.ink.setAttribute('d', d);
}

async function onUp() {
  if (!tracer) return;
  const result = tracer.result();
  tracer = null;

  if (result.ok) {
    index += 1;
    audio.sfx.correct();
    renderStrokes();
    if (index >= strokes.length) await finishKana();
    else {
      layers.current.classList.add('flash');
      setTimeout(() => layers.current.classList.remove('flash'), 300);
      if (active) setTimeout(playDemo, 350);
    }
    return;
  }

  // うまくいかなかったとき：しかられている感じにならないよう、そっと やり直す
  fails += 1;
  audio.sfx.wrong();
  layers.ink.classList.add('miss');
  setTimeout(() => {
    layers.ink.classList.remove('miss');
    layers.ink.setAttribute('d', '');
    inkPoints = [];
  }, 420);
  if (result.reversed) await audio.speak('こっちから かいてみよう');
  else if (fails >= LOOSE_AFTER) await audio.speak('おてほんを みてね');
  else await audio.speak('もういちど');
  if (active) playDemo();
}

async function finishKana() {
  layers.done.classList.add('cheer');
  setTimeout(() => layers.done.classList.remove('cheer'), 700);
  const reward = await ctx.awardWriting(target.k);
  await audio.speak(`かけたね！ ${target.word} の ${target.k}`);
  await ctx.celebrateReward(reward);
  if (!ctx.isActive()) return;
  setTimeout(() => { if (active) nextKana(); }, 300);
}
