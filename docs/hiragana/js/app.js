// 画面の組み立てと操作。文字が読めない子でも遊べるよう、指示はすべて音と絵で伝える。
import { KANA, ROWS, BY_KANA, STICKERS } from './data.js';
import * as core from './core.js';
import * as store from './store.js';
import * as audio from './audio.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const ROUND = 5;            // ○問ごとに おいわい
const STAR_PER_STICKER = 10;

let nudgeTimer = null;
let nudgeCount = 0;

const state = {
  progress: store.loadProgress(),
  settings: store.loadSettings(),
  screen: 'home',
  mode: 'listen',
  question: null,
  wrongs: 0,
  roundHits: 0,
  lastTarget: null,
  locked: false,
};

audio.configure(state.settings);

/* ────────────── 画面のきりかえ ────────────── */

function show(screen) {
  state.screen = screen;
  clearNudge();
  ['home', 'game', 'table', 'stickers', 'settings'].forEach((id) => {
    $(`#screen-${id}`).hidden = id !== screen;
  });
  audio.stopSpeaking();
  window.scrollTo(0, 0);
  if (screen === 'home') renderHome();
  if (screen === 'table') renderTable();
  if (screen === 'stickers') renderStickers();
  if (screen === 'settings') renderSettings();
}

function saveAll() {
  store.saveProgress(state.progress);
  store.saveSettings(state.settings);
}

function refreshStars() {
  const n = state.progress.stars || 0;
  ['#homeStars', '#gameStars', '#tableStars', '#stickerStars'].forEach((sel) => {
    const el = $(sel);
    if (el) el.textContent = n;
  });
}

/* ────────────── ホーム ────────────── */

/** 読み上げが使えない端末では、音だけが手がかりのゲームを遊べないようにする。 */
function speechAvailable() {
  return audio.canSpeak() && audio.hasJapaneseVoice();
}

function renderHome() {
  refreshStars();
  const listenBtn = document.querySelector('.menu-btn[data-mode="listen"]');
  const ok = speechAvailable();
  listenBtn.disabled = !ok;
  listenBtn.style.opacity = ok ? '' : '.45';
  let warn = document.getElementById('speechWarn');
  if (!ok && !warn) {
    warn = document.createElement('p');
    warn.id = 'speechWarn';
    warn.className = 'fine';
    warn.textContent = 'この端末では日本語の読み上げが使えないため、音だけの問題はお休みしています（端末の「読み上げ」設定で日本語の音声を追加すると遊べます）。';
    document.querySelector('#screen-home .menu').after(warn);
  } else if (ok && warn) {
    warn.remove();
  }
}

/* ────────────── ゲーム ────────────── */

function startGame(mode) {
  state.mode = mode;
  state.roundHits = 0;
  state.lastTarget = null;
  show('game');
  nextQuestion();
}

function renderDots() {
  $('#dots').innerHTML = Array.from({ length: ROUND }, (_, i) =>
    `<span class="dot${i < state.roundHits ? ' on' : ''}"></span>`).join('');
}

function clearNudge() {
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = null;
}

/** しばらく さわらないときは、もう一度 読み上げて うながす。 */
function scheduleNudge() {
  clearNudge();
  if (nudgeCount >= 3) return;
  nudgeTimer = setTimeout(() => {
    if (state.screen !== 'game' || state.locked) return;
    nudgeCount += 1;
    askPrompt();
  }, 9000);
}

function nextQuestion() {
  const q = core.makeQuestion(state.mode, state.progress, state.settings, Math.random, state.lastTarget);
  if (!q) {                                   // 出題できる文字が足りないとき
    $('#prompt').innerHTML = '<p class="prompt-label">もじを えらんでね（⚙️ から）</p>';
    $('#choices').innerHTML = '';
    return;
  }
  state.question = q;
  state.wrongs = 0;
  nudgeCount = 0;
  state.locked = false;
  state.lastTarget = q.target.k;
  renderDots();
  refreshStars();
  renderPrompt(q);
  renderChoices(q);
  $('#hint').textContent = '';
  askPrompt();
}

function renderPrompt(q) {
  const box = $('#prompt');
  if (q.mode === 'listen') {
    box.innerHTML = `
      <button type="button" class="speak-btn" id="replay" aria-label="もういちど きく">🔊</button>
      <p class="prompt-label">きこえた もじは どれ？</p>`;
  } else if (q.mode === 'picture') {
    box.innerHTML = `
      <div class="prompt-emoji" aria-hidden="true">${q.entry.emoji}</div>
      ${speechAvailable() ? '<button type="button" class="speak-btn" id="replay" style="font-size:34px" aria-label="もういちど きく">🔊</button>'
                          : `<p class="word-line"><span class="word-char">${q.entry.word}</span></p>`}
      <p class="prompt-label">はじめの もじは どれ？</p>`;
  } else {
    const chars = q.chars.map((c, i) => (i === q.blankIndex
      ? `<span class="word-char blank" data-blank>${c}</span>`
      : `<span class="word-char">${c}</span>`)).join('');
    box.innerHTML = `
      <div class="prompt-emoji" aria-hidden="true">${q.entry.emoji}</div>
      <div class="word-line">${chars}</div>
      <button type="button" class="speak-btn" id="replay" style="font-size:30px" aria-label="もういちど きく">🔊</button>`;
  }
  $('#replay')?.addEventListener('click', () => { audio.sfx.tap(); askPrompt(); });
}

function renderChoices(q) {
  const box = $('#choices');
  box.className = `choices n${q.choices.length}`;
  box.innerHTML = q.choices.map((c) =>
    `<button type="button" class="choice" data-id="${c.id}">${c.kana}</button>`).join('');
  $$('#choices .choice').forEach((btn) => {
    btn.addEventListener('click', () => onChoice(btn));
  });
}

/** 問題文を音で伝える。読み上げが使えない端末では効果音だけ鳴らす。 */
async function askPrompt() {
  const q = state.question;
  if (!q) return;
  const btn = $('#replay');
  btn?.classList.add('playing');
  clearNudge();
  if (q.mode === 'listen') {
    await audio.speakKana(q.target.k);
  } else if (q.mode === 'picture') {
    await audio.speak(`${q.entry.word}。 ${q.entry.word} の はじめの おとは？`);
  } else {
    await audio.speak(`${q.entry.word}。 どの もじが はいるかな？`);
  }
  btn?.classList.remove('playing');
  if (state.screen === 'game' && !state.locked) scheduleNudge();
}

async function onChoice(btn) {
  if (state.locked || btn.disabled) return;
  clearNudge();
  const q = state.question;
  const id = btn.dataset.id;

  if (id !== q.correctId) {
    state.wrongs += 1;
    audio.sfx.wrong();
    btn.classList.add('wrong');
    btn.disabled = true;
    state.progress = core.recordAnswer(state.progress, q.target.k, false);
    saveAll();
    $('#hint').textContent = 'もういちど さがしてみよう';
    await audio.speak('おしいね。 もういちど');
    if (state.wrongs >= 2) {                    // 2回まちがえたら 答えを ひからせて 教える
      const right = $$('#choices .choice').find((b) => b.dataset.id === q.correctId);
      right?.classList.add('hintme');
      const entry = BY_KANA.get(q.correctId);
      await audio.speak(`こたえは、 ${entry.word} の ${q.correctId}`, { rate: 0.7 });
    } else {
      askPrompt();
    }
    return;
  }

  // せいかい
  state.locked = true;
  audio.sfx.correct();
  btn.classList.add('correct');
  $$('#choices .choice').forEach((b) => { b.disabled = true; b.classList.remove('hintme'); });
  if (q.mode === 'word') {
    const blank = $('#prompt [data-blank]');
    if (blank) blank.classList.add('filled');
  }
  const before = state.progress;
  state.progress = core.recordAnswer(state.progress, q.target.k, true);
  state.roundHits += 1;
  renderDots();
  refreshStars();
  $('#hint').textContent = ['やったね！', 'すごい！', 'せいかい！', 'じょうず！', 'ばっちり！'][Math.floor(Math.random() * 5)];

  const entry = BY_KANA.get(q.target.k);
  await audio.speak(`せいかい！ ${entry.word} の ${q.target.k}`);

  const sticker = awardSticker(before);
  const unlocked = maybeUnlockRow();
  saveAll();

  if (unlocked) {
    await celebrate(`あたらしい もじ！\n${rowLabel(unlocked)}`, `あたらしい もじだよ。 ${rowLabel(unlocked)}`);
  } else if (sticker) {
    await celebrate(`ステッカー ゲット！\n${sticker}`, 'ステッカーを もらったよ！');
  } else if (state.roundHits >= ROUND) {
    state.roundHits = 0;
    renderDots();
    await celebrate('よく できました！\n🎉', 'よく できました！');
  }

  if (state.screen === 'game') nextQuestion();
}

function rowLabel(rowId) {
  return (ROWS.find((r) => r.id === rowId) || {}).label || '';
}

/** 星が 10 たまるごとに ステッカーを 1まい。もらえたら その絵文字を返す。 */
function awardSticker(before) {
  const earned = Math.min(Math.floor((state.progress.stars || 0) / STAR_PER_STICKER), STICKERS.length);
  const had = Math.min(Math.floor((before.stars || 0) / STAR_PER_STICKER), STICKERS.length);
  if (earned <= had) return null;
  const stickers = (state.progress.stickers || []).slice();
  const next = STICKERS[stickers.length % STICKERS.length];
  stickers.push(next);
  state.progress = { ...state.progress, stickers };
  return next;
}

/** じゅんばんモードで、いまの行が ぜんぶ できたら つぎの行を出す。 */
function maybeUnlockRow() {
  if (state.settings.rowMode === 'custom') return null;
  const next = core.nextRowToUnlock(state.progress);
  if (!next) return null;
  state.progress = { ...state.progress, unlocked: [...state.progress.unlocked, next] };
  return next;
}

/* ────────────── おいわい演出 ────────────── */

function celebrate(text, speech) {
  const box = $('#celebrate');
  box.hidden = false;
  box.innerHTML = `<div class="msg">${text.replace(/\n/g, '<br>')}</div>`;
  const pieces = ['🎉', '⭐', '🎊', '💛', '🌈', '✨'];
  for (let i = 0; i < 18; i += 1) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = pieces[i % pieces.length];
    s.style.left = `${Math.random() * 96}%`;
    s.style.animationDuration = `${1.1 + Math.random() * 1.1}s`;
    s.style.animationDelay = `${Math.random() * 0.35}s`;
    box.appendChild(s);
  }
  audio.sfx.fanfare();
  if (speech) audio.speak(speech);
  return new Promise((resolve) => setTimeout(() => {
    box.hidden = true;
    box.innerHTML = '';
    resolve();
  }, 2000));
}

/* ────────────── ひらがなひょう ────────────── */

function renderTable() {
  refreshStars();
  const wrap = $('#kanaTable');
  wrap.innerHTML = ROWS.map((row) => {
    const cells = core.kanaOfRow(row.id);
    const padded = cells.concat(Array(5 - cells.length).fill(null));
    return `<div class="kana-row">${padded.map((e) => (e
      ? `<button type="button" class="kana-cell lv${core.levelOf(state.progress, e.k)}" data-k="${e.k}">${e.k}</button>`
      : '<span class="kana-cell empty"></span>')).join('')}</div>`;
  }).join('');
  $('#tableCard').hidden = true;
  $$('#kanaTable .kana-cell[data-k]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#kanaTable .kana-cell').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      btn.scrollIntoView({ block: 'center', behavior: 'smooth' });   // 下のカードで隠れないように
      showTableCard(btn.dataset.k);
    });
  });
}

async function showTableCard(k) {
  const e = BY_KANA.get(k);
  const card = $('#tableCard');
  card.hidden = false;
  card.innerHTML = `
    <span class="big" aria-hidden="true">${e.emoji}</span>
    <span class="txt"><b>${k}</b><small>${e.note ? e.note : `${e.word}`}</small></span>`;
  audio.sfx.tap();
  await audio.speakKana(k);
  if (e.note) await audio.speak(e.note.replace(/「|」/g, ' '));
  else await audio.speak(`${e.word} の ${k}`);
}

/* ────────────── ステッカー ────────────── */

function renderStickers() {
  refreshStars();
  const got = state.progress.stickers || [];
  const slots = Math.max(STICKERS.length, got.length);
  $('#stickerBoard').innerHTML = Array.from({ length: slots }, (_, i) => (got[i]
    ? `<span class="sticker">${got[i]}</span>`
    : '<span class="sticker empty">？</span>')).join('');
}

/* ────────────── おうちの人のせってい ────────────── */

function renderSettings() {
  const s = core.summary(state.progress);
  $('#summaryLine').textContent =
    `よんだ ${s.seen} / ${s.total} 字、できる ${s.can} 字、とくい ${s.good} 字、ほし ${s.stars} こ`;
  $('#summaryTable').innerHTML = KANA.map((e) =>
    `<span class="mini-cell lv${core.levelOf(state.progress, e.k)}">${e.k}</span>`).join('');

  $$('input[name="rowMode"]').forEach((r) => { r.checked = r.value === state.settings.rowMode; });
  const picker = $('#rowPicker');
  picker.hidden = state.settings.rowMode !== 'custom';
  picker.innerHTML = ROWS.map((r) => {
    const on = (state.settings.rows || []).includes(r.id);
    return `<button type="button" class="row-chip${on ? ' on' : ''}" data-row="${r.id}">${r.label}</button>`;
  }).join('');
  $$('#rowPicker .row-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.row;
      const rows = new Set(state.settings.rows || []);
      if (rows.has(id)) rows.delete(id); else rows.add(id);
      if (!rows.size) rows.add('あ');
      state.settings = { ...state.settings, rows: ROWS.filter((r) => rows.has(r.id)).map((r) => r.id) };
      saveAll();
      renderSettings();
    });
  });

  $('#soundToggle').checked = state.settings.sound !== false;
  $('#rateRange').value = state.settings.rate;
  $('#rateOut').textContent = `${Number(state.settings.rate).toFixed(2)}倍`;
  renderVoiceOptions();
}

function renderVoiceOptions() {
  const sel = $('#voiceSelect');
  const list = audio.voices();
  sel.innerHTML = '<option value="">じどう</option>' +
    list.map((v) => `<option value="${v.voiceURI}">${v.name}</option>`).join('');
  sel.value = state.settings.voiceURI || '';
  $('#voiceWarn').hidden = !(audio.canSpeak() === false || list.length === 0);
}

function bindSettings() {
  $$('input[name="rowMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.settings = { ...state.settings, rowMode: radio.value };
      saveAll();
      renderSettings();
    });
  });
  $('#soundToggle').addEventListener('change', (ev) => {
    state.settings = { ...state.settings, sound: ev.target.checked };
    audio.configure(state.settings);
    saveAll();
  });
  $('#rateRange').addEventListener('input', (ev) => {
    state.settings = { ...state.settings, rate: Number(ev.target.value) };
    $('#rateOut').textContent = `${state.settings.rate.toFixed(2)}倍`;
    audio.configure(state.settings);
    saveAll();
  });
  $('#rateRange').addEventListener('change', () => audio.speak('こんにちは。ひらがな あそび'));
  $('#voiceSelect').addEventListener('change', (ev) => {
    state.settings = { ...state.settings, voiceURI: ev.target.value };
    audio.configure(state.settings);
    saveAll();
    audio.speak('この こえで よむよ');
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!window.confirm('これまでの きろく（星・ステッカー・進み具合）を消します。よろしいですか？')) return;
    state.progress = store.resetProgress();
    renderSettings();
    refreshStars();
  });
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.addEventListener?.('voiceschanged', () => {
      if (state.screen === 'settings') renderVoiceOptions();
    });
  }
}

/* ────────────── 起動 ────────────── */

function bind() {
  $$('.menu-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.sfx.tap();
      if (btn.dataset.mode) startGame(btn.dataset.mode);
      else show(btn.dataset.screen);
    });
  });
  $$('[data-home]').forEach((btn) => btn.addEventListener('click', () => { audio.sfx.tap(); show('home'); }));
  $('#openSettings').addEventListener('click', () => show('settings'));
  document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  // 子どもが誤って選択・拡大しないようにする
  document.addEventListener('dblclick', (ev) => ev.preventDefault());
  document.addEventListener('contextmenu', (ev) => {
    if (ev.target.closest('.choice, .kana-cell, .menu-btn')) ev.preventDefault();
  });
  bindSettings();
}

bind();
show('home');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
