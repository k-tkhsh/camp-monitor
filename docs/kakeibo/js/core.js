// ============================================================
// core.js — 家計簿アプリの純粋ロジック
// DOM に依存しないため Node からもテストできる
// ============================================================

export const CURRENT_VERSION = 1;

// ── ID / 数値 ──────────────────────────────────────────────
let seq = 0;
export function uid(prefix = 'id') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 円表記（整数・カンマ区切り） */
export function yen(n) {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '-' : ''}¥${Math.abs(v).toLocaleString('ja-JP')}`;
}

/** 「1,200円」「+1200」「1200.5」など緩い入力を整数円に */
export function parseAmount(input) {
  if (typeof input === 'number') return Math.round(input);
  const s = String(input ?? '')
    .replace(/[０-９．，－]/g, (c) => '0123456789.,-'['０１２３４５６７８９．，－'.indexOf(c)])
    .replace(/[,\s円¥￥]/g, '');
  if (s === '' || s === '-') return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v) : NaN;
}

// ── 日付ユーティリティ（UTC 固定でタイムゾーン差を排除）──────
export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDate(s) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(s || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function normalizeDate(s) {
  const p = parseDate(s);
  if (!p) return null;
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(dateStr, n) {
  const p = parseDate(dateStr);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** '2026-08' 形式の月キーに n ヶ月加算 */
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthKeyOf(dateStr) {
  const p = parseDate(dateStr);
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
}

/**
 * 月の開始日（給料日締めなど）を考慮して、取引が属する集計期間キーを返す。
 * 開始日が 25 日なら 8/25〜9/24 は「2026-08」期として扱う（開始月で呼ぶ）。
 */
export function periodOf(dateStr, startDay = 1) {
  const p = parseDate(dateStr);
  if (!p) return null;
  const key = `${p.y}-${String(p.m).padStart(2, '0')}`;
  if (startDay <= 1) return key;
  const start = Math.min(startDay, daysInMonth(p.y, p.m));
  return p.d >= start ? key : addMonths(key, -1);
}

/** 期間キーの実日付レンジ（両端含む） */
export function periodRange(key, startDay = 1) {
  const [y, m] = key.split('-').map(Number);
  if (startDay <= 1) {
    return { start: `${key}-01`, end: `${key}-${String(daysInMonth(y, m)).padStart(2, '0')}` };
  }
  const sd = Math.min(startDay, daysInMonth(y, m));
  const start = `${key}-${String(sd).padStart(2, '0')}`;
  const nextKey = addMonths(key, 1);
  const [ny, nm] = nextKey.split('-').map(Number);
  const nsd = Math.min(startDay, daysInMonth(ny, nm));
  return { start, end: addDays(`${nextKey}-${String(nsd).padStart(2, '0')}`, -1) };
}

export function periodLabel(key, startDay = 1) {
  const [y, m] = key.split('-').map(Number);
  if (startDay <= 1) return `${y}年${m}月`;
  const r = periodRange(key, startDay);
  return `${y}年${m}月度 (${r.start.slice(5).replace('-', '/')}〜${r.end.slice(5).replace('-', '/')})`;
}

// ── 取引の抽出・集計 ────────────────────────────────────────
export function inPeriod(tx, key, startDay = 1) {
  return periodOf(tx.date, startDay) === key;
}

/**
 * 明細の絞り込み。
 * opts: { period, startDay, from, to, type, categoryId, accountId, q }
 */
export function filterTx(transactions, opts = {}) {
  const { period, startDay = 1, from, to, type, categoryId, accountId, q } = opts;
  const needle = (q || '').trim().toLowerCase();
  return transactions.filter((tx) => {
    if (period && !inPeriod(tx, period, startDay)) return false;
    if (from && tx.date < from) return false;
    if (to && tx.date > to) return false;
    if (type && tx.type !== type) return false;
    if (categoryId && tx.categoryId !== categoryId) return false;
    if (accountId && tx.accountId !== accountId && tx.toAccountId !== accountId) return false;
    if (needle) {
      const hay = `${tx.memo || ''} ${tx.sub || ''} ${tx.title || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function sortTx(transactions) {
  return [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

/** 収入・支出・収支（振替は集計対象外） */
export function summarize(transactions) {
  let income = 0;
  let expense = 0;
  for (const tx of transactions) {
    if (tx.type === 'income') income += tx.amount;
    else if (tx.type === 'expense') expense += tx.amount;
  }
  return { income, expense, net: income - expense };
}

/** カテゴリ別内訳（金額の多い順） */
export function byCategory(transactions, categories, type = 'expense') {
  const map = new Map();
  for (const tx of transactions) {
    if (tx.type !== type) continue;
    map.set(tx.categoryId, (map.get(tx.categoryId) || 0) + tx.amount);
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  return [...map.entries()]
    .map(([categoryId, amount]) => {
      const cat = categories.find((c) => c.id === categoryId);
      return {
        categoryId,
        name: cat ? cat.name : '未分類',
        icon: cat ? cat.icon : '❓',
        color: cat ? cat.color : '#9aa0b5',
        amount,
        ratio: total > 0 ? amount / total : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

/** 中項目別内訳 */
export function bySub(transactions, categoryId) {
  const map = new Map();
  for (const tx of transactions) {
    if (tx.categoryId !== categoryId) continue;
    const k = tx.sub || '（未設定）';
    map.set(k, (map.get(k) || 0) + tx.amount);
  }
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** 口座ごとの残高（初期残高＋収入−支出±振替） */
export function accountBalances(accounts, transactions) {
  const bal = new Map(accounts.map((a) => [a.id, Math.round(a.initialBalance || 0)]));
  for (const tx of transactions) {
    if (tx.type === 'income') {
      if (bal.has(tx.accountId)) bal.set(tx.accountId, bal.get(tx.accountId) + tx.amount);
    } else if (tx.type === 'expense') {
      if (bal.has(tx.accountId)) bal.set(tx.accountId, bal.get(tx.accountId) - tx.amount);
    } else if (tx.type === 'transfer') {
      if (bal.has(tx.accountId)) bal.set(tx.accountId, bal.get(tx.accountId) - tx.amount);
      if (bal.has(tx.toAccountId)) bal.set(tx.toAccountId, bal.get(tx.toAccountId) + tx.amount);
    }
  }
  return bal;
}

/** 総資産（負債種別の口座はマイナス計上） */
export function totalAssets(accounts, transactions) {
  const bal = accountBalances(accounts, transactions);
  let assets = 0;
  let debts = 0;
  for (const a of accounts) {
    const v = bal.get(a.id) || 0;
    if (a.type === 'card') debts += v;
    else assets += v;
  }
  return { assets, debts, net: assets + debts };
}

/** 指定期間の予算（その月の設定 → 既定値 の順で解決） */
export function budgetFor(budgets, period, categoryId) {
  const monthly = (budgets && budgets[period]) || {};
  if (Number.isFinite(monthly[categoryId])) return monthly[categoryId];
  const def = (budgets && budgets.default) || {};
  return Number.isFinite(def[categoryId]) ? def[categoryId] : 0;
}

/** カテゴリ別予算の消化状況 */
export function budgetProgress(transactions, categories, budgets, period) {
  const spent = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    spent.set(tx.categoryId, (spent.get(tx.categoryId) || 0) + tx.amount);
  }
  const rows = categories
    .filter((c) => c.type === 'expense')
    .map((c) => {
      const budget = budgetFor(budgets, period, c.id);
      const used = spent.get(c.id) || 0;
      return {
        categoryId: c.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        budget,
        used,
        rest: budget - used,
        ratio: budget > 0 ? used / budget : 0,
        over: budget > 0 && used > budget,
      };
    })
    .filter((r) => r.budget > 0 || r.used > 0);
  const total = rows.reduce(
    (acc, r) => ({ budget: acc.budget + r.budget, used: acc.used + r.used }),
    { budget: 0, used: 0 }
  );
  return {
    rows: rows.sort((a, b) => b.budget - a.budget || b.used - a.used),
    total: { ...total, rest: total.budget - total.used, ratio: total.budget > 0 ? total.used / total.budget : 0 },
  };
}

/** 直近 count 期間の収支推移（古い順） */
export function monthlySeries(transactions, endPeriod, count = 6, startDay = 1) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const key = addMonths(endPeriod, -i);
    const s = summarize(filterTx(transactions, { period: key, startDay }));
    const [y, m] = key.split('-').map(Number);
    out.push({ key, label: `${m}月`, year: y, ...s });
  }
  return out;
}

/** 期間末時点の総資産推移（古い順） */
export function assetSeries(accounts, transactions, endPeriod, count = 6, startDay = 1) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const key = addMonths(endPeriod, -i);
    const { end } = periodRange(key, startDay);
    const upTo = transactions.filter((tx) => tx.date <= end);
    const [, m] = key.split('-').map(Number);
    out.push({ key, label: `${m}月`, value: totalAssets(accounts, upTo).net });
  }
  return out;
}

// ── 定期取引（固定費）の自動生成 ─────────────────────────────
/**
 * rules: [{id, name, type, amount, categoryId, sub, accountId, toAccountId, day, memo, startDate, endDate, enabled}]
 * 生成済みかどうかは transaction.ruleId + date で判定する。
 */
export function expandRecurring(rules, transactions, today = todayStr()) {
  const done = new Set(transactions.filter((t) => t.ruleId).map((t) => `${t.ruleId}@${t.date}`));
  const created = [];
  for (const rule of rules || []) {
    if (rule.enabled === false) continue;
    const start = rule.startDate || today;
    if (start > today) continue;
    let key = monthKeyOf(start);
    const guard = 240; // 最大 20 年分
    for (let i = 0; i < guard; i += 1) {
      const [y, m] = key.split('-').map(Number);
      const day = Math.min(rule.day || 1, daysInMonth(y, m));
      const date = `${key}-${String(day).padStart(2, '0')}`;
      if (date > today) break;
      if (rule.endDate && date > rule.endDate) break;
      if (date >= start && !done.has(`${rule.id}@${date}`)) {
        created.push({
          id: uid('tx'),
          ruleId: rule.id,
          date,
          type: rule.type,
          amount: rule.amount,
          categoryId: rule.categoryId,
          sub: rule.sub || '',
          accountId: rule.accountId,
          toAccountId: rule.toAccountId || null,
          memo: rule.memo || rule.name || '',
          createdAt: Date.now(),
        });
      }
      key = addMonths(key, 1);
    }
  }
  return created;
}

// ── CSV 入出力 ─────────────────────────────────────────────
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = ['日付', '種別', '大項目', '中項目', '内容', '金額', '口座', '振替先', 'メモ'];

export function toCSV(transactions, categories, accounts) {
  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || '';
  const accName = (id) => (accounts.find((a) => a.id === id) || {}).name || '';
  const typeName = { expense: '支出', income: '収入', transfer: '振替' };
  const lines = [CSV_HEADER.join(',')];
  for (const tx of sortTx(transactions)) {
    lines.push(
      [
        tx.date,
        typeName[tx.type] || tx.type,
        catName(tx.categoryId),
        tx.sub || '',
        tx.memo || '',
        tx.type === 'expense' ? -tx.amount : tx.amount,
        accName(tx.accountId),
        tx.toAccountId ? accName(tx.toAccountId) : '',
        tx.memo || '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n');
}

/** RFC4180 準拠の簡易 CSV パーサ */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

/**
 * 自前 CSV / マネーフォワード ME のエクスポート CSV を取り込む。
 * MF 形式: 計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
 * 戻り値: { rows, errors, newCategories, newAccounts }
 */
export function fromCSV(text, { categories = [], accounts = [] } = {}) {
  const rows = parseCSV(text);
  const errors = [];
  if (rows.length === 0) return { rows: [], errors: ['CSV が空です'], newCategories: [], newAccounts: [] };

  const header = rows[0].map((h) => h.replace(/["\s]/g, ''));
  const idx = (...names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h === n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const col = {
    date: idx('日付'),
    amount: idx('金額', '金額（円）', '金額(円)'),
    category: idx('大項目', 'カテゴリ'),
    sub: idx('中項目'),
    title: idx('内容'),
    memo: idx('メモ'),
    account: idx('口座', '保有金融機関'),
    to: idx('振替先'),
    type: idx('種別'),
    target: idx('計算対象'),
    transfer: idx('振替'),
  };
  if (col.date < 0 || col.amount < 0) {
    return {
      rows: [],
      errors: ['ヘッダー行に「日付」と「金額」（または「金額（円）」）が見つかりません'],
      newCategories: [],
      newAccounts: [],
    };
  }

  const cats = [...categories];
  const accs = [...accounts];
  const newCategories = [];
  const newAccounts = [];
  const palette = ['#ef5350', '#ab47bc', '#5c6bc0', '#26a69a', '#ffa726', '#8d6e63', '#66bb6a', '#42a5f5'];

  const findOrCreateCategory = (name, type) => {
    const nm = (name || '').trim() || '未分類';
    let c = cats.find((x) => x.name === nm && x.type === type);
    if (!c) {
      c = {
        id: uid('cat'),
        name: nm,
        type,
        icon: type === 'income' ? '🪙' : '🧾',
        color: palette[cats.length % palette.length],
        subs: [],
      };
      cats.push(c);
      newCategories.push(c);
    }
    return c.id;
  };
  const findOrCreateAccount = (name) => {
    const nm = (name || '').trim();
    if (!nm) return accs[0] ? accs[0].id : null;
    let a = accs.find((x) => x.name === nm);
    if (!a) {
      a = { id: uid('acc'), name: nm, type: 'bank', initialBalance: 0, color: '#5c6bc0' };
      accs.push(a);
      newAccounts.push(a);
    }
    return a.id;
  };

  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    const date = normalizeDate(cells[col.date]);
    if (!date) {
      errors.push(`${r + 1} 行目: 日付「${cells[col.date] || ''}」を解釈できません`);
      continue;
    }
    if (col.target >= 0 && String(cells[col.target]).trim() === '0') continue; // MF: 計算対象外
    const raw = parseAmount(cells[col.amount]);
    if (!Number.isFinite(raw)) {
      errors.push(`${r + 1} 行目: 金額「${cells[col.amount] || ''}」を解釈できません`);
      continue;
    }

    let type;
    const typeCell = col.type >= 0 ? String(cells[col.type]).trim() : '';
    if (typeCell === '支出') type = 'expense';
    else if (typeCell === '収入') type = 'income';
    else if (typeCell === '振替') type = 'transfer';
    else if (col.transfer >= 0 && String(cells[col.transfer]).trim() === '1') type = 'transfer';
    else type = raw < 0 ? 'expense' : 'income';

    const amount = Math.abs(raw);
    if (amount === 0) continue;
    const title = col.title >= 0 ? String(cells[col.title]).trim() : '';
    const memo = col.memo >= 0 ? String(cells[col.memo]).trim() : '';

    // 振替は分類を持たない。振替先列が無い形式（MF は出金・入金を 2 行で書き出す）は
    // 符号から出金側／入金側を判定して、口座残高が合うように取り込む。
    let accountId = null;
    let toAccountId = null;
    if (type === 'transfer') {
      const src = findOrCreateAccount(col.account >= 0 ? cells[col.account] : '');
      const dest = col.to >= 0 && String(cells[col.to]).trim() ? findOrCreateAccount(cells[col.to]) : null;
      if (dest) {
        accountId = src;
        toAccountId = dest;
      } else if (raw < 0) {
        accountId = src;
      } else {
        toAccountId = src;
      }
    } else {
      accountId = findOrCreateAccount(col.account >= 0 ? cells[col.account] : '');
    }

    out.push({
      id: uid('tx'),
      date,
      type,
      amount,
      categoryId:
        type === 'transfer'
          ? null
          : findOrCreateCategory(col.category >= 0 ? cells[col.category] : '', type === 'income' ? 'income' : 'expense'),
      sub: type === 'transfer' ? '' : col.sub >= 0 ? String(cells[col.sub]).trim() : '',
      accountId,
      toAccountId,
      memo: [title, memo].filter(Boolean).join(' / '),
      createdAt: Date.now(),
    });
  }
  return { rows: out, errors, newCategories, newAccounts };
}
