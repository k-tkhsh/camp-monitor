// 進み具合と設定の保存。端末の localStorage にだけ保存し、外には送らない。
import { emptyProgress, PROGRESS_VERSION } from './core.js';

const PROGRESS_KEY = 'hiragana.progress.v1';
const SETTINGS_KEY = 'hiragana.settings.v1';

export const defaultSettings = () => ({
  rowMode: 'auto',      // 'auto' = できたら次の行が出てくる / 'custom' = 行を指定
  rows: ['あ'],
  rate: 0.8,            // 読み上げの速さ
  kanaRepeat: true,     // 1文字を 2回くりかえして読む
  sound: true,          // 効果音
  voiceURI: '',         // 使う音声（未指定なら自動）
});

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* プライベートモードなどで保存できなくても遊べるようにする */
  }
}

export function loadProgress() {
  const data = read(PROGRESS_KEY, null);
  if (!data || data.version !== PROGRESS_VERSION) return emptyProgress();
  return { ...emptyProgress(), ...data };
}

export function saveProgress(progress) {
  write(PROGRESS_KEY, progress);
}

export function loadSettings() {
  return { ...defaultSettings(), ...read(SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

export function resetProgress() {
  write(PROGRESS_KEY, emptyProgress());
  return emptyProgress();
}
