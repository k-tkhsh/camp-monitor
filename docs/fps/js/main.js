// ============================================================
// main.js — 画面（HTML オーバーレイ）とゲーム本体の結線
// ============================================================
import { Game } from './game.js';
import { readHiscore } from './core.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');

const screens = {
  title: $('screen-title'),
  pause: $('screen-pause'),
  gameover: $('screen-gameover'),
};

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const ui = {
  hideAll() {
    for (const el of Object.values(screens)) el.hidden = true;
  },
  show(name) {
    this.hideAll();
    screens[name].hidden = false;
  },
  showGameOver(game) {
    $('resScore').textContent = game.score.toLocaleString('ja-JP');
    $('resWave').textContent = game.wave;
    $('resKills').textContent = game.kills;
    $('resAcc').textContent = `${game.accuracy()}%`;
    $('resTime').textContent = formatTime(game.elapsed);
    $('resHiscore').textContent = game.hiscore.toLocaleString('ja-JP');
    this.show('gameover');
  },
};

const game = new Game(canvas, ui);
$('titleHiscore').textContent = readHiscore(window.localStorage).toLocaleString('ja-JP');

// ── ボタン ──────────────────────────────────────────────────
$('btnStart').addEventListener('click', () => game.start());
$('btnResume').addEventListener('click', () => game.resume());
$('btnRetry').addEventListener('click', () => game.start());
const toTitle = () => {
  game.state = 'menu';
  game.input.exitLock();
  game.reset();
  $('titleHiscore').textContent = readHiscore(window.localStorage).toLocaleString('ja-JP');
  ui.show('title');
};
$('btnQuit').addEventListener('click', toTitle);
$('btnTitle').addEventListener('click', toTitle);

// ポーズ中に画面をクリックしたら再開（ポインタロックを取り直す）
canvas.addEventListener('click', () => {
  if (game.state === 'paused') game.resume();
  else if (game.state === 'playing' && !game.input.locked && !game.input.freeLook && !game.isTouch()) game.input.requestLock();
});

// ── 設定 ────────────────────────────────────────────────────
const sens = $('sens');
const vol = $('vol');
const quality = $('quality');

sens.addEventListener('input', () => {
  game.input.sensitivity = Number(sens.value);
  $('sensValue').textContent = Number(sens.value).toFixed(1);
  localStorage.setItem('fps.sens', sens.value);
});
vol.addEventListener('input', () => {
  const v = Number(vol.value) / 100;
  game.sfx.setVolume(v);
  $('volValue').textContent = vol.value;
  localStorage.setItem('fps.vol', vol.value);
});
quality.addEventListener('change', () => {
  if (quality.value === 'auto') {
    game.qualityMode = 'auto';
  } else {
    game.qualityMode = 'fixed';
    game.renderer.resize(Number(quality.value));
  }
  localStorage.setItem('fps.quality', quality.value);
});

// 保存されている設定を復元
const savedSens = localStorage.getItem('fps.sens');
if (savedSens) { sens.value = savedSens; sens.dispatchEvent(new Event('input')); }
const savedVol = localStorage.getItem('fps.vol');
if (savedVol) { vol.value = savedVol; vol.dispatchEvent(new Event('input')); }
const savedQuality = localStorage.getItem('fps.quality');
if (savedQuality) { quality.value = savedQuality; quality.dispatchEvent(new Event('change')); }

// ── スマホ操作 ──────────────────────────────────────────────
if (window.matchMedia('(pointer: coarse)').matches) {
  const touchUi = $('touchUi');
  touchUi.hidden = false;
  game.input.bindButton($('btnFire'), 'fire', { hold: true });
  game.input.bindButton($('btnSwap'), 'swapWeapon');
  $('btnPause').addEventListener('click', () => (game.state === 'playing' ? game.pause() : game.resume()));
}

// デバッグ用（コンソールから状態を覗けるように）
window.__game = game;

game.run();
