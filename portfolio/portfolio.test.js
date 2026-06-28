/* 投资组合计算测试：node portfolio.test.js */
const assert = require('assert');
const { holdingMetrics, summarize } = require('./portfolio');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('portfolio tests');

test('单只持仓盈利计算', () => {
  const m = holdingMetrics({ name: 'A', shares: 1000, buyPrice: 10, currentPrice: 12 });
  assert.strictEqual(m.cost, 10000);
  assert.strictEqual(m.marketValue, 12000);
  assert.strictEqual(m.profit, 2000);
  assert.strictEqual(m.returnRate, 20);
});

test('单只持仓亏损计算', () => {
  const m = holdingMetrics({ name: 'B', shares: 500, buyPrice: 20, currentPrice: 18 });
  assert.strictEqual(m.profit, -1000);
  assert.strictEqual(m.returnRate, -10);
});

test('空/无效输入不报错且为 0', () => {
  const m = holdingMetrics({ name: 'C', shares: '', buyPrice: 'abc', currentPrice: null });
  assert.strictEqual(m.cost, 0);
  assert.strictEqual(m.marketValue, 0);
  assert.strictEqual(m.returnRate, 0);
});

test('组合汇总：总成本/市值/盈亏', () => {
  const s = summarize([
    { name: 'A', shares: 1000, buyPrice: 10, currentPrice: 12 }, // +2000
    { name: 'B', shares: 500, buyPrice: 20, currentPrice: 18 },  // -1000
  ]);
  assert.strictEqual(s.totalCost, 20000);
  assert.strictEqual(s.totalMarketValue, 21000);
  assert.strictEqual(s.totalProfit, 1000);
  assert.strictEqual(s.totalReturnRate, 5);
});

test('资产配置权重之和约为 100%', () => {
  const s = summarize([
    { name: 'A', shares: 1000, buyPrice: 10, currentPrice: 12 },
    { name: 'B', shares: 500, buyPrice: 20, currentPrice: 18 },
    { name: 'C', shares: 200, buyPrice: 50, currentPrice: 55 },
  ]);
  const totalWeight = s.allocation.reduce((a, b) => a + b.weight, 0);
  assert.ok(Math.abs(totalWeight - 100) < 0.5, `weight sum=${totalWeight}`);
});

test('空组合不崩溃', () => {
  const s = summarize([]);
  assert.strictEqual(s.totalMarketValue, 0);
  assert.strictEqual(s.totalReturnRate, 0);
  assert.deepStrictEqual(s.allocation, []);
});

console.log(`\n${passed} passed`);
