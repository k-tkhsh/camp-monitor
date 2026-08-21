// ============================================================
// store.js — 状態の保持と永続化（localStorage）
// ============================================================
import { uid, CURRENT_VERSION, expandRecurring, todayStr, addMonths, monthKeyOf } from './core.js';

export const STORAGE_KEY = 'kakeibo.v1';

export const ACCOUNT_TYPES = [
  { value: 'cash', label: '現金', icon: '👛' },
  { value: 'bank', label: '銀行', icon: '🏦' },
  { value: 'card', label: 'クレジットカード', icon: '💳' },
  { value: 'emoney', label: '電子マネー', icon: '📲' },
  { value: 'invest', label: '証券・投資', icon: '📈' },
];

export function accountTypeLabel(type) {
  const t = ACCOUNT_TYPES.find((x) => x.value === type);
  return t ? t.label : type;
}
export function accountTypeIcon(type) {
  const t = ACCOUNT_TYPES.find((x) => x.value === type);
  return t ? t.icon : '💰';
}

export function defaultCategories() {
  const expense = [
    ['食費', '🍚', '#ef5350', ['食料品', '外食', 'カフェ']],
    ['日用品', '🧻', '#26a69a', ['消耗品', 'キッチン']],
    ['住宅', '🏠', '#8d6e63', ['家賃', '住宅ローン', '修繕']],
    ['水道・光熱費', '💡', '#ffa726', ['電気', 'ガス', '水道']],
    ['通信費', '📱', '#42a5f5', ['携帯', 'インターネット']],
    ['交通費', '🚃', '#5c6bc0', ['電車', 'バス', 'タクシー']],
    ['自動車', '🚗', '#78909c', ['ガソリン', '駐車場', '保険']],
    ['趣味・娯楽', '🎮', '#ab47bc', ['サブスク', 'レジャー', '書籍']],
    ['交際費', '🍻', '#ec407a', ['飲み会', 'プレゼント']],
    ['衣服・美容', '👕', '#f06292', ['衣類', '美容院', '化粧品']],
    ['健康・医療', '💊', '#66bb6a', ['病院', '薬', 'ジム']],
    ['教養・教育', '📚', '#29b6f6', ['学費', '習い事']],
    ['保険', '🛡', '#7e57c2', ['生命保険', '医療保険']],
    ['税・社会保障', '🏛', '#546e7a', ['税金', '年金']],
    ['特別な支出', '🎁', '#ff7043', ['冠婚葬祭', '家電']],
    ['その他', '🧾', '#9aa0b5', []],
  ];
  const income = [
    ['給与', '💴', '#66bb6a', ['基本給', '残業代']],
    ['賞与', '🏅', '#26a69a', []],
    ['事業・副業', '💼', '#42a5f5', []],
    ['一時所得', '🎊', '#ffa726', ['臨時収入', '還付金']],
    ['その他収入', '🪙', '#9aa0b5', []],
  ];
  const build = (rows, type) =>
    rows.map(([name, icon, color, subs]) => ({ id: uid('cat'), name, icon, color, type, subs }));
  return [...build(expense, 'expense'), ...build(income, 'income')];
}

export function defaultAccounts() {
  return [
    { id: uid('acc'), name: '財布', type: 'cash', initialBalance: 0, color: '#66bb6a' },
    { id: uid('acc'), name: '銀行口座', type: 'bank', initialBalance: 0, color: '#42a5f5' },
    { id: uid('acc'), name: 'クレジットカード', type: 'card', initialBalance: 0, color: '#ef5350' },
  ];
}

export function emptyState() {
  return {
    version: CURRENT_VERSION,
    settings: { startDay: 1, name: 'わが家の家計簿' },
    accounts: defaultAccounts(),
    categories: defaultCategories(),
    transactions: [],
    budgets: { default: {} },
    recurring: [],
    updatedAt: Date.now(),
  };
}

/** 保存データを現行スキーマへ寄せる（欠損フィールドの補完） */
export function migrate(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const state = {
    version: CURRENT_VERSION,
    settings: { ...base.settings, ...(raw.settings || {}) },
    accounts: Array.isArray(raw.accounts) && raw.accounts.length ? raw.accounts : base.accounts,
    categories: Array.isArray(raw.categories) && raw.categories.length ? raw.categories : base.categories,
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    budgets: raw.budgets && typeof raw.budgets === 'object' ? raw.budgets : { default: {} },
    recurring: Array.isArray(raw.recurring) ? raw.recurring : [],
    updatedAt: raw.updatedAt || Date.now(),
  };
  if (!state.budgets.default) state.budgets.default = {};
  state.accounts = state.accounts.map((a) => ({ ...a, initialBalance: Math.round(Number(a.initialBalance) || 0) }));
  state.categories = state.categories.map((c) => ({ ...c, subs: Array.isArray(c.subs) ? c.subs : [] }));
  state.transactions = state.transactions
    .filter((t) => t && t.date && Number.isFinite(Number(t.amount)))
    .map((t) => ({
      ...t,
      id: t.id || uid('tx'),
      amount: Math.abs(Math.round(Number(t.amount))),
      type: t.type === 'income' || t.type === 'transfer' ? t.type : 'expense',
      sub: t.sub || '',
      memo: t.memo || '',
      toAccountId: t.toAccountId || null,
      createdAt: t.createdAt || Date.now(),
    }));
  const startDay = Number(state.settings.startDay);
  state.settings.startDay = Number.isFinite(startDay) ? Math.min(28, Math.max(1, Math.round(startDay))) : 1;
  return state;
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('保存データの読み込みに失敗しました', e);
    return emptyState();
  }
}

export function save(state, storage = globalThis.localStorage) {
  state.updatedAt = Date.now();
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (e) {
    console.error('保存に失敗しました', e);
    return { ok: false, error: e };
  }
}

/** 定期取引の未生成分を state に取り込む。生成件数を返す */
export function applyRecurring(state, today = todayStr()) {
  const created = expandRecurring(state.recurring, state.transactions, today);
  if (created.length) state.transactions.push(...created);
  return created.length;
}

/** お試し用のサンプル明細を作る（直近 3 ヶ月分） */
export function seedSample(state, today = todayStr()) {
  const cat = (name) => (state.categories.find((c) => c.name === name) || state.categories[0]).id;
  const acc = (type) => (state.accounts.find((a) => a.type === type) || state.accounts[0]).id;
  const cash = acc('cash');
  const bank = acc('bank');
  const card = acc('card');
  const recipes = [
    ['食費', '食料品', 'スーパー', [1200, 3400, 890, 2600, 1750], cash],
    ['食費', '外食', 'ランチ', [980, 1500, 1200], card],
    ['日用品', '消耗品', 'ドラッグストア', [2200, 1180], cash],
    ['住宅', '家賃', '家賃', [82000], bank],
    ['水道・光熱費', '電気', '電気代', [9800], bank],
    ['通信費', '携帯', 'スマホ代', [4980], card],
    ['交通費', '電車', '定期券', [12000], card],
    ['趣味・娯楽', 'サブスク', '動画配信', [1980, 990], card],
    ['交際費', '飲み会', '同僚と', [5400], cash],
  ];
  const thisMonth = monthKeyOf(today);
  for (let back = 2; back >= 0; back -= 1) {
    const key = addMonths(thisMonth, -back);
    const payday = `${key}-25`;
    if (payday <= today) state.transactions.push({
      id: uid('tx'),
      date: payday,
      type: 'income',
      amount: 280000,
      categoryId: cat('給与'),
      sub: '基本給',
      accountId: bank,
      toAccountId: null,
      memo: '給与',
      createdAt: Date.now(),
    });
    // 月ごとに少しだけ金額を揺らして、推移グラフが平坦にならないようにする
    const factor = [1, 0.92, 1.11][back % 3];
    for (const [catName, sub, memo, amounts, account] of recipes) {
      amounts.forEach((base, i) => {
        const amount = catName === '住宅' ? base : Math.round((base * factor) / 10) * 10;
        const day = Math.min(28, 2 + i * 4 + (catName.length % 3));
        const date = `${key}-${String(day).padStart(2, '0')}`;
        if (date > today) return;
        state.transactions.push({
          id: uid('tx'),
          date,
          type: 'expense',
          amount,
          categoryId: cat(catName),
          sub,
          accountId: account,
          toAccountId: null,
          memo,
          createdAt: Date.now(),
        });
      });
    }
  }
  const budget = state.budgets.default;
  budget[cat('食費')] = 50000;
  budget[cat('日用品')] = 10000;
  budget[cat('住宅')] = 82000;
  budget[cat('水道・光熱費')] = 15000;
  budget[cat('通信費')] = 8000;
  budget[cat('趣味・娯楽')] = 10000;
  budget[cat('交際費')] = 15000;
  const cashAcc = state.accounts.find((a) => a.id === cash);
  const bankAcc = state.accounts.find((a) => a.id === bank);
  if (cashAcc) cashAcc.initialBalance = 30000;
  if (bankAcc) bankAcc.initialBalance = 450000;
  return state;
}
