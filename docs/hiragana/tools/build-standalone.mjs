// index.html と js/*.js・styles.css を 1枚の HTML にまとめる。
// サーバーを立てられない環境（ファイルを直接ひらく／配布する）向け。
//
//   node docs/hiragana/tools/build-standalone.mjs [出力先.html]
//   node docs/hiragana/tools/build-standalone.mjs --fragment out.html   # <body> の中身だけ
//
// ES モジュールの import / export を外して 1つのスクリプトに連結するだけなので、
// js/ 配下を編集したら作り直せば同じものができる。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 依存の順に並べる（先に定義されたものを後ろのファイルが使う）
const MODULES = [
  'data.js', 'strokes.js', 'core.js', 'trace.js', 'action.js',
  'store.js', 'audio.js', 'balloon.js', 'write.js', 'app.js',
];

const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8');

/** 1つのモジュールから import 文を取り除き、export された名前を集める。 */
function flatten(name, src) {
  const exported = [];
  const body = src
    .replace(/^\s*import[\s\S]*?from\s*'[^']+';\s*$/gm, '')
    .replace(/^export\s+(async\s+)?(const|let|function|class)\s+([A-Za-z0-9_$]+)/gm, (_m, asyncKw = '', kind, id) => {
      exported.push(id);
      return `${asyncKw}${kind} ${id}`;
    });
  if (/^export\s/m.test(body)) throw new Error(`${name}: 対応していない export があります`);
  return { ns: path.basename(name, '.js'), body: body.trim(), exported };
}

function buildScript() {
  const parts = MODULES.map((m) => flatten(m, read(`js/${m}`)));
  const seen = new Map();
  parts.forEach((p) => p.exported.forEach((id) => {
    if (seen.has(id)) throw new Error(`名前が重複しています: ${id}（${seen.get(id)} と ${p.ns}）`);
    seen.set(id, p.ns);
  }));
  // 各モジュールを関数で包み、export した名前だけを外に出す。
  // こうしないと、別々のファイルで同じ名前の内部変数（ctx や target など）がぶつかる。
  return parts.map((p) => [
    `/* ── ${p.ns}.js ── */`,
    `const ${p.ns} = (() => {`,
    p.body,
    `return { ${p.exported.join(', ')} };`,
    `})();`,
    p.exported.length ? `const { ${p.exported.join(', ')} } = ${p.ns};` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

function build({ fragment = false } = {}) {
  const css = read('styles.css');
  const script = buildScript();
  // 差し込む中身に $ が含まれていても壊れないよう、置換は必ず関数で渡す
  let html = read('index.html')
    .replace(/\s*<link rel="manifest"[^>]*>/, () => '')
    .replace(/\s*<link rel="stylesheet" href="styles\.css">/, () => `\n  <style>\n${css}\n  </style>`)
    .replace(/<script type="module" src="js\/app\.js"><\/script>/,
      () => `<script type="module">\n${script}\n  </script>`);
  if (!fragment) return html;
  // --fragment: <html>/<head>/<body> を用意してくれる場所に貼るための、中身だけの形
  const head = [
    /<title>[\s\S]*?<\/title>/.exec(html)[0],
    ...(html.match(/<link rel="preconnect"[^>]*>/g) || []),
    ...(html.match(/<link rel="stylesheet" href="https:[^"]*"[^>]*>/g) || []),
    /<style>[\s\S]*?<\/style>/.exec(html)[0],
  ].join('\n');
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
  return `${head}\n${body}\n`;
}

const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || path.join(DIR, 'hiragana-standalone.html');
fs.writeFileSync(out, build({ fragment }));
console.log(`${out} を書き出しました（${(fs.statSync(out).size / 1024).toFixed(0)} KB）`);
