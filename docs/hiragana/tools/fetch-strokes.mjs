// KanjiVG（https://kanjivg.tagaini.net/ · CC BY-SA 3.0）から
// ひらがな46字の書き順つき字形データを取得して js/strokes.js を作り直す。
//
//   node docs/hiragana/tools/fetch-strokes.mjs
//
// 生成物は KanjiVG の二次的著作物にあたるため、CC BY-SA 3.0 のまま配布する。
// 出力ファイルの先頭に出典とライセンスを書き込む。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KANA = Array.from('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん');
const BASE = 'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji';

const code = (ch) => ch.codePointAt(0).toString(16).padStart(5, '0');

/** 小数点以下を丸めて、意味が変わらない範囲でデータを小さくする */
const round = (d) => d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10));

const strokes = {};
for (const ch of KANA) {
  const url = `${BASE}/${code(ch)}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${ch}: ${url} が取得できません (${res.status})`);
  const svg = await res.text();
  const paths = Array.from(svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)).map((m) => round(m[1]));
  if (!paths.length) throw new Error(`${ch}: 線が見つかりません`);
  strokes[ch] = paths;
  process.stdout.write(`${ch}${paths.length} `);
}
process.stdout.write('\n');

const body = KANA.map((ch) =>
  `  '${ch}': [\n${strokes[ch].map((d) => `    '${d}',`).join('\n')}\n  ],`).join('\n');

fs.writeFileSync(path.join(DIR, 'js/strokes.js'), `// ひらがなの書き順データ（1画ずつの SVG パス。座標系は 109×109）。
//
// 出典: KanjiVG — https://kanjivg.tagaini.net/
// Copyright (C) 2009-2011 Ulrich Apel.
// クリエイティブ・コモンズ 表示 - 継承 3.0 (CC BY-SA 3.0) のもとで配布されています。
// https://creativecommons.org/licenses/by-sa/3.0/
// このファイルは KanjiVG の二次的著作物であり、同じライセンスが適用されます。
//
// 作り直すには: node docs/hiragana/tools/fetch-strokes.mjs

export const STROKE_BOX = 109;

export const STROKES = {
${body}
};
`);
console.log('js/strokes.js を書き出しました');
