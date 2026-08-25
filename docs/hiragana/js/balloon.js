// ふうせんわり：きこえた もじの ふうせんを、上に にげる前に われる。
// 動きの計算は action.js（純粋なロジック）にまかせ、ここは画面まわりだけ。
import { BY_KANA } from './data.js';
import * as audio from './audio.js';
import * as action from './action.js';

const COLORS = ['#ff8a80', '#ffd54f', '#81d4fa', '#a5d6a7', '#ce93d8', '#ffab91'];
const SPAWN_EVERY = 0.85;     // 秒
const ROUND = 10;             // ○個われたら おいわい

let ctx = null;
let sky = null;
let raf = 0;
let lastTime = 0;
let spawnIn = 0;
let balloons = [];
let nodes = new Map();
let target = null;
let popped = 0;
let hits = 0;
let running = false;

const poolKana = () => ctx.pool('listen').map((e) => e.k);

export function startBalloon(context) {
  ctx = context;
  sky = document.getElementById('sky');
  sky.innerHTML = '';
  balloons = [];
  nodes = new Map();
  popped = 0;
  hits = 0;
  spawnIn = 0;
  renderDots();
  newTarget();
  running = true;
  lastTime = performance.now();
  raf = requestAnimationFrame(tick);
}

export function stopBalloon() {
  running = false;
  cancelAnimationFrame(raf);
  if (sky) sky.innerHTML = '';
  balloons = [];
  nodes = new Map();
}

function pause() {
  running = false;
  cancelAnimationFrame(raf);
}

function resume() {
  if (running) return;
  running = true;
  lastTime = performance.now();
  raf = requestAnimationFrame(tick);
}

function renderDots() {
  const box = document.getElementById('balloonDots');
  if (!box) return;
  box.innerHTML = Array.from({ length: ROUND }, (_, i) =>
    `<span class="dot${i < hits ? ' on' : ''}"></span>`).join('');
}

function newTarget() {
  const pool = ctx.pool('listen');
  const picked = ctx.pickTarget(pool, target);
  target = picked ? picked.k : null;
  renderTargetChip();
  sayTarget();
}

function renderTargetChip() {
  const chip = document.getElementById('balloonTarget');
  if (!chip || !target) return;
  const entry = BY_KANA.get(target);
  chip.innerHTML = ctx.speech()
    ? `<button type="button" class="chip-speak" aria-label="もういちど きく">🔊</button>
       <span class="chip-emoji" aria-hidden="true">${entry.emoji}</span>`
    : `<span class="chip-emoji" aria-hidden="true">${entry.emoji}</span>
       <span class="chip-kana">${target}</span>`;
  chip.querySelector('.chip-speak')?.addEventListener('click', () => { audio.sfx.tap(); sayTarget(); });
}

async function sayTarget() {
  if (!target || !ctx.speech()) return;
  audio.sfx.listen();
  await new Promise((r) => setTimeout(r, 240));
  await audio.speakKana(target);
}

function tick(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastTime) / 1000);   // タブが戻ったときに飛ばないよう上限
  lastTime = now;

  spawnIn -= dt;
  if (spawnIn <= 0 && balloons.length < action.balloonLimit(popped)) {
    spawnIn = SPAWN_EVERY;
    const k = action.nextKana(target, balloons.map((b) => b.k), poolKana());
    const b = action.makeBalloon(k, popped);
    balloons.push(b);
    addNode(b);
  }

  const { balloons: alive, escaped } = action.updateBalloons(balloons, dt);
  balloons = alive;
  escaped.forEach((b) => {
    nodes.get(b.id)?.remove();
    nodes.delete(b.id);
  });
  balloons.forEach(draw);
  raf = requestAnimationFrame(tick);
}

function addNode(b) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'balloon';
  el.style.setProperty('--c', COLORS[b.color % COLORS.length]);
  el.innerHTML = `<span class="balloon-kana">${b.k}</span>`;
  // タップした瞬間に反応させる（動いているので click だと取りこぼす）
  el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); onTap(b, el); });
  sky.appendChild(el);
  nodes.set(b.id, el);
  draw(b);
}

function draw(b) {
  const el = nodes.get(b.id);
  if (!el) return;
  el.style.left = `${b.x + action.swayOf(b)}%`;
  el.style.bottom = `${b.y}%`;
}

async function onTap(b, el) {
  if (!running) return;

  if (b.k !== target) {                       // ちがう ふうせん：われずに ゆれるだけ
    audio.sfx.wrong();
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 400);
    ctx.miss(target);
    sayTarget();
    return;
  }

  audio.sfx.correct();
  burst(el, b);
  balloons = balloons.filter((x) => x.id !== b.id);
  nodes.delete(b.id);
  popped += 1;
  hits += 1;
  renderDots();

  pause();
  const reward = await ctx.award(target);
  if (hits >= ROUND) {
    hits = 0;
    renderDots();
    reward.round = true;
  }
  await ctx.celebrateReward(reward);
  if (!ctx.isActive()) return;                // ホームに戻っていたら やめる
  newTarget();
  resume();
}

/** われた演出：ふうせんが はじけて、かけらが とぶ。 */
function burst(el, b) {
  el.classList.add('pop');
  setTimeout(() => el.remove(), 320);
  const pieces = ['✨', '🎊', '⭐'];
  for (let i = 0; i < 6; i += 1) {
    const s = document.createElement('span');
    s.className = 'piece';
    s.textContent = pieces[i % pieces.length];
    s.style.left = `${b.x + action.swayOf(b)}%`;
    s.style.bottom = `${b.y}%`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    s.style.setProperty('--dy', `${-40 - Math.random() * 90}px`);
    sky.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }
}
