// 読み上げ（Web Speech API）と効果音（Web Audio API）。外部ファイルは使わない。

let ctx = null;
let enabled = true;
let rate = 0.8;
let kanaRepeat = true;
let voice = null;
let voiceURI = '';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export const canSpeak = () => !!synth;

function japaneseVoices() {
  if (!synth) return [];
  return synth.getVoices().filter((v) => /^ja/i.test(v.lang));
}

export function voices() {
  return japaneseVoices();
}

/**
 * 日本語の読み上げが使えそうか。
 * 音声一覧はあとから読み込まれる端末があるため、まだ空のときは「使える」とみなす。
 */
export function hasJapaneseVoice() {
  if (!synth) return false;
  const all = synth.getVoices();
  if (!all.length) return true;
  return all.some((v) => /^ja/i.test(v.lang));
}

function chooseVoice() {
  const list = japaneseVoices();
  if (!list.length) { voice = null; return; }
  voice = list.find((v) => v.voiceURI === voiceURI)
    || list.find((v) => /kyoko|o-ren|otoya|google|nanami|haruka|ayumi/i.test(v.name))
    || list[0];
}

if (synth) {
  chooseVoice();
  synth.addEventListener?.('voiceschanged', chooseVoice);
}

export function configure(opts = {}) {
  if (typeof opts.rate === 'number') rate = opts.rate;
  if (typeof opts.sound === 'boolean') enabled = opts.sound;
  if (typeof opts.kanaRepeat === 'boolean') kanaRepeat = opts.kanaRepeat;
  if (typeof opts.voiceURI === 'string') { voiceURI = opts.voiceURI; chooseVoice(); }
}

/** iOS などは最初のタップ時にしか音を鳴らし始められないので、そこで初期化する。 */
export function unlock() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
  if (synth) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch { /* 読み上げが使えなくても遊べる */ }
  }
}

export function stopSpeaking() {
  try { synth?.cancel(); } catch { /* noop */ }
}

/** 日本語で読み上げる。読み終わり（または失敗）で解決する Promise を返す。 */
export function speak(text, opts = {}) {
  if (!synth || !text) return Promise.resolve(false);
  const speed = opts.rate ?? rate;
  return new Promise((resolve) => {
    try {
      // cancel した直後に speak すると、頭が切れたり鳴らないことがある端末があるため、
      // 何か話していたときだけ すこし間をあける。
      const busy = synth.speaking || synth.pending;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = speed;
      u.pitch = opts.pitch ?? 1.05;
      if (voice) u.voice = voice;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(true); } };
      u.onend = finish;
      u.onerror = () => { if (!done) { done = true; resolve(false); } };
      // 端末によっては onend が来ないことがあるので、長さと速さから見積もった時間で打ち切る
      setTimeout(finish, speakTimeout(text, speed) + (busy ? 160 : 0));
      if (busy) setTimeout(() => synth.speak(u), 160);
      else synth.speak(u);
    } catch {
      resolve(false);
    }
  });
}

/** onend が来ない端末のための、読み終わりの見積もり時間（ミリ秒）。 */
export function speakTimeout(text, speed = 1) {
  return Math.round(1200 + (Array.from(text).length * 260) / Math.max(0.3, speed));
}

/**
 * 1文字を読ませるときの言い方。
 * 「あっ」のように促音をつけると音がつまって聞き取りにくいので、
 * 句点で区切って ゆっくり2回くりかえす（「あ。 あ」）。
 * 先頭の全角スペースは、出だしが切れる端末むけの助走。
 */
export function kanaSpeechText(k, repeat = true) {
  return repeat ? `　${k}。　${k}。` : `　${k}。`;
}

/** 1文字のときの速さ。ふつうの読み上げより ゆっくりにする。 */
export function kanaRate(base = rate) {
  return Math.max(0.4, Math.min(0.62, base * 0.75));
}

/** ひらがな1文字を、はっきり ゆっくり読む。 */
export function speakKana(k, opts = {}) {
  const repeat = opts.repeat ?? kanaRepeat;
  return speak(kanaSpeechText(k, repeat), { rate: kanaRate(), pitch: 1 });
}

function tone(freq, start, dur, type = 'sine', gain = 0.18) {
  if (!ctx || !enabled) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.02);
}

export const sfx = {
  tap()     { tone(660, 0, 0.08, 'triangle', 0.10); },
  /** これから 文字を読むよ、という合図。読み上げの出だしが切れても気づけるようにする。 */
  listen()  { tone(880, 0, 0.10, 'sine', 0.10); tone(1175, 0.11, 0.14, 'sine', 0.09); },
  correct() { [784, 988, 1319].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.16)); },
  wrong()   { tone(300, 0, 0.16, 'sine', 0.10); tone(240, 0.12, 0.20, 'sine', 0.09); },
  fanfare() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.34, 'triangle', 0.17));
  },
};
