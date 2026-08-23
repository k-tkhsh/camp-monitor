// ============================================================
// app.js — 画面描画とイベント処理
// ============================================================
import * as core from './core.js';
import * as store from './store.js';
import { donut, barChart, lineChart } from './charts.js';

const { yen } = core;

// ── 状態 ────────────────────────────────────────────────────
let state = store.load();
let period = core.periodOf(core.todayStr(), state.settings.startDay);
let currentView = 'home';
let listFilter = { q: '', type: '', categoryId: '', accountId: '' };

// ── DOM ヘルパ ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'value') node.value = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return node;
}

const card = (...children) => h('div', { class: 'card' }, ...children);
const cardHead = (title, action) => h('div', { class: 'card-head' }, h('h2', { text: title }), action || null);

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ── 参照ヘルパ ──────────────────────────────────────────────
const catById = (id) => state.categories.find((c) => c.id === id) || null;
const accById = (id) => state.accounts.find((a) => a.id === id) || null;
const catsOf = (type) => state.categories.filter((c) => c.type === (type === 'income' ? 'income' : 'expense'));
const startDay = () => state.settings.startDay || 1;

function persist() {
  const res = store.save(state);
  if (!res.ok) toast('保存に失敗しました（保存容量を確認してください）');
}

function periodTx(key = period) {
  return core.filterTx(state.transactions, { period: key, startDay: startDay() });
}

function txTitle(tx) {
  if (tx.type === 'transfer') return '振替';
  const cat = catById(tx.categoryId);
  return tx.memo || tx.sub || (cat ? cat.name : '未分類');
}

function txSubtitle(tx) {
  if (tx.type === 'transfer') {
    const from = accById(tx.accountId);
    const to = accById(tx.toAccountId);
    return `${from ? from.name : '—'} → ${to ? to.name : '—'}`;
  }
  const cat = catById(tx.categoryId);
  const acc = accById(tx.accountId);
  return [cat ? cat.name : '未分類', tx.sub, acc ? acc.name : null].filter(Boolean).join(' ・ ');
}

function txIcon(tx) {
  if (tx.type === 'transfer') return '🔄';
  const cat = catById(tx.categoryId);
  return cat ? cat.icon : '🧾';
}

function signedAmount(tx) {
  if (tx.type === 'expense') return `-${yen(tx.amount).replace('-', '')}`;
  if (tx.type === 'income') return `+${yen(tx.amount)}`;
  return yen(tx.amount);
}

function txRow(tx) {
  const cat = catById(tx.categoryId);
  return h(
    'button',
    { type: 'button', class: 'row', onclick: () => openTxSheet(tx) },
    h('span', { class: 'row-icon', style: cat ? { background: `${cat.color}22` } : {}, text: txIcon(tx) }),
    h(
      'span',
      { class: 'row-main' },
      h('span', { class: 'row-title', text: txTitle(tx) }),
      h('span', { class: 'row-sub', text: txSubtitle(tx) })
    ),
    h('span', { class: `row-amount ${tx.type} num`, text: signedAmount(tx) })
  );
}

function weekday(dateStr) {
  const p = core.parseDate(dateStr);
  return ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
}

// ── 期間ナビ ────────────────────────────────────────────────
function setPeriod(key) {
  period = key;
  renderHeader();
  render();
}

function renderHeader() {
  $('#appName').textContent = state.settings.name || 'かけいぼ';
  $('#periodLabel').textContent = core.periodLabel(period, startDay());
}

// ============================================================
// ホーム
// ============================================================
function renderHome() {
  const view = $('#view-home');
  view.textContent = '';

  const txs = periodTx();
  const sum = core.summarize(txs);
  const prevKey = core.addMonths(period, -1);
  const prev = core.summarize(periodTx(prevKey));
  const diff = sum.expense - prev.expense;

  // 収支サマリー
  const summary = h(
    'dl',
    { class: 'summary' },
    h('div', { class: 'income' }, h('dt', { text: '収入' }), h('dd', { text: yen(sum.income) })),
    h(
      'div',
      { class: 'expense' },
      h('dt', { text: '支出' }),
      h('dd', { text: yen(sum.expense) }),
      h('div', {
        class: 'delta',
        text: prev.expense > 0 ? `前月比 ${diff >= 0 ? '+' : '−'}${yen(Math.abs(diff)).replace('¥', '¥')}` : '前月データなし',
      })
    ),
    h(
      'div',
      { class: 'net' },
      h('dt', { text: '収支' }),
      h('dd', { class: sum.net < 0 ? 'minus' : '', text: yen(sum.net) })
    )
  );
  view.appendChild(card(cardHead('今月の収支'), summary));

  // 資産
  const assets = core.totalAssets(state.accounts, state.transactions);
  const balances = core.accountBalances(state.accounts, state.transactions);
  const assetCard = card(
    cardHead('資産', h('button', { type: 'button', class: 'link', text: '口座を管理', onclick: () => switchView('settings') })),
    h('div', { class: 'hero-amount num', text: yen(assets.net) }),
    h('div', { class: 'hero-sub', text: `資産 ${yen(assets.assets)} ／ 負債 ${yen(assets.debts)}` }),
    h(
      'div',
      { class: 'rows', style: { marginTop: '8px' } },
      state.accounts.map((acc) =>
        h(
          'button',
          { type: 'button', class: 'row', onclick: () => openAccountSheet(acc) },
          h('span', { class: 'row-icon', text: store.accountTypeIcon(acc.type) }),
          h(
            'span',
            { class: 'row-main' },
            h('span', { class: 'row-title', text: acc.name }),
            h('span', { class: 'row-sub', text: store.accountTypeLabel(acc.type) })
          ),
          h('span', { class: 'row-amount num', text: yen(balances.get(acc.id) || 0) })
        )
      )
    )
  );
  view.appendChild(assetCard);

  // 支出内訳
  const rows = core.byCategory(txs, state.categories, 'expense');
  const chartCard = card(cardHead('支出の内訳'));
  if (rows.length === 0) {
    chartCard.appendChild(h('p', { class: 'empty', text: 'この期間の支出はまだありません' }));
  } else {
    chartCard.appendChild(donut(rows, { centerLabel: '支出合計', centerValue: sum.expense, onSelect: (d) => openCategoryDetail(d.categoryId) }));
    chartCard.appendChild(
      h(
        'div',
        { class: 'rows', style: { marginTop: '10px' } },
        rows.slice(0, 5).map((r) =>
          h(
            'button',
            { type: 'button', class: 'row', onclick: () => openCategoryDetail(r.categoryId) },
            h('span', { class: 'row-icon', style: { background: `${r.color}22` }, text: r.icon }),
            h(
              'span',
              { class: 'row-main' },
              h('span', { class: 'row-title', text: r.name }),
              h('span', { class: 'row-sub', text: `${Math.round(r.ratio * 100)}%` })
            ),
            h('span', { class: 'row-amount num', text: yen(r.amount) })
          )
        )
      )
    );
  }
  view.appendChild(chartCard);

  // 予算
  const prog = core.budgetProgress(txs, state.categories, state.budgets, period);
  if (prog.total.budget > 0) {
    view.appendChild(
      card(
        cardHead('今月の予算', h('button', { type: 'button', class: 'link', text: '設定', onclick: () => switchView('budget') })),
        h(
          'div',
          { class: 'bar-line' },
          h('span', { class: 'name' }, h('span', { text: `残り ${yen(prog.total.rest)}` })),
          h('span', { class: 'val' }, h('b', { text: yen(prog.total.used) }), ` / ${yen(prog.total.budget)}`)
        ),
        h(
          'div',
          { class: `bar ${prog.total.used > prog.total.budget ? 'over' : ''}`, style: { marginTop: '6px' } },
          h('span', { style: { width: `${Math.min(100, prog.total.ratio * 100)}%` } })
        ),
        h(
          'div',
          { style: { marginTop: '10px' } },
          prog.rows.filter((r) => r.budget > 0).slice(0, 4).map(budgetBar)
        )
      )
    );
  }

  // 最近の明細
  const recent = core.sortTx(txs).slice(0, 6);
  view.appendChild(
    card(
      cardHead('最近の明細', h('button', { type: 'button', class: 'link', text: 'すべて見る', onclick: () => switchView('list') })),
      recent.length
        ? h('div', { class: 'rows' }, recent.map(txRow))
        : h('p', { class: 'empty', text: '「＋」ボタンから入力してみましょう' })
    )
  );

  if (state.transactions.length === 0) {
    view.appendChild(
      card(
        h('p', { class: 'muted', style: { fontSize: '13px', marginBottom: '10px' }, text: 'まずは試してみますか？サンプルの明細と予算を読み込めます（あとで全削除できます）。' }),
        h('button', {
          type: 'button',
          class: 'btn btn-primary btn-block',
          text: 'サンプルデータを読み込む',
          onclick: () => {
            store.seedSample(state);
            persist();
            render();
            toast('サンプルデータを読み込みました');
          },
        })
      )
    );
  }
}

function budgetBar(r) {
  return h(
    'div',
    { class: 'bar-row' },
    h(
      'div',
      { class: 'bar-line' },
      h('span', { class: 'name' }, h('span', { text: `${r.icon} ${r.name}` })),
      h(
        'span',
        { class: `val ${r.over ? 'over-text' : ''}` },
        h('b', { text: yen(r.used) }),
        ` / ${yen(r.budget)}`
      )
    ),
    h('div', { class: `bar ${r.over ? 'over' : ''}` }, h('span', { style: { width: `${Math.min(100, r.ratio * 100)}%` } }))
  );
}

// ============================================================
// 履歴
// ============================================================
function renderList() {
  const view = $('#view-list');
  view.textContent = '';

  const filters = h(
    'div',
    { class: 'filters' },
    h('input', {
      class: 'full',
      type: 'search',
      placeholder: 'メモ・中項目で検索',
      value: listFilter.q,
      oninput: (e) => {
        listFilter.q = e.target.value;
        renderListResult();
      },
    }),
    selectField(
      [{ value: '', label: 'すべての種別' }, { value: 'expense', label: '支出' }, { value: 'income', label: '収入' }, { value: 'transfer', label: '振替' }],
      listFilter.type,
      (v) => {
        listFilter.type = v;
        listFilter.categoryId = '';
        renderList();
      }
    ),
    selectField(
      [{ value: '', label: 'すべての口座' }, ...state.accounts.map((a) => ({ value: a.id, label: a.name }))],
      listFilter.accountId,
      (v) => {
        listFilter.accountId = v;
        renderListResult();
      }
    ),
    selectField(
      [
        { value: '', label: 'すべてのカテゴリ' },
        ...state.categories
          .filter((c) => !listFilter.type || listFilter.type === 'transfer' || c.type === listFilter.type)
          .map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` })),
      ],
      listFilter.categoryId,
      (v) => {
        listFilter.categoryId = v;
        renderListResult();
      },
      'full'
    )
  );

  view.appendChild(card(cardHead('絞り込み'), filters));
  view.appendChild(h('div', { id: 'listResult', class: 'view' }));
  renderListResult();
}

function selectField(options, value, onChange, cls = '') {
  return h(
    'select',
    { class: cls, onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value, text: o.label }))
  );
}

function renderListResult() {
  const box = $('#listResult');
  if (!box) return;
  box.textContent = '';

  const txs = core.sortTx(
    core.filterTx(state.transactions, { period, startDay: startDay(), ...listFilter })
  );
  const sum = core.summarize(txs);

  box.appendChild(
    card(
      cardHead(`${txs.length} 件`),
      h(
        'dl',
        { class: 'summary' },
        h('div', { class: 'income' }, h('dt', { text: '収入' }), h('dd', { text: yen(sum.income) })),
        h('div', { class: 'expense' }, h('dt', { text: '支出' }), h('dd', { text: yen(sum.expense) })),
        h('div', { class: 'net' }, h('dt', { text: '収支' }), h('dd', { class: sum.net < 0 ? 'minus' : '', text: yen(sum.net) }))
      )
    )
  );

  if (txs.length === 0) {
    box.appendChild(card(h('p', { class: 'empty', text: '条件に合う明細がありません' })));
    return;
  }

  const groups = new Map();
  for (const tx of txs) {
    if (!groups.has(tx.date)) groups.set(tx.date, []);
    groups.get(tx.date).push(tx);
  }
  const listCard = card();
  for (const [date, items] of groups) {
    const dayTotal = core.summarize(items);
    listCard.appendChild(
      h(
        'div',
        { class: 'day-head' },
        h('strong', { text: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} (${weekday(date)})` }),
        h('span', { class: 'num', text: `支出 ${yen(dayTotal.expense)}` })
      )
    );
    listCard.appendChild(h('div', { class: 'rows' }, items.map(txRow)));
  }
  box.appendChild(listCard);
}

// ============================================================
// 分析
// ============================================================
function renderAnalysis() {
  const view = $('#view-analysis');
  view.textContent = '';

  const series = core.monthlySeries(state.transactions, period, 6, startDay());
  view.appendChild(
    card(
      cardHead('収支の推移（6ヶ月）'),
      barChart(series),
      h(
        'div',
        { class: 'legend' },
        h('span', {}, h('i', { class: 'dot', style: { background: 'var(--income)' } }), '収入'),
        h('span', {}, h('i', { class: 'dot', style: { background: 'var(--expense)' } }), '支出')
      )
    )
  );

  const assets = core.assetSeries(state.accounts, state.transactions, period, 6, startDay());
  view.appendChild(card(cardHead('資産の推移（6ヶ月）'), lineChart(assets)));

  const txs = periodTx();
  for (const type of ['expense', 'income']) {
    const rows = core.byCategory(txs, state.categories, type);
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const box = card(cardHead(type === 'expense' ? 'カテゴリ別の支出' : 'カテゴリ別の収入'));
    if (rows.length === 0) {
      box.appendChild(h('p', { class: 'empty', text: 'データがありません' }));
    } else {
      const prevRows = core.byCategory(periodTx(core.addMonths(period, -1)), state.categories, type);
      rows.forEach((r) => {
        const prev = prevRows.find((p) => p.categoryId === r.categoryId);
        const diff = r.amount - (prev ? prev.amount : 0);
        box.appendChild(
          h(
            'button',
            { type: 'button', class: 'bar-row', style: { width: '100%', textAlign: 'left' }, onclick: () => openCategoryDetail(r.categoryId) },
            h(
              'div',
              { class: 'bar-line' },
              h('span', { class: 'name' }, h('span', { text: `${r.icon} ${r.name}` })),
              h(
                'span',
                { class: 'val' },
                h('b', { text: yen(r.amount) }),
                ` ${Math.round(r.ratio * 100)}% ／ 前月 ${diff >= 0 ? '+' : '−'}${yen(Math.abs(diff))}`
              )
            ),
            h('div', { class: 'bar' }, h('span', { style: { width: `${(r.amount / (total || 1)) * 100}%`, background: r.color } }))
          )
        );
      });
    }
    view.appendChild(box);
  }
}

function openCategoryDetail(categoryId) {
  const cat = catById(categoryId);
  if (!cat) return;
  const txs = core.filterTx(state.transactions, { period, startDay: startDay(), categoryId });
  const subs = core.bySub(txs, categoryId);
  const total = txs.reduce((a, t) => a + t.amount, 0);
  const body = h(
    'div',
    {},
    h('div', { class: 'hero-amount num', text: yen(total) }),
    h('div', { class: 'hero-sub', style: { marginBottom: '12px' }, text: `${core.periodLabel(period, startDay())} ・ ${txs.length} 件` }),
    subs.length > 1
      ? h(
          'div',
          { style: { marginBottom: '12px' } },
          subs.map((s) =>
            h(
              'div',
              { class: 'bar-row' },
              h(
                'div',
                { class: 'bar-line' },
                h('span', { class: 'name' }, h('span', { text: s.name })),
                h('span', { class: 'val' }, h('b', { text: yen(s.amount) }))
              ),
              h('div', { class: 'bar' }, h('span', { style: { width: `${(s.amount / (total || 1)) * 100}%`, background: cat.color } }))
            )
          )
        )
      : null,
    h('div', { class: 'rows' }, core.sortTx(txs).map(txRow))
  );
  openSheet(`${cat.icon} ${cat.name}`, body);
}

// ============================================================
// 予算
// ============================================================
function renderBudget() {
  const view = $('#view-budget');
  view.textContent = '';

  const txs = periodTx();
  const prog = core.budgetProgress(txs, state.categories, state.budgets, period);
  const isMonthly = Boolean(state.budgets[period]);

  view.appendChild(
    card(
      cardHead('予算の消化状況'),
      h(
        'div',
        { class: 'bar-line' },
        h('span', { class: 'name' }, h('span', { text: prog.total.budget > 0 ? `残り ${yen(prog.total.rest)}` : '予算が未設定です' })),
        h('span', { class: 'val' }, h('b', { text: yen(prog.total.used) }), ` / ${yen(prog.total.budget)}`)
      ),
      h(
        'div',
        { class: `bar ${prog.total.used > prog.total.budget && prog.total.budget > 0 ? 'over' : ''}`, style: { marginTop: '6px' } },
        h('span', { style: { width: `${Math.min(100, prog.total.ratio * 100)}%` } })
      ),
      h('p', {
        class: 'hero-sub',
        style: { marginTop: '8px' },
        text: isMonthly ? 'この月だけの予算を使用中です' : '毎月の既定予算を使用中です',
      })
    )
  );

  const editor = card(
    cardHead(
      'カテゴリ別予算',
      h('button', {
        type: 'button',
        class: 'link',
        text: isMonthly ? '既定予算に戻す' : 'この月だけ変更',
        onclick: () => {
          if (isMonthly) {
            delete state.budgets[period];
            toast('既定の予算に戻しました');
          } else {
            state.budgets[period] = { ...(state.budgets.default || {}) };
            toast('この月だけの予算を作成しました');
          }
          persist();
          renderBudget();
        },
      })
    )
  );

  const target = isMonthly ? state.budgets[period] : state.budgets.default;
  catsOf('expense').forEach((cat) => {
    const used = txs.filter((t) => t.type === 'expense' && t.categoryId === cat.id).reduce((a, t) => a + t.amount, 0);
    const value = Number.isFinite(target[cat.id]) ? target[cat.id] : '';
    editor.appendChild(
      h(
        'div',
        { class: 'bar-row' },
        h(
          'div',
          { class: 'bar-line' },
          h('span', { class: 'name' }, h('span', { text: `${cat.icon} ${cat.name}` })),
          h('span', { class: 'val', text: `実績 ${yen(used)}` })
        ),
        h('input', {
          type: 'number',
          inputmode: 'numeric',
          min: '0',
          step: '1000',
          placeholder: '予算（円）',
          value: value === '' ? '' : String(value),
          onchange: (e) => {
            const v = core.parseAmount(e.target.value);
            if (!Number.isFinite(v) || v <= 0) delete target[cat.id];
            else target[cat.id] = v;
            persist();
            renderBudget();
          },
        })
      )
    );
  });
  view.appendChild(editor);
}

// ============================================================
// 設定
// ============================================================
function renderSettings() {
  const view = $('#view-settings');
  view.textContent = '';

  // 口座
  const balances = core.accountBalances(state.accounts, state.transactions);
  view.appendChild(
    card(
      cardHead('口座', h('button', { type: 'button', class: 'link', text: '＋ 追加', onclick: () => openAccountSheet(null) })),
      h(
        'div',
        { class: 'rows' },
        state.accounts.map((acc) =>
          h(
            'button',
            { type: 'button', class: 'row', onclick: () => openAccountSheet(acc) },
            h('span', { class: 'row-icon', text: store.accountTypeIcon(acc.type) }),
            h(
              'span',
              { class: 'row-main' },
              h('span', { class: 'row-title', text: acc.name }),
              h('span', { class: 'row-sub', text: `${store.accountTypeLabel(acc.type)} ・ 初期残高 ${yen(acc.initialBalance)}` })
            ),
            h('span', { class: 'row-amount num', text: yen(balances.get(acc.id) || 0) })
          )
        )
      )
    )
  );

  // カテゴリ
  const catCard = card(
    cardHead('カテゴリ', h('button', { type: 'button', class: 'link', text: '＋ 追加', onclick: () => openCategorySheet(null) }))
  );
  ['expense', 'income'].forEach((type) => {
    catCard.appendChild(h('div', { class: 'day-head' }, h('strong', { text: type === 'expense' ? '支出' : '収入' })));
    catCard.appendChild(
      h(
        'div',
        { class: 'chips', style: { padding: '8px 0' } },
        catsOf(type).map((cat) =>
          h('button', {
            type: 'button',
            class: 'chip',
            text: `${cat.icon} ${cat.name}`,
            onclick: () => openCategorySheet(cat),
          })
        )
      )
    );
  });
  view.appendChild(catCard);

  // 定期取引
  view.appendChild(
    card(
      cardHead('定期的な収支', h('button', { type: 'button', class: 'link', text: '＋ 追加', onclick: () => openRecurringSheet(null) })),
      state.recurring.length
        ? h(
            'div',
            { class: 'rows' },
            state.recurring.map((rule) =>
              h(
                'button',
                { type: 'button', class: 'row', onclick: () => openRecurringSheet(rule) },
                h('span', { class: 'row-icon', text: rule.enabled === false ? '⏸' : '🔁' }),
                h(
                  'span',
                  { class: 'row-main' },
                  h('span', { class: 'row-title', text: rule.name || '（無題）' }),
                  h('span', { class: 'row-sub', text: `毎月 ${rule.day} 日 ・ ${(catById(rule.categoryId) || {}).name || '振替'}` })
                ),
                h('span', { class: `row-amount ${rule.type} num`, text: yen(rule.amount) })
              )
            )
          )
        : h('p', { class: 'empty', text: '家賃やサブスクを登録すると毎月自動で記録されます' })
    )
  );

  // 全般
  view.appendChild(
    card(
      cardHead('全般'),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'setName', text: '家計簿の名前' }),
        h('input', {
          id: 'setName',
          type: 'text',
          value: state.settings.name || '',
          onchange: (e) => {
            state.settings.name = e.target.value.trim() || 'かけいぼ';
            persist();
            renderHeader();
          },
        })
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'setStartDay', text: '月の開始日（給料日締めなど）' }),
        h(
          'select',
          {
            id: 'setStartDay',
            onchange: (e) => {
              state.settings.startDay = Number(e.target.value);
              persist();
              period = core.periodOf(core.todayStr(), startDay());
              renderHeader();
              render();
              toast('集計期間を変更しました');
            },
          },
          Array.from({ length: 28 }, (_, i) =>
            h('option', { value: String(i + 1), selected: startDay() === i + 1, text: `${i + 1} 日` })
          )
        )
      )
    )
  );

  // データ
  view.appendChild(
    card(
      cardHead('データ'),
      h(
        'div',
        { class: 'btn-stack' },
        h('button', { type: 'button', class: 'btn', text: '⬇ CSV で書き出す', onclick: exportCSV }),
        h('button', { type: 'button', class: 'btn', text: '⬆ CSV を取り込む（MF ME 形式対応）', onclick: () => importFile('csv') }),
        h('button', { type: 'button', class: 'btn', text: '💾 バックアップ（JSON）', onclick: exportJSON }),
        h('button', { type: 'button', class: 'btn', text: '♻️ バックアップから復元', onclick: () => importFile('json') }),
        h('button', {
          type: 'button',
          class: 'btn btn-danger',
          text: '🗑 すべてのデータを削除',
          onclick: () => {
            if (!confirm('すべての明細・口座・カテゴリ・予算を削除して初期状態に戻します。よろしいですか？')) return;
            state = store.emptyState();
            persist();
            period = core.periodOf(core.todayStr(), startDay());
            renderHeader();
            render();
            toast('データを削除しました');
          },
        })
      ),
      h('p', {
        class: 'hero-sub',
        style: { marginTop: '10px' },
        text: `明細 ${state.transactions.length} 件 ・ この端末のブラウザ内（localStorage）にのみ保存されます。`,
      })
    )
  );
}

// ============================================================
// シート（モーダル）
// ============================================================
function openSheet(title, body, footer) {
  $('#sheetTitle').textContent = title;
  const bodyBox = $('#sheetBody');
  const footBox = $('#sheetFoot');
  bodyBox.textContent = '';
  footBox.textContent = '';
  bodyBox.appendChild(body);
  if (footer) footBox.appendChild(footer);
  $('#sheetRoot').hidden = false;
  bodyBox.scrollTop = 0;
}

function closeSheet() {
  $('#sheetRoot').hidden = true;
}

// ── 入力シート ──────────────────────────────────────────────
function openTxSheet(existing) {
  const isNew = !existing;
  const draft = existing
    ? { ...existing }
    : {
        id: null,
        date: clampDateToPeriod(core.todayStr()),
        type: 'expense',
        amount: '',
        categoryId: (catsOf('expense')[0] || {}).id || null,
        sub: '',
        accountId: (state.accounts[0] || {}).id || null,
        toAccountId: (state.accounts[1] || state.accounts[0] || {}).id || null,
        memo: '',
      };

  const body = h('div', {});
  const draw = () => {
    body.textContent = '';

    // 種別
    body.appendChild(
      h(
        'div',
        { class: 'seg', style: { marginBottom: '12px' } },
        [
          ['expense', '支出'],
          ['income', '収入'],
          ['transfer', '振替'],
        ].map(([value, label]) =>
          h('button', {
            type: 'button',
            'data-type': value,
            class: draft.type === value ? 'is-active' : '',
            text: label,
            onclick: () => {
              draft.type = value;
              if (value !== 'transfer') {
                const list = catsOf(value);
                if (!list.some((c) => c.id === draft.categoryId)) draft.categoryId = (list[0] || {}).id || null;
              }
              draw();
            },
          })
        )
      )
    );

    // 金額
    const amountInput = h('input', {
      class: 'amount-input',
      type: 'text',
      inputmode: 'numeric',
      placeholder: '0',
      value: draft.amount === '' ? '' : String(draft.amount),
      oninput: (e) => { draft.amount = e.target.value; },
    });
    body.appendChild(
      h(
        'div',
        { class: 'field' },
        h('label', { text: '金額（円）' }),
        amountInput,
        h(
          'div',
          { class: 'quick' },
          [100, 500, 1000, 5000, 10000].map((n) =>
            h('button', {
              type: 'button',
              text: `+${n.toLocaleString('ja-JP')}`,
              onclick: () => {
                const cur = core.parseAmount(amountInput.value);
                const next = (Number.isFinite(cur) ? cur : 0) + n;
                amountInput.value = String(next);
                draft.amount = String(next);
              },
            })
          ),
          h('button', {
            type: 'button',
            text: 'クリア',
            onclick: () => { amountInput.value = ''; draft.amount = ''; },
          })
        )
      )
    );

    // 日付
    body.appendChild(
      h(
        'div',
        { class: 'field' },
        h('label', { text: '日付' }),
        h('input', {
          type: 'date',
          value: draft.date,
          onchange: (e) => { draft.date = e.target.value || draft.date; },
        })
      )
    );

    if (draft.type === 'transfer') {
      body.appendChild(
        h(
          'div',
          { class: 'row2' },
          h(
            'div',
            { class: 'field' },
            h('label', { text: '出金元' }),
            selectField(state.accounts.map((a) => ({ value: a.id, label: a.name })), draft.accountId, (v) => { draft.accountId = v; })
          ),
          h(
            'div',
            { class: 'field' },
            h('label', { text: '入金先' }),
            selectField(state.accounts.map((a) => ({ value: a.id, label: a.name })), draft.toAccountId, (v) => { draft.toAccountId = v; })
          )
        )
      );
    } else {
      // カテゴリ
      const cats = catsOf(draft.type);
      body.appendChild(
        h(
          'div',
          { class: 'field' },
          h('label', { text: 'カテゴリ' }),
          h(
            'div',
            { class: 'chips' },
            cats.map((cat) =>
              h('button', {
                type: 'button',
                class: `chip ${draft.categoryId === cat.id ? 'is-active' : ''}`,
                text: `${cat.icon} ${cat.name}`,
                onclick: () => {
                  draft.categoryId = cat.id;
                  draft.sub = '';
                  draw();
                },
              })
            )
          )
        )
      );

      // 中項目
      const cat = catById(draft.categoryId);
      const listId = 'subs-list';
      body.appendChild(
        h(
          'div',
          { class: 'field' },
          h('label', { text: '中項目（任意）' }),
          h('input', {
            type: 'text',
            list: listId,
            placeholder: '例: 食料品',
            value: draft.sub || '',
            oninput: (e) => { draft.sub = e.target.value; },
          }),
          h('datalist', { id: listId }, ((cat && cat.subs) || []).map((s) => h('option', { value: s })))
        )
      );

      // 口座
      body.appendChild(
        h(
          'div',
          { class: 'field' },
          h('label', { text: draft.type === 'income' ? '入金先の口座' : '支払い元の口座' }),
          selectField(state.accounts.map((a) => ({ value: a.id, label: `${store.accountTypeIcon(a.type)} ${a.name}` })), draft.accountId, (v) => { draft.accountId = v; })
        )
      );
    }

    // メモ
    body.appendChild(
      h(
        'div',
        { class: 'field' },
        h('label', { text: 'メモ（任意）' }),
        h('input', {
          type: 'text',
          placeholder: '例: スーパーで買い物',
          value: draft.memo || '',
          oninput: (e) => { draft.memo = e.target.value; },
        })
      )
    );
  };
  draw();

  const saveBtn = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: isNew ? '登録する' : '更新する',
    onclick: () => {
      const amount = core.parseAmount(draft.amount);
      if (!Number.isFinite(amount) || amount <= 0) return toast('金額を入力してください');
      if (draft.type === 'transfer') {
        if (!draft.accountId || !draft.toAccountId) return toast('口座を選択してください');
        if (draft.accountId === draft.toAccountId) return toast('出金元と入金先が同じです');
      } else if (!draft.categoryId) {
        return toast('カテゴリを選択してください');
      }
      const date = core.normalizeDate(draft.date);
      if (!date) return toast('日付を確認してください');

      const record = {
        id: draft.id || core.uid('tx'),
        ruleId: draft.ruleId || undefined,
        date,
        type: draft.type,
        amount,
        categoryId: draft.type === 'transfer' ? null : draft.categoryId,
        sub: draft.type === 'transfer' ? '' : (draft.sub || '').trim(),
        accountId: draft.accountId,
        toAccountId: draft.type === 'transfer' ? draft.toAccountId : null,
        memo: (draft.memo || '').trim(),
        createdAt: draft.createdAt || Date.now(),
      };
      // 入力された中項目はカテゴリの候補として覚えておく
      const cat = catById(record.categoryId);
      if (cat && record.sub && !cat.subs.includes(record.sub)) cat.subs.push(record.sub);

      const idx = state.transactions.findIndex((t) => t.id === record.id);
      if (idx >= 0) state.transactions[idx] = record;
      else state.transactions.push(record);

      persist();
      closeSheet();
      period = core.periodOf(record.date, startDay());
      renderHeader();
      render();
      toast(isNew ? '登録しました' : '更新しました');
    },
  });

  const footer = h('div', { style: { display: 'flex', gap: '8px', width: '100%' } }, saveBtn);
  if (!isNew) {
    footer.insertBefore(
      h('button', {
        type: 'button',
        class: 'btn btn-danger',
        text: '削除',
        onclick: () => {
          if (!confirm('この明細を削除しますか？')) return;
          state.transactions = state.transactions.filter((t) => t.id !== existing.id);
          persist();
          closeSheet();
          render();
          toast('削除しました');
        },
      }),
      saveBtn
    );
  }

  openSheet(isNew ? '入力' : '明細を編集', body, footer);
}

/** 表示中の期間内の日付を初期値にする（過去月を見ているときの入力ミス防止） */
function clampDateToPeriod(today) {
  if (core.periodOf(today, startDay()) === period) return today;
  const { end } = core.periodRange(period, startDay());
  return end;
}

// ── 口座シート ──────────────────────────────────────────────
function openAccountSheet(existing) {
  const draft = existing
    ? { ...existing }
    : { id: null, name: '', type: 'bank', initialBalance: 0, color: '#42a5f5' };

  const body = h(
    'div',
    {},
    h('div', { class: 'field' }, h('label', { text: '口座名' }),
      h('input', { type: 'text', placeholder: '例: 三井住友銀行', value: draft.name, oninput: (e) => { draft.name = e.target.value; } })),
    h('div', { class: 'field' }, h('label', { text: '種別' }),
      selectField(store.ACCOUNT_TYPES.map((t) => ({ value: t.value, label: `${t.icon} ${t.label}` })), draft.type, (v) => { draft.type = v; })),
    h('div', { class: 'field' }, h('label', { text: '初期残高（円）' }),
      h('input', { type: 'text', inputmode: 'numeric', value: String(draft.initialBalance || 0), oninput: (e) => { draft.initialBalance = e.target.value; } })),
    existing
      ? h('p', { class: 'hero-sub', text: `現在の残高: ${yen(core.accountBalances(state.accounts, state.transactions).get(existing.id) || 0)}` })
      : null,
    h('p', { class: 'hero-sub', style: { marginTop: '8px' }, text: 'クレジットカードは残高がマイナス（＝未払い分）として資産に反映されます。' })
  );

  const footer = h(
    'div',
    { style: { display: 'flex', gap: '8px', width: '100%' } },
    existing && state.accounts.length > 1
      ? h('button', {
          type: 'button',
          class: 'btn btn-danger',
          text: '削除',
          onclick: () => {
            const used = state.transactions.filter((t) => t.accountId === existing.id || t.toAccountId === existing.id).length;
            if (used > 0) return toast(`この口座は ${used} 件の明細で使用中です`);
            if (!confirm(`「${existing.name}」を削除しますか？`)) return;
            state.accounts = state.accounts.filter((a) => a.id !== existing.id);
            persist();
            closeSheet();
            render();
            toast('口座を削除しました');
          },
        })
      : null,
    h('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: existing ? '更新する' : '追加する',
      onclick: () => {
        const name = (draft.name || '').trim();
        if (!name) return toast('口座名を入力してください');
        const initial = core.parseAmount(draft.initialBalance);
        const record = {
          id: draft.id || core.uid('acc'),
          name,
          type: draft.type,
          initialBalance: Number.isFinite(initial) ? initial : 0,
          color: draft.color,
        };
        const idx = state.accounts.findIndex((a) => a.id === record.id);
        if (idx >= 0) state.accounts[idx] = record;
        else state.accounts.push(record);
        persist();
        closeSheet();
        render();
        toast(existing ? '口座を更新しました' : '口座を追加しました');
      },
    })
  );

  openSheet(existing ? '口座を編集' : '口座を追加', body, footer);
}

// ── カテゴリシート ──────────────────────────────────────────
function openCategorySheet(existing) {
  const draft = existing
    ? { ...existing, subs: [...(existing.subs || [])] }
    : { id: null, name: '', icon: '🧾', color: '#5c6bc0', type: 'expense', subs: [] };

  const body = h(
    'div',
    {},
    h('div', { class: 'field' }, h('label', { text: '種別' }),
      h('div', { class: 'seg' }, [['expense', '支出'], ['income', '収入']].map(([value, label]) =>
        h('button', {
          type: 'button',
          'data-type': value,
          class: draft.type === value ? 'is-active' : '',
          text: label,
          onclick: (e) => {
            draft.type = value;
            [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('is-active', b.dataset.type === value));
          },
        })))),
    h('div', { class: 'row2' },
      h('div', { class: 'field' }, h('label', { text: 'アイコン' }),
        h('input', { type: 'text', maxlength: '4', value: draft.icon, oninput: (e) => { draft.icon = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { text: '色' }),
        h('input', { type: 'color', value: draft.color, oninput: (e) => { draft.color = e.target.value; }, style: { height: '40px', padding: '4px' } }))),
    h('div', { class: 'field' }, h('label', { text: 'カテゴリ名' }),
      h('input', { type: 'text', placeholder: '例: 食費', value: draft.name, oninput: (e) => { draft.name = e.target.value; } })),
    h('div', { class: 'field' }, h('label', { text: '中項目（カンマ区切り）' }),
      h('input', {
        type: 'text',
        placeholder: '食料品, 外食, カフェ',
        value: draft.subs.join(', '),
        oninput: (e) => { draft.subs = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); },
      }))
  );

  const footer = h(
    'div',
    { style: { display: 'flex', gap: '8px', width: '100%' } },
    existing
      ? h('button', {
          type: 'button',
          class: 'btn btn-danger',
          text: '削除',
          onclick: () => {
            const used = state.transactions.filter((t) => t.categoryId === existing.id).length;
            if (used > 0) return toast(`このカテゴリは ${used} 件の明細で使用中です`);
            if (!confirm(`「${existing.name}」を削除しますか？`)) return;
            state.categories = state.categories.filter((c) => c.id !== existing.id);
            for (const key of Object.keys(state.budgets)) delete state.budgets[key][existing.id];
            persist();
            closeSheet();
            render();
            toast('カテゴリを削除しました');
          },
        })
      : null,
    h('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: existing ? '更新する' : '追加する',
      onclick: () => {
        const name = (draft.name || '').trim();
        if (!name) return toast('カテゴリ名を入力してください');
        const record = {
          id: draft.id || core.uid('cat'),
          name,
          icon: (draft.icon || '🧾').slice(0, 4),
          color: draft.color,
          type: draft.type,
          subs: draft.subs,
        };
        const idx = state.categories.findIndex((c) => c.id === record.id);
        if (idx >= 0) state.categories[idx] = record;
        else state.categories.push(record);
        persist();
        closeSheet();
        render();
        toast(existing ? 'カテゴリを更新しました' : 'カテゴリを追加しました');
      },
    })
  );

  openSheet(existing ? 'カテゴリを編集' : 'カテゴリを追加', body, footer);
}

// ── 定期取引シート ──────────────────────────────────────────
function openRecurringSheet(existing) {
  const draft = existing
    ? { ...existing }
    : {
        id: null,
        name: '',
        type: 'expense',
        amount: '',
        categoryId: (catsOf('expense')[0] || {}).id || null,
        sub: '',
        accountId: (state.accounts[0] || {}).id || null,
        day: 27,
        memo: '',
        startDate: core.todayStr().slice(0, 8) + '01',
        enabled: true,
      };

  const body = h('div', {});
  const draw = () => {
    body.textContent = '';
    body.appendChild(
      h('div', { class: 'field' }, h('label', { text: '名前' }),
        h('input', { type: 'text', placeholder: '例: 家賃', value: draft.name, oninput: (e) => { draft.name = e.target.value; } }))
    );
    body.appendChild(
      h('div', { class: 'seg', style: { marginBottom: '12px' } },
        [['expense', '支出'], ['income', '収入']].map(([value, label]) =>
          h('button', {
            type: 'button',
            'data-type': value,
            class: draft.type === value ? 'is-active' : '',
            text: label,
            onclick: () => {
              draft.type = value;
              const list = catsOf(value);
              if (!list.some((c) => c.id === draft.categoryId)) draft.categoryId = (list[0] || {}).id || null;
              draw();
            },
          })))
    );
    body.appendChild(
      h('div', { class: 'row2' },
        h('div', { class: 'field' }, h('label', { text: '金額（円）' }),
          h('input', { type: 'text', inputmode: 'numeric', value: String(draft.amount || ''), oninput: (e) => { draft.amount = e.target.value; } })),
        h('div', { class: 'field' }, h('label', { text: '毎月の日付' }),
          selectField(Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 日` })), String(draft.day), (v) => { draft.day = Number(v); })))
    );
    body.appendChild(
      h('div', { class: 'field' }, h('label', { text: 'カテゴリ' }),
        selectField(catsOf(draft.type).map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` })), draft.categoryId, (v) => { draft.categoryId = v; }))
    );
    body.appendChild(
      h('div', { class: 'field' }, h('label', { text: '口座' }),
        selectField(state.accounts.map((a) => ({ value: a.id, label: a.name })), draft.accountId, (v) => { draft.accountId = v; }))
    );
    body.appendChild(
      h('div', { class: 'row2' },
        h('div', { class: 'field' }, h('label', { text: '開始日' }),
          h('input', { type: 'date', value: draft.startDate, onchange: (e) => { draft.startDate = e.target.value; } })),
        h('div', { class: 'field' }, h('label', { text: '終了日（任意）' }),
          h('input', { type: 'date', value: draft.endDate || '', onchange: (e) => { draft.endDate = e.target.value || null; } })))
    );
    body.appendChild(
      h('label', { class: 'chip', style: { cursor: 'pointer' } },
        h('input', {
          type: 'checkbox',
          checked: draft.enabled !== false,
          onchange: (e) => { draft.enabled = e.target.checked; },
          style: { width: 'auto' },
        }),
        ' 自動で記録する')
    );
  };
  draw();

  const footer = h(
    'div',
    { style: { display: 'flex', gap: '8px', width: '100%' } },
    existing
      ? h('button', {
          type: 'button',
          class: 'btn btn-danger',
          text: '削除',
          onclick: () => {
            if (!confirm('この定期取引を削除しますか？（登録済みの明細は残ります）')) return;
            state.recurring = state.recurring.filter((r) => r.id !== existing.id);
            persist();
            closeSheet();
            render();
            toast('定期取引を削除しました');
          },
        })
      : null,
    h('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: existing ? '更新する' : '追加する',
      onclick: () => {
        const amount = core.parseAmount(draft.amount);
        if (!Number.isFinite(amount) || amount <= 0) return toast('金額を入力してください');
        if (!draft.categoryId) return toast('カテゴリを選択してください');
        const record = {
          id: draft.id || core.uid('rule'),
          name: (draft.name || '').trim() || (catById(draft.categoryId) || {}).name || '定期',
          type: draft.type,
          amount,
          categoryId: draft.categoryId,
          sub: draft.sub || '',
          accountId: draft.accountId,
          day: draft.day,
          memo: draft.memo || '',
          startDate: core.normalizeDate(draft.startDate) || core.todayStr(),
          endDate: draft.endDate ? core.normalizeDate(draft.endDate) : null,
          enabled: draft.enabled !== false,
        };
        const idx = state.recurring.findIndex((r) => r.id === record.id);
        if (idx >= 0) state.recurring[idx] = record;
        else state.recurring.push(record);
        const created = store.applyRecurring(state);
        persist();
        closeSheet();
        render();
        toast(created > 0 ? `${created} 件の明細を自動登録しました` : '保存しました');
      },
    })
  );

  openSheet(existing ? '定期的な収支を編集' : '定期的な収支を追加', body, footer);
}

// ============================================================
// データ入出力
// ============================================================
function download(filename, content, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  const csv = core.toCSV(state.transactions, state.categories, state.accounts);
  download(`kakeibo_${core.todayStr()}.csv`, `﻿${csv}`, 'text/csv');
  toast('CSV を書き出しました');
}

function exportJSON() {
  download(`kakeibo_backup_${core.todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('バックアップを書き出しました');
}

/** UTF-8 で読めなければ Shift_JIS として読み直す（MF ME の CSV 対策） */
async function readText(file) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (e) {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

function importFile(kind) {
  const input = h('input', { type: 'file', accept: kind === 'csv' ? '.csv,text/csv' : '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const text = await readText(file);
    if (kind === 'json') importJSON(text);
    else importCSV(text);
  });
  input.click();
}

function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return toast('JSON を解析できませんでした');
  }
  if (!confirm('現在のデータをバックアップの内容で置き換えます。よろしいですか？')) return;
  state = store.migrate(parsed);
  persist();
  period = core.periodOf(core.todayStr(), startDay());
  renderHeader();
  render();
  toast(`${state.transactions.length} 件を復元しました`);
}

function importCSV(text) {
  const result = core.fromCSV(text, { categories: state.categories, accounts: state.accounts });
  const body = h(
    'div',
    {},
    h('p', { text: `取り込める明細: ${result.rows.length} 件` }),
    result.newAccounts.length
      ? h('p', { class: 'hero-sub', text: `新しく作る口座: ${result.newAccounts.map((a) => a.name).join('、')}` })
      : null,
    result.newCategories.length
      ? h('p', { class: 'hero-sub', text: `新しく作るカテゴリ: ${result.newCategories.map((c) => c.name).join('、')}` })
      : null,
    result.errors.length
      ? h(
          'div',
          { style: { marginTop: '10px' } },
          h('p', { class: 'over-text', text: `読み飛ばした行: ${result.errors.length} 件` }),
          h('ul', { class: 'hero-sub', style: { paddingLeft: '18px' } }, result.errors.slice(0, 8).map((e) => h('li', { text: e })))
        )
      : null,
    h('p', { class: 'hero-sub', style: { marginTop: '10px' }, text: '既存の明細は残したまま追加されます。' })
  );

  const footer = h(
    'div',
    { style: { display: 'flex', gap: '8px', width: '100%' } },
    h('button', { type: 'button', class: 'btn', text: 'キャンセル', onclick: closeSheet }),
    h('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: '取り込む',
      disabled: result.rows.length === 0,
      onclick: () => {
        state.categories.push(...result.newCategories);
        state.accounts.push(...result.newAccounts);
        state.transactions.push(...result.rows);
        persist();
        closeSheet();
        render();
        toast(`${result.rows.length} 件を取り込みました`);
      },
    })
  );

  openSheet('CSV の取り込み', body, footer);
}

// ============================================================
// ルーティング
// ============================================================
function switchView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.target === name));
  window.scrollTo({ top: 0 });
  render();
}

function render() {
  if (currentView === 'home') renderHome();
  else if (currentView === 'list') renderList();
  else if (currentView === 'analysis') renderAnalysis();
  else if (currentView === 'budget') renderBudget();
  else if (currentView === 'settings') renderSettings();
}

// ============================================================
// 初期化
// ============================================================
function init() {
  const created = store.applyRecurring(state);
  if (created > 0) {
    persist();
    setTimeout(() => toast(`定期的な収支から ${created} 件を自動登録しました`), 400);
  }

  $('#prevPeriod').addEventListener('click', () => setPeriod(core.addMonths(period, -1)));
  $('#nextPeriod').addEventListener('click', () => setPeriod(core.addMonths(period, 1)));
  $('#periodLabel').addEventListener('click', () => setPeriod(core.periodOf(core.todayStr(), startDay())));
  $('#fab').addEventListener('click', () => openTxSheet(null));
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetRoot').addEventListener('click', (e) => {
    if (e.target.dataset.close) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#sheetRoot').hidden) closeSheet();
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.target));
  });

  renderHeader();
  render();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
