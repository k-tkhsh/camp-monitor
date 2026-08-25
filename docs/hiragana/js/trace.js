// なぞりがきの判定。DOM に触れない純粋なロジック（tests/trace.test.mjs でテストする）。
// 座標は KanjiVG と同じ 109×109 の系で扱う。

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 1画ぶんのなぞりを見守る係。
 * 指の位置を feed() で渡すと、書き始めの位置・向き・どこまでなぞれたかを教える。
 *
 * points   : その画を等間隔に切った点の列（先頭が書き始め）
 * tolerance: 線からどれだけずれてよいか（109 に対する長さ）
 * required : 何割なぞれたら合格とするか
 */
export function createTracer(points, opts = {}) {
  const tol = opts.tolerance ?? 13;
  const required = opts.required ?? 0.82;
  const lookahead = opts.lookahead ?? 10;
  const last = points.length - 1;

  let idx = 0;
  let started = false;
  let reversed = false;

  const state = () => ({
    started,
    reversed,
    progress: last > 0 ? idx / last : 1,
  });

  return {
    feed(p) {
      if (!started) {
        // 書き始めの点にふれたらスタート。終わりの点から始めたら「はんたい」と教える。
        if (dist(p, points[0]) <= tol * 1.6) started = true;
        else if (dist(p, points[last]) <= tol * 1.6) reversed = true;
        return state();
      }
      let best = idx;
      const limit = Math.min(last, idx + lookahead);
      for (let j = idx; j <= limit; j += 1) {
        if (dist(p, points[j]) <= tol) best = j;
      }
      idx = Math.max(idx, best);
      return state();
    },
    state,
    result() {
      const s = state();
      return { ...s, ok: started && s.progress >= required };
    },
  };
}

/** 指が飛んだときのために、2点のあいだを step ごとに埋める。 */
export function interpolate(from, to, step = 1.5) {
  const d = dist(from, to);
  if (d <= step) return [to];
  const n = Math.ceil(d / step);
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    out.push({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n });
  }
  return out;
}

/**
 * 画の長さに応じた見本アニメーションの時間（ミリ秒）。
 * 短い画をゆっくり、長い画を遅すぎないようにする。
 */
export function demoDuration(length) {
  return Math.round(Math.min(2200, Math.max(700, length * 14)));
}
