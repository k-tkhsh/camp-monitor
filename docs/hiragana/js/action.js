// ふうせんわりの動き。DOM に触れない純粋なロジック（tests/trace.test.mjs でテストする）。
// 画面は横幅・高さともに 100 の割合座標であつかう。

export const FIELD = 100;

/** 割った数に応じて少しずつ速くなる。小さい子でも追えるよう上限は低め。 */
export function speedFor(popped) {
  return Math.min(10, 6 + popped * 0.35);       // 1秒あたりに上がる割合
}

/** 同時に浮かぶ数。慣れるまでは少なく。 */
export function balloonLimit(popped) {
  return popped < 4 ? 4 : (popped < 10 ? 5 : 6);
}

let seq = 0;
export function makeBalloon(kana, popped, rand = Math.random) {
  seq += 1;
  return {
    id: `b${seq}`,
    k: kana,
    x: 12 + rand() * 76,
    y: -12 - rand() * 16,                     // 地面の下から ふわりと出てくる
    speed: speedFor(popped) * (0.85 + rand() * 0.3),
    sway: 3 + rand() * 5,
    phase: rand() * Math.PI * 2,
    color: Math.floor(rand() * 6),
  };
}

/**
 * dt 秒ぶん進める。ふうせんは上にのぼり、空の上に消えたものは escaped に入れて取り除く。
 * 元の配列は変えない。
 */
export function updateBalloons(balloons, dt) {
  const alive = [];
  const escaped = [];
  balloons.forEach((b) => {
    const y = b.y + b.speed * dt;
    if (y > FIELD + 16) escaped.push(b);
    else alive.push({ ...b, y, phase: b.phase + dt * 1.6 });
  });
  return { balloons: alive, escaped };
}

/** 画面のゆれ幅（左右のふわふわ）。 */
export const swayOf = (b) => Math.sin(b.phase) * b.sway;

/**
 * つぎに出すふうせんの文字を決める。
 * さがしている文字が画面に無ければ、かならずそれを出す。
 */
export function nextKana(target, onScreen, pool, rand = Math.random) {
  if (!onScreen.includes(target)) return target;
  const others = pool.filter((k) => k !== target && !onScreen.includes(k));
  const list = others.length ? others : pool.filter((k) => k !== target);
  if (!list.length) return target;
  return list[Math.floor(rand() * list.length)];
}
