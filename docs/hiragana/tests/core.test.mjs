// node --test docs/hiragana/tests/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';
import { KANA, BY_KANA, ROWS } from '../js/data.js';

/** 決まった順に値を返す疑似乱数（出題を再現できるようにする） */
const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const withStats = (entries) => {
  let p = core.emptyProgress();
  entries.forEach(([k, correct, times]) => {
    for (let i = 0; i < times; i += 1) p = core.recordAnswer(p, k, correct);
  });
  return p;
};

test('データはひらがな46字ぶんあり、絵ことばが重複しない', () => {
  assert.equal(KANA.length, 46);
  const words = KANA.filter((e) => e.picture !== false).map((e) => e.word);
  assert.equal(new Set(words).size, words.length);
  KANA.forEach((e) => {
    if (e.picture === false) return;
    assert.equal(Array.from(e.word)[0], e.k, `${e.word} は ${e.k} で始まること`);
  });
});

test('五十音表の行はすべての文字を1回ずつ含む', () => {
  const fromRows = ROWS.flatMap((r) => core.kanaOfRow(r.id).map((e) => e.k));
  assert.deepEqual(fromRows.slice().sort(), KANA.map((e) => e.k).sort());
});

test('masteryLevel は正解の数と連続数で上がる', () => {
  assert.equal(core.masteryLevel({ seen: 0, correct: 0, wrong: 0, streak: 0 }), 0);
  assert.equal(core.masteryLevel({ seen: 1, correct: 1, wrong: 0, streak: 1 }), 1);
  assert.equal(core.masteryLevel({ seen: 4, correct: 3, wrong: 1, streak: 2 }), 2);
  assert.equal(core.masteryLevel({ seen: 6, correct: 5, wrong: 1, streak: 3 }), 3);
  // まちがえると連続数が切れて レベルが下がる
  assert.equal(core.masteryLevel({ seen: 7, correct: 5, wrong: 2, streak: 0 }), 1);
});

test('recordAnswer は元の progress を変えず、正解のときだけ星が増える', () => {
  const p0 = core.emptyProgress();
  const p1 = core.recordAnswer(p0, 'あ', true);
  const p2 = core.recordAnswer(p1, 'あ', false);
  assert.equal(p0.stars, 0);
  assert.deepEqual(p0.stats, {});
  assert.equal(p1.stars, 1);
  assert.equal(p2.stars, 1);
  assert.deepEqual(p2.stats['あ'], { seen: 2, correct: 1, wrong: 1, streak: 0 });
});

test('じゅんばんモードでは、あ行ができてから か行が出てくる', () => {
  let p = core.emptyProgress();
  assert.equal(core.nextRowToUnlock(p), null);
  assert.deepEqual(core.activeRows(p, { rowMode: 'auto' }), ['あ']);

  p = withStats([['あ', true, 3], ['い', true, 3], ['う', true, 3], ['え', true, 3]]);
  assert.equal(core.nextRowToUnlock(p), null, 'お が残っていれば まだ開放しない');

  p = withStats(['あいうえお'].flatMap(() => []).concat(
    Array.from('あいうえお').map((k) => [k, true, 3])
  ));
  assert.equal(core.nextRowToUnlock(p), 'か');
  p = { ...p, unlocked: ['あ', 'か'] };
  assert.deepEqual(core.activeRows(p, { rowMode: 'auto' }), ['あ', 'か']);
  assert.equal(core.nextRowToUnlock(p), null, 'か行はまだなので さ行は出ない');
});

test('行をえらぶモードでは 指定した行だけが出る', () => {
  const p = { ...core.emptyProgress(), unlocked: ['あ', 'か', 'さ'] };
  const pool = core.poolFor(p, { rowMode: 'custom', rows: ['は'] }, 'listen');
  assert.deepEqual(pool.map((e) => e.k), ['は', 'ひ', 'ふ', 'へ', 'ほ']);
});

test('poolFor は「を」を出題せず、絵の問題では「ん」も外す', () => {
  const p = { ...core.emptyProgress(), unlocked: ['わ'] };
  const settings = { rowMode: 'custom', rows: ['わ'] };
  assert.deepEqual(core.poolFor(p, settings, 'listen').map((e) => e.k), ['わ', 'ん']);
  assert.deepEqual(core.poolFor(p, settings, 'picture').map((e) => e.k), ['わ']);
});

test('選択肢の数は、できる文字が増えるほど 2→3→4 と増える', () => {
  const settings = { rowMode: 'custom', rows: ['あ'] };
  const pool = core.poolFor(core.emptyProgress(), settings, 'listen');
  assert.equal(core.choiceCount(core.emptyProgress(), pool), 2);

  const some = withStats([['あ', true, 3], ['い', true, 3]]);
  assert.equal(core.choiceCount(some, pool), 3);

  const most = withStats(Array.from('あいうえお').map((k) => [k, true, 3]));
  assert.equal(core.choiceCount(most, pool), 4);
});

test('pickTarget は にがてな文字を えらびやすい', () => {
  const settings = { rowMode: 'custom', rows: ['あ'] };
  const pool = core.poolFor(core.emptyProgress(), settings, 'listen');
  // 「あ」だけ何度もまちがえ、ほかは とくいにする
  let p = withStats([['あ', false, 3]]);
  p = Array.from('いうえお').reduce((acc, k) => {
    let next = acc;
    for (let i = 0; i < 6; i += 1) next = core.recordAnswer(next, k, true);
    return next;
  }, p);

  let hits = 0;
  const rand = (() => { let i = 0; return () => ((i++ * 0.017) % 1); })();
  for (let i = 0; i < 400; i += 1) {
    if (core.pickTarget(p, pool, rand).k === 'あ') hits += 1;
  }
  assert.ok(hits > 400 * 0.4, `にがてな「あ」が多く出ること (実際: ${hits}/400)`);
});

test('pickTarget は 直前と同じ文字を続けて出さない', () => {
  const settings = { rowMode: 'custom', rows: ['あ'] };
  const pool = core.poolFor(core.emptyProgress(), settings, 'listen');
  for (let i = 0; i < 50; i += 1) {
    assert.notEqual(core.pickTarget(core.emptyProgress(), pool, Math.random, 'う').k, 'う');
  }
});

test('まちがい選択肢は 形の似た文字から先に選ばれる', () => {
  const settings = { rowMode: 'custom', rows: ['あ', 'な', 'ま'] };
  const pool = core.poolFor(core.emptyProgress(), settings, 'listen');
  const picked = core.pickDistractors('ぬ', pool, 2, seq(0.1, 0.4, 0.7, 0.2));
  assert.equal(picked.length, 2);
  picked.forEach((e) => assert.ok(['め', 'あ'].includes(e.k), `似た文字であること: ${e.k}`));
  assert.ok(!picked.some((e) => e.k === 'ぬ'), '正解は選択肢の重複に入らない');
});

test('makeQuestion(listen) は 正解を1つだけ含む', () => {
  const p = core.emptyProgress();
  const settings = { rowMode: 'custom', rows: ['あ', 'か'] };
  for (let i = 0; i < 100; i += 1) {
    const q = core.makeQuestion('listen', p, settings, Math.random);
    const ids = q.choices.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, '選択肢に重複がない');
    assert.equal(ids.filter((id) => id === q.correctId).length, 1);
    assert.equal(q.target.k, q.correctId);
  }
});

test('makeQuestion(picture) は 絵ことばを持つ文字だけを出す', () => {
  const p = { ...core.emptyProgress(), unlocked: ['わ', 'ら'] };
  const settings = { rowMode: 'custom', rows: ['わ', 'ら'] };
  for (let i = 0; i < 50; i += 1) {
    const q = core.makeQuestion('picture', p, settings, Math.random);
    assert.ok(q.entry.emoji, '絵がある');
    assert.equal(Array.from(q.entry.word)[0], q.correctId, 'ことばの1文字目が答え');
  }
});

test('makeQuestion(word) の あなは 正解の文字の位置になる', () => {
  const p = core.emptyProgress();
  const settings = { rowMode: 'custom', rows: ['あ', 'か', 'さ', 'た', 'な'] };
  for (let i = 0; i < 100; i += 1) {
    const q = core.makeQuestion('word', p, settings, Math.random);
    assert.equal(q.chars.join(''), q.entry.word);
    assert.equal(q.chars[q.blankIndex], q.correctId);
    assert.ok(q.choices.some((c) => c.id === q.correctId));
  }
});

test('makeQuestion は 文字が1つしかないときは null を返す', () => {
  const p = { ...core.emptyProgress(), unlocked: ['わ'] };
  assert.equal(core.makeQuestion('picture', p, { rowMode: 'custom', rows: ['わ'] }, Math.random), null);
});

test('summary は 進み具合を数える', () => {
  const p = withStats([['あ', true, 6], ['い', true, 3], ['う', false, 1]]);
  const s = core.summary(p);
  assert.equal(s.total, 45, '「を」は数えない');
  assert.equal(s.seen, 2, 'まちがえただけの「う」は まだ読めた扱いにしない');
  assert.equal(s.can, 2);
  assert.equal(s.good, 1);
  assert.equal(s.stars, 9);
});

test('絵ことばは ひらがな（濁点・小文字をふくむ）だけでできている', () => {
  KANA.filter((e) => e.picture !== false).forEach((e) => {
    Array.from(e.word).forEach((c) => {
      assert.ok(/[\u3041-\u3096ー]/.test(c), `${e.word} の ${c} は ひらがな`);
    });
    // 1文字目（＝答えになる文字）は 五十音表そのままの文字であること
    assert.ok(BY_KANA.has(Array.from(e.word)[0]));
  });
});

test('1文字だけ苦手でも、たくさん練習していれば つぎの行に進める', () => {
  let p = core.emptyProgress();
  Array.from('あいうえ').forEach((k) => {
    for (let i = 0; i < 3; i += 1) p = core.recordAnswer(p, k, true);
  });
  // 「お」だけ まちがえ続けている
  for (let i = 0; i < 3; i += 1) p = core.recordAnswer(p, 'お', false);
  assert.equal(core.isRowMastered(p, 'あ'), false);
  assert.equal(core.isRowReady(p, 'あ'), true);
  assert.equal(core.nextRowToUnlock(p), 'か');
});

test('練習が足りないうちは つぎの行に進まない', () => {
  let p = core.emptyProgress();
  Array.from('あいうえ').forEach((k) => {
    for (let i = 0; i < 3; i += 1) p = core.recordAnswer(p, k, true);
  });
  assert.equal(core.isRowReady(p, 'あ'), false, '「お」を1度も出していない');
  assert.equal(core.nextRowToUnlock(p), null);
});

test('なぞりがきは 読みの習熟度とは別に数え、星だけ増える', () => {
  let p = core.emptyProgress();
  p = core.recordWriting(p, 'あ');
  p = core.recordWriting(p, 'あ');
  assert.equal(core.writtenCount(p, 'あ'), 2);
  assert.equal(core.levelOf(p, 'あ'), 0, '書いても 読めることにはしない');
  assert.equal(p.stars, 2);
  assert.equal(core.summary(p).wrote, 1);
});

test('なぞりがきは 書いた回数の少ない字から出す', () => {
  const settings = { rowMode: 'custom', rows: ['あ'] };
  const pool = core.poolFor(core.emptyProgress(), settings, 'write');
  let p = core.emptyProgress();
  Array.from('あいうえ').forEach((k) => { p = core.recordWriting(p, k); });
  for (let i = 0; i < 20; i += 1) {
    assert.equal(core.pickWritingTarget(p, pool, Math.random).k, 'お');
  }
  assert.notEqual(core.pickWritingTarget(p, pool, Math.random, 'お'), null, '直前と同じ字は さける');
});
