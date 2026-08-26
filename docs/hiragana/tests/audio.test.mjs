// node --test docs/hiragana/tests/audio.test.mjs
// audio.js は window が無い環境では読み上げを行わないので、Node でも読み込める。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as audio from '../js/audio.js';

test('1文字は 促音をつけず、句点で区切って くりかえす', () => {
  assert.equal(audio.kanaSpeechText('あ'), '　あ。　　あ。');
  assert.equal(audio.kanaSpeechText('ん'), '　ん。　　ん。');
  assert.equal(audio.kanaSpeechText('あ', false), '　あ。');
  assert.ok(!audio.kanaSpeechText('あ').includes('っ'), '「あっ」のような つまる音にしない');
  assert.ok(audio.kanaSpeechText('か').startsWith('　'), '出だしが切れないよう 助走をつける');
});

test('1文字の速さは ふつうより かなり ゆっくりで、下限と上限がある', () => {
  assert.ok(audio.kanaRate(0.75) <= 0.42, `既定（0.75）で ゆっくり: ${audio.kanaRate(0.75)}`);
  assert.equal(audio.kanaRate(0.4), 0.35, '遅くしすぎない（つぶれて聞こえるため）');
  assert.equal(audio.kanaRate(1.2), 0.55, '速くしすぎない');
  assert.ok(audio.kanaRate(0.9) > audio.kanaRate(0.6), '設定の速さは反映される');
});

test('読み終わりの見積もりは 遅いほど長くなる', () => {
  const slow = audio.speakTimeout('　あ。　　あ。', 0.5);
  const fast = audio.speakTimeout('　あ。　　あ。', 1);
  assert.ok(slow > fast);
  assert.ok(fast > 1200, '短い文でも すぐ打ち切らない');
});

test('読み上げが使えない環境では 落ちずに false を返す', async () => {
  assert.equal(audio.canSpeak(), false);
  assert.equal(await audio.speak('あ'), false);
  assert.equal(await audio.speakKana('あ'), false);
  assert.deepEqual(audio.voices(), []);
  audio.configure({ rate: 0.7, sound: false, kanaRepeat: false });   // 例外が出ないこと
  assert.doesNotThrow(() => audio.sfx.listen());
});
