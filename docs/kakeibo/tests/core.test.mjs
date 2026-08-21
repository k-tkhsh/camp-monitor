// node --test docs/kakeibo/tests/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';

const cats = [
  { id: 'c_food', name: '食費', type: 'expense', icon: '🍚', color: '#ef5350', subs: [] },
  { id: 'c_daily', name: '日用品', type: 'expense', icon: '🧻', color: '#26a69a', subs: [] },
  { id: 'c_salary', name: '給与', type: 'income', icon: '💴', color: '#66bb6a', subs: [] },
];
const accs = [
  { id: 'a_cash', name: '現金', type: 'cash', initialBalance: 10000 },
  { id: 'a_bank', name: '銀行', type: 'bank', initialBalance: 200000 },
  { id: 'a_card', name: 'カード', type: 'card', initialBalance: 0 },
];
const tx = (o) => ({ id: core.uid('tx'), sub: '', memo: '', toAccountId: null, createdAt: 1, ...o });
const txs = [
  tx({ date: '2026-08-03', type: 'expense', amount: 1200, categoryId: 'c_food', accountId: 'a_cash', memo: 'スーパー' }),
  tx({ date: '2026-08-15', type: 'expense', amount: 3000, categoryId: 'c_food', accountId: 'a_card' }),
  tx({ date: '2026-08-20', type: 'expense', amount: 800, categoryId: 'c_daily', accountId: 'a_cash' }),
  tx({ date: '2026-08-25', type: 'income', amount: 250000, categoryId: 'c_salary', accountId: 'a_bank' }),
  tx({ date: '2026-08-26', type: 'transfer', amount: 50000, accountId: 'a_bank', toAccountId: 'a_cash' }),
  tx({ date: '2026-07-10', type: 'expense', amount: 5000, categoryId: 'c_food', accountId: 'a_cash' }),
];

test('parseAmount は全角・記号入りを整数円にする', () => {
  assert.equal(core.parseAmount('1,200円'), 1200);
  assert.equal(core.parseAmount('１２３４'), 1234);
  assert.equal(core.parseAmount('-500'), -500);
  assert.equal(core.parseAmount('¥1 000'), 1000);
  assert.ok(Number.isNaN(core.parseAmount('abc')));
});

test('yen は符号付きでカンマ整形する', () => {
  assert.equal(core.yen(1234567), '¥1,234,567');
  assert.equal(core.yen(-980), '-¥980');
});

test('periodOf は開始日 1 日なら暦月と一致する', () => {
  assert.equal(core.periodOf('2026-08-01'), '2026-08');
  assert.equal(core.periodOf('2026-08-31'), '2026-08');
});

test('periodOf は開始日 25 日で締め月をずらす', () => {
  assert.equal(core.periodOf('2026-08-25', 25), '2026-08');
  assert.equal(core.periodOf('2026-09-24', 25), '2026-08');
  assert.equal(core.periodOf('2026-09-25', 25), '2026-09');
  assert.equal(core.periodOf('2026-08-24', 25), '2026-07');
});

test('periodRange は開始日を考慮した両端日付を返す', () => {
  assert.deepEqual(core.periodRange('2026-08'), { start: '2026-08-01', end: '2026-08-31' });
  assert.deepEqual(core.periodRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(core.periodRange('2026-08', 25), { start: '2026-08-25', end: '2026-09-24' });
  // 開始日 31 日は短い月では月末に丸める
  assert.deepEqual(core.periodRange('2026-01', 31), { start: '2026-01-31', end: '2026-02-27' });
});

test('addMonths は年をまたいで正しく進む', () => {
  assert.equal(core.addMonths('2026-12', 1), '2027-01');
  assert.equal(core.addMonths('2026-01', -1), '2025-12');
  assert.equal(core.addMonths('2026-08', -13), '2025-07');
});

test('summarize は振替を収支に含めない', () => {
  const s = core.summarize(core.filterTx(txs, { period: '2026-08' }));
  assert.equal(s.income, 250000);
  assert.equal(s.expense, 5000);
  assert.equal(s.net, 245000);
});

test('filterTx はキーワード・カテゴリ・口座で絞り込む', () => {
  assert.equal(core.filterTx(txs, { q: 'スーパー' }).length, 1);
  assert.equal(core.filterTx(txs, { categoryId: 'c_food' }).length, 3);
  // 振替は出金元・入金先どちらでもヒットする
  assert.equal(core.filterTx(txs, { accountId: 'a_bank', period: '2026-08' }).length, 2);
});

test('byCategory は金額順で構成比を返す', () => {
  const rows = core.byCategory(core.filterTx(txs, { period: '2026-08' }), cats, 'expense');
  assert.equal(rows[0].name, '食費');
  assert.equal(rows[0].amount, 4200);
  assert.equal(rows[1].amount, 800);
  assert.equal(Math.round(rows[0].ratio * 1000) / 1000, 0.84);
});

test('accountBalances は振替で残高を移動させる', () => {
  const bal = core.accountBalances(accs, txs);
  // 現金: 10000 - 1200 - 800 - 5000 + 50000
  assert.equal(bal.get('a_cash'), 53000);
  // 銀行: 200000 + 250000 - 50000
  assert.equal(bal.get('a_bank'), 400000);
  // カード: 0 - 3000（負債）
  assert.equal(bal.get('a_card'), -3000);
});

test('totalAssets はカード残高を負債として純資産を出す', () => {
  const t = core.totalAssets(accs, txs);
  assert.equal(t.assets, 453000);
  assert.equal(t.debts, -3000);
  assert.equal(t.net, 450000);
});

test('budgetProgress は月別予算を既定値より優先する', () => {
  const budgets = { default: { c_food: 30000 }, '2026-08': { c_food: 40000, c_daily: 5000 } };
  const p = core.budgetProgress(core.filterTx(txs, { period: '2026-08' }), cats, budgets, '2026-08');
  const food = p.rows.find((r) => r.categoryId === 'c_food');
  assert.equal(food.budget, 40000);
  assert.equal(food.used, 4200);
  assert.equal(food.rest, 35800);
  assert.equal(food.over, false);
  assert.equal(p.total.budget, 45000);
  assert.equal(p.total.used, 5000);
});

test('budgetProgress は超過を検出する', () => {
  const p = core.budgetProgress(core.filterTx(txs, { period: '2026-08' }), cats, { default: { c_food: 1000 } }, '2026-08');
  assert.equal(p.rows.find((r) => r.categoryId === 'c_food').over, true);
});

test('monthlySeries は指定期間分を古い順で返す', () => {
  const s = core.monthlySeries(txs, '2026-08', 3);
  assert.deepEqual(s.map((r) => r.key), ['2026-06', '2026-07', '2026-08']);
  assert.equal(s[1].expense, 5000);
  assert.equal(s[2].income, 250000);
});

test('assetSeries は期間末時点の純資産を返す', () => {
  const s = core.assetSeries(accs, txs, '2026-08', 2);
  // 7月末: 210000 - 5000
  assert.equal(s[0].value, 205000);
  assert.equal(s[1].value, 450000);
});

test('expandRecurring は今日までの分だけ生成し重複しない', () => {
  const rules = [
    { id: 'r1', name: '家賃', type: 'expense', amount: 80000, categoryId: 'c_food', accountId: 'a_bank', day: 27, startDate: '2026-06-01' },
  ];
  const first = core.expandRecurring(rules, [], '2026-08-21');
  assert.deepEqual(first.map((t) => t.date), ['2026-06-27', '2026-07-27']);
  assert.equal(core.expandRecurring(rules, first, '2026-08-21').length, 0);
  const later = core.expandRecurring(rules, first, '2026-08-28');
  assert.deepEqual(later.map((t) => t.date), ['2026-08-28'.slice(0, 8) + '27']);
});

test('expandRecurring は短い月では実在する日に丸め、終了日を尊重する', () => {
  const rules = [
    { id: 'r2', type: 'expense', amount: 100, categoryId: 'c_food', accountId: 'a_cash', day: 31, startDate: '2026-02-01', endDate: '2026-03-15' },
  ];
  const rows = core.expandRecurring(rules, [], '2026-06-01');
  assert.deepEqual(rows.map((t) => t.date), ['2026-02-28']);
});

test('expandRecurring は無効化されたルールを無視する', () => {
  const rules = [{ id: 'r3', enabled: false, type: 'expense', amount: 100, categoryId: 'c_food', accountId: 'a_cash', day: 1, startDate: '2026-01-01' }];
  assert.equal(core.expandRecurring(rules, [], '2026-08-21').length, 0);
});

test('CSV は書き出して読み戻せる（支出は負値で出力）', () => {
  const csv = core.toCSV(txs, cats, accs);
  assert.ok(csv.startsWith(core.CSV_HEADER.join(',')));
  assert.ok(csv.includes('-1200'));
  const back = core.fromCSV(csv, { categories: cats, accounts: accs });
  assert.equal(back.errors.length, 0);
  assert.equal(back.rows.length, txs.length);
  assert.equal(back.newCategories.length, 0);
  assert.equal(back.newAccounts.length, 0);
  const s = core.summarize(back.rows);
  assert.equal(s.expense, 10000);
  assert.equal(s.income, 250000);
  assert.equal(back.rows.filter((r) => r.type === 'transfer').length, 1);
});

test('マネーフォワード ME 形式の CSV を取り込める', () => {
  const mf = [
    '"計算対象","日付","内容","金額（円）","保有金融機関","大項目","中項目","メモ","振替","ID"',
    '"1","2026/08/03","セブンイレブン","-540","現金","食費","食料品","","0","x1"',
    '"1","2026/08/25","給与","250,000","三井住友銀行","収入","給与","8月分","0","x2"',
    '"0","2026/08/26","対象外","-999","現金","食費","","","0","x3"',
    '"1","2026/08/27","口座振替","-50000","三井住友銀行","その他","","","1","x4"',
  ].join('\n');
  const r = core.fromCSV(mf, { categories: cats, accounts: accs });
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 3); // 計算対象 0 の行は除外
  assert.equal(r.rows[0].amount, 540);
  assert.equal(r.rows[0].type, 'expense');
  assert.equal(r.rows[0].sub, '食料品');
  assert.equal(r.rows[1].type, 'income');
  assert.equal(r.rows[1].amount, 250000);
  assert.equal(r.rows[2].type, 'transfer');
  // 未知の金融機関・カテゴリは自動作成される
  assert.ok(r.newAccounts.some((a) => a.name === '三井住友銀行'));
  assert.ok(r.newCategories.some((c) => c.name === '収入' && c.type === 'income'));
});

test('fromCSV はヘッダー不足と壊れた行を報告する', () => {
  const bad = core.fromCSV('foo,bar\n1,2');
  assert.equal(bad.rows.length, 0);
  assert.equal(bad.errors.length, 1);
  const partial = core.fromCSV('日付,金額\n2026-08-01,100\nダメ,200\n2026-08-02,あああ', { categories: cats, accounts: accs });
  assert.equal(partial.rows.length, 1);
  assert.equal(partial.errors.length, 2);
});

test('parseCSV は引用符・改行入りセルを扱える', () => {
  const rows = core.parseCSV('a,b\n"1,5","改行\nあり"\n');
  assert.deepEqual(rows[1], ['1,5', '改行\nあり']);
});

test('振替先列の無い CSV は符号から出金・入金を判定して残高を保つ', () => {
  const mf = [
    '計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID',
    '1,2026/08/26,振替,-50000,銀行,その他,,,1,x1',
    '1,2026/08/26,振替,50000,現金,その他,,,1,x2',
  ].join('\n');
  const r = core.fromCSV(mf, { categories: cats, accounts: accs });
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.rows.map((t) => [t.accountId, t.toAccountId]), [['a_bank', null], [null, 'a_cash']]);
  const bal = core.accountBalances(accs, r.rows);
  assert.equal(bal.get('a_bank'), 150000);
  assert.equal(bal.get('a_cash'), 60000);
  // 振替は収支に影響しない
  assert.deepEqual(core.summarize(r.rows), { income: 0, expense: 0, net: 0 });
});
