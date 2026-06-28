/* 个股长期跟踪核心测试：node tracker.test.js */
const assert = require('assert');
const T = require('./tracker');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const stock = {
  name: '贵州茅台', code: '600519', targetBuy: 1500, targetSell: 2000,
  snapshots: [
    { date: '2021-06-30', price: 1000 },
    { date: '2024-06-30', price: 1750 },
    { date: '2023-06-30', price: 1600 }, // 故意乱序
  ],
};

console.log('tracker tests');

test('快照按日期升序排序', () => {
  const s = T.sortByDate(stock.snapshots);
  assert.deepStrictEqual(s.map((x) => x.date), ['2021-06-30', '2023-06-30', '2024-06-30']);
});

test('最早/最新快照正确', () => {
  assert.strictEqual(T.firstSnapshot(stock).price, 1000);
  assert.strictEqual(T.latestSnapshot(stock).price, 1750);
});

test('累计涨跌幅 = +75%', () => {
  assert.strictEqual(T.totalReturnPct(stock), 75);
});

test('相对上一笔涨跌幅', () => {
  // 1600 → 1750 = +9.38%
  assert.ok(Math.abs(T.changeFromPrevious(stock) - 9.38) < 0.01);
});

test('年化收益 CAGR（3年从1000到1750约20.5%）', () => {
  const c = T.annualizedReturn(stock);
  assert.ok(c > 20 && c < 21, `cagr=${c}`);
});

test('跨度过短时年化返回 null', () => {
  const s2 = { snapshots: [{ date: '2024-06-01', price: 100 }, { date: '2024-06-10', price: 110 }] };
  assert.strictEqual(T.annualizedReturn(s2), null);
});

test('价格统计 min/max/latest/count', () => {
  const st = T.priceStats(stock);
  assert.strictEqual(st.min, 1000);
  assert.strictEqual(st.max, 1750);
  assert.strictEqual(st.latest, 1750);
  assert.strictEqual(st.count, 3);
});

test('状态判断：低于目标买入价 → 买入区', () => {
  assert.strictEqual(T.evaluateStatus(1400, 1500, 2000).level, 'buy');
});

test('状态判断：高于目标卖出价 → 卖出区', () => {
  assert.strictEqual(T.evaluateStatus(2100, 1500, 2000).level, 'sell');
});

test('状态判断：区间内 → 持有', () => {
  assert.strictEqual(T.evaluateStatus(1750, 1500, 2000).level, 'hold');
});

test('距目标买入价的下跌空间(%)', () => {
  // 现价2000，目标买入1500 → 需跌 25%
  assert.strictEqual(T.distanceToBuy(2000, 1500), 25);
  assert.strictEqual(T.distanceToBuy(1400, 1500), 0); // 已在买入区
});

test('空快照不崩溃', () => {
  const empty = { snapshots: [] };
  assert.strictEqual(T.totalReturnPct(empty), null);
  assert.strictEqual(T.latestSnapshot(empty), null);
  assert.strictEqual(T.priceStats(empty).count, 0);
});

console.log(`\n${passed} passed`);
