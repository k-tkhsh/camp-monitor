// 出題と習熟度の計算。DOM に触れない純粋なロジック（tests/core.test.mjs でテストする）。
import { KANA, ROWS, CONFUSABLE, BY_KANA } from './data.js';

export const PROGRESS_VERSION = 1;

export function emptyProgress() {
  return {
    version: PROGRESS_VERSION,
    stats: {},            // かな -> { seen, correct, wrong, streak }
    unlocked: ['あ'],     // じゅんばんモードで開放済みの行
    stars: 0,             // ためた星
    stickers: [],         // もらったステッカー
  };
}

export function statFor(progress, k) {
  return progress.stats[k] || { seen: 0, correct: 0, wrong: 0, streak: 0 };
}

/** 0=まだ / 1=みた / 2=できる / 3=とくい */
export function masteryLevel(stat) {
  if (!stat || stat.seen === 0) return 0;
  if (stat.correct >= 5 && stat.streak >= 3) return 3;
  if (stat.correct >= 3 && stat.streak >= 2) return 2;
  if (stat.correct >= 1) return 1;
  return 0;
}

export function levelOf(progress, k) {
  return masteryLevel(statFor(progress, k));
}

/** 答えを1回記録した新しい progress を返す（元は変更しない）。 */
export function recordAnswer(progress, k, correct) {
  const prev = statFor(progress, k);
  const stat = {
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    wrong: prev.wrong + (correct ? 0 : 1),
    streak: correct ? prev.streak + 1 : 0,
  };
  return {
    ...progress,
    stats: { ...progress.stats, [k]: stat },
    stars: progress.stars + (correct ? 1 : 0),
  };
}

/** 行のかな一覧 */
export function kanaOfRow(rowId) {
  return KANA.filter((e) => e.row === rowId);
}

/** その行の文字がぜんぶ「できる（レベル2以上）」になったか */
export function isRowMastered(progress, rowId) {
  return kanaOfRow(rowId)
    .filter((e) => e.playable !== false)
    .every((e) => levelOf(progress, e.k) >= 2);
}

/**
 * つぎの行に進んでよいか。
 * ぜんぶ「できる」になるのが基本だが、じゅうぶん練習して 8割できていれば先に進む
 * （1文字でつまずいたまま ずっと同じ行にとどまらないようにする）。
 */
export function isRowReady(progress, rowId) {
  const list = kanaOfRow(rowId).filter((e) => e.playable !== false);
  if (!list.length) return true;
  if (isRowMastered(progress, rowId)) return true;
  const practiced = list.every((e) => statFor(progress, e.k).seen >= 3);
  const can = list.filter((e) => levelOf(progress, e.k) >= 2).length;
  return practiced && can / list.length >= 0.8;
}

/** じゅんばんモードで次に開放する行。もう無ければ null。 */
export function nextRowToUnlock(progress) {
  const unlocked = progress.unlocked || [];
  if (!unlocked.every((r) => isRowReady(progress, r))) return null;
  const next = ROWS.find((r) => !unlocked.includes(r.id));
  return next ? next.id : null;
}

/** じゅんばんモードなら開放済みの行、えらぶモードなら設定された行を返す。 */
export function activeRows(progress, settings) {
  if (settings && settings.rowMode === 'custom' && settings.rows && settings.rows.length) {
    return ROWS.filter((r) => settings.rows.includes(r.id)).map((r) => r.id);
  }
  const unlocked = (progress.unlocked && progress.unlocked.length) ? progress.unlocked : ['あ'];
  return ROWS.filter((r) => unlocked.includes(r.id)).map((r) => r.id);
}

/**
 * 出題に使えるかな。
 * mode='picture' / 'word' では、その文字で始まる絵ことばがある文字だけを使う。
 */
export function poolFor(progress, settings, mode) {
  const rows = activeRows(progress, settings);
  return KANA.filter((e) => {
    if (!rows.includes(e.row)) return false;
    if (e.playable === false) return false;
    if ((mode === 'picture' || mode === 'word') && e.picture === false) return false;
    return true;
  });
}

/** 選択肢の数。にがてなうちは2つ、なれてきたら3〜4つ。 */
export function choiceCount(progress, pool) {
  if (pool.length < 3) return Math.max(2, pool.length);
  const levels = pool.map((e) => levelOf(progress, e.k));
  const known = levels.filter((l) => l >= 2).length;
  const ratio = known / levels.length;
  if (ratio >= 0.7 && pool.length >= 4) return 4;
  if (ratio >= 0.3) return 3;
  return 2;
}

function weightOf(progress, k) {
  const stat = statFor(progress, k);
  const level = masteryLevel(stat);
  const base = [6, 5, 2, 1][level];
  const missPenalty = Math.min(stat.wrong, 3) * 2;   // まちがえた字は多めに出す
  return base + missPenalty;
}

/** 重みつきの抽選。にがてな文字・まだ見ていない文字ほど出やすい。 */
export function pickTarget(progress, pool, rand = Math.random, avoid = null) {
  const candidates = pool.length > 1 && avoid
    ? pool.filter((e) => e.k !== avoid)
    : pool.slice();
  if (!candidates.length) return null;
  const weights = candidates.map((e) => weightOf(progress, e.k));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < candidates.length; i += 1) {
    r -= weights[i];
    if (r < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export function shuffle(list, rand = Math.random) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 形が似ている文字を優先し、足りなければ残りから補って、まちがい選択肢を作る。 */
export function pickDistractors(targetK, pool, count, rand = Math.random) {
  const others = pool.filter((e) => e.k !== targetK);
  const similar = new Set();
  CONFUSABLE.forEach((group) => {
    if (group.includes(targetK)) group.forEach((k) => { if (k !== targetK) similar.add(k); });
  });
  const near = shuffle(others.filter((e) => similar.has(e.k)), rand);
  const far = shuffle(others.filter((e) => !similar.has(e.k)), rand);
  return near.concat(far).slice(0, count);
}

/** その文字を含む言葉を選ぶ（無ければその文字自身の言葉）。 */
export function pickWordEntry(targetK, pool, rand = Math.random) {
  const own = BY_KANA.get(targetK);
  const contains = pool.filter((e) => e.picture !== false && e.word.includes(targetK));
  const list = contains.length ? contains : (own ? [own] : []);
  if (!list.length) return null;
  return list[Math.floor(rand() * list.length)];
}

/**
 * 1問ぶんのデータを作る。
 * mode: 'listen'   音をきいて文字をえらぶ
 *       'picture'  絵の ことばの はじめの文字をえらぶ
 *       'word'     ことばの あなうめ
 * 返り値: { mode, target, choices, correctId, word?, blankIndex? }
 */
export function makeQuestion(mode, progress, settings, rand = Math.random, avoid = null) {
  const pool = poolFor(progress, settings, mode);
  if (pool.length < 2) return null;
  const target = pickTarget(progress, pool, rand, avoid);
  if (!target) return null;
  const n = choiceCount(progress, pool);

  if (mode === 'picture') {
    // 絵と読み上げを手がかりに、ことばの「はじめの おと」の文字をえらぶ
    const distractors = pickDistractors(target.k, pool, n - 1, rand);
    const choices = shuffle([target, ...distractors], rand).map((e) => ({ id: e.k, kana: e.k }));
    return { mode, target, choices, correctId: target.k, entry: target };
  }

  if (mode === 'word') {
    const entry = pickWordEntry(target.k, pool, rand);
    if (!entry) return null;
    const chars = Array.from(entry.word);
    const positions = chars.map((c, i) => (c === target.k ? i : -1)).filter((i) => i >= 0);
    const blankIndex = positions[Math.floor(rand() * positions.length)];
    const distractors = pickDistractors(target.k, pool, n - 1, rand);
    const choices = shuffle([target, ...distractors], rand).map((e) => ({ id: e.k, kana: e.k }));
    return { mode, target, choices, correctId: target.k, entry, chars, blankIndex };
  }

  // listen
  const distractors = pickDistractors(target.k, pool, n - 1, rand);
  const choices = shuffle([target, ...distractors], rand).map((e) => ({ id: e.k, kana: e.k }));
  return { mode, target, choices, correctId: target.k };
}

/** 全体の進み具合（五十音表の色づけと、おうちの人向けの表示に使う） */
export function summary(progress) {
  const playable = KANA.filter((e) => e.playable !== false);
  const levels = playable.map((e) => levelOf(progress, e.k));
  return {
    total: playable.length,
    seen: levels.filter((l) => l >= 1).length,
    can: levels.filter((l) => l >= 2).length,
    good: levels.filter((l) => l === 3).length,
    stars: progress.stars || 0,
  };
}
