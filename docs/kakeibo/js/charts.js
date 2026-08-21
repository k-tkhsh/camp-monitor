// ============================================================
// charts.js — 依存ライブラリなしの SVG グラフ描画
// ============================================================
import { yen } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx, cy, rOuter, rInner, from, to) {
  const large = to - from > 180 ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, from);
  const [x2, y2] = polar(cx, cy, rOuter, to);
  const [x3, y3] = polar(cx, cy, rInner, to);
  const [x4, y4] = polar(cx, cy, rInner, from);
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

/**
 * ドーナツグラフ。data: [{name, amount, color, ratio}]
 * onSelect が渡されたら扇形クリックで呼び出す。
 */
export function donut(data, { size = 220, centerLabel = '支出', centerValue = 0, onSelect } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'chart chart-donut', role: 'img' });
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter * 0.62;
  const total = data.reduce((a, d) => a + d.amount, 0);

  if (total <= 0) {
    svg.appendChild(el('circle', { cx, cy, r: (rOuter + rInner) / 2, fill: 'none', stroke: 'var(--border)', 'stroke-width': rOuter - rInner }));
  } else {
    let angle = 0;
    data.forEach((d) => {
      const sweep = (d.amount / total) * 360;
      // 1 件しかない場合は円弧が閉じないため full circle で描く
      const path =
        sweep >= 359.99
          ? el('circle', { cx, cy, r: (rOuter + rInner) / 2, fill: 'none', stroke: d.color, 'stroke-width': rOuter - rInner })
          : el('path', { d: arcPath(cx, cy, rOuter, rInner, angle, angle + sweep), fill: d.color });
      path.setAttribute('class', 'slice');
      const title = el('title');
      title.textContent = `${d.name} ${yen(d.amount)} (${Math.round((d.amount / total) * 100)}%)`;
      path.appendChild(title);
      if (onSelect) {
        path.style.cursor = 'pointer';
        path.addEventListener('click', () => onSelect(d));
      }
      svg.appendChild(path);
      angle += sweep;
    });
  }

  const label = el('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'donut-label' });
  label.textContent = centerLabel;
  const value = el('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', class: 'donut-value' });
  value.textContent = yen(centerValue || total);
  svg.appendChild(label);
  svg.appendChild(value);
  return svg;
}

/** 収入・支出の月次比較棒グラフ。series: [{label, income, expense}] */
export function barChart(series, { width = 320, height = 180 } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart chart-bar', role: 'img' });
  const padX = 8;
  const padBottom = 22;
  const padTop = 10;
  const max = Math.max(1, ...series.flatMap((s) => [s.income, s.expense]));
  const slot = (width - padX * 2) / Math.max(1, series.length);
  const barW = Math.min(14, slot / 3);
  const plotH = height - padBottom - padTop;

  svg.appendChild(el('line', { x1: padX, y1: height - padBottom, x2: width - padX, y2: height - padBottom, stroke: 'var(--border)' }));

  series.forEach((s, i) => {
    const base = padX + slot * i + slot / 2;
    const bars = [
      { v: s.income, color: 'var(--income)', dx: -barW * 0.6, name: '収入' },
      { v: s.expense, color: 'var(--expense)', dx: barW * 0.6, name: '支出' },
    ];
    bars.forEach((b) => {
      const h = Math.max(b.v > 0 ? 2 : 0, (b.v / max) * plotH);
      const rect = el('rect', {
        x: base + b.dx - barW / 2,
        y: height - padBottom - h,
        width: barW,
        height: h,
        rx: 2,
        fill: b.color,
      });
      const title = el('title');
      title.textContent = `${s.label} ${b.name} ${yen(b.v)}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
    const label = el('text', { x: base, y: height - 6, 'text-anchor': 'middle', class: 'axis-label' });
    label.textContent = s.label;
    svg.appendChild(label);
  });
  return svg;
}

/** 資産推移の折れ線グラフ。series: [{label, value}] */
export function lineChart(series, { width = 320, height = 160 } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart chart-line', role: 'img' });
  const padX = 12;
  const padBottom = 22;
  const padTop = 12;
  const values = series.map((s) => s.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const plotH = height - padBottom - padTop;
  const stepX = (width - padX * 2) / Math.max(1, series.length - 1);
  const pt = (i, v) => [padX + stepX * i, padTop + plotH - ((v - min) / span) * plotH];

  const points = series.map((s, i) => pt(i, s.value));
  if (points.length > 1) {
    const area = `M ${points[0][0]} ${height - padBottom} ` +
      points.map(([x, y]) => `L ${x} ${y}`).join(' ') +
      ` L ${points[points.length - 1][0]} ${height - padBottom} Z`;
    svg.appendChild(el('path', { d: area, fill: 'var(--accent-soft)' }));
    svg.appendChild(
      el('path', {
        d: points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '),
        fill: 'none',
        stroke: 'var(--accent)',
        'stroke-width': 2,
        'stroke-linejoin': 'round',
      })
    );
  }
  points.forEach(([x, y], i) => {
    const dot = el('circle', { cx: x, cy: y, r: 3.5, fill: 'var(--accent)' });
    const title = el('title');
    title.textContent = `${series[i].label} ${yen(series[i].value)}`;
    dot.appendChild(title);
    svg.appendChild(dot);
    const label = el('text', { x, y: height - 6, 'text-anchor': 'middle', class: 'axis-label' });
    label.textContent = series[i].label;
    svg.appendChild(label);
  });
  return svg;
}
