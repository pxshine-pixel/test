/* 简易测试，无需依赖：node calculator.test.js */
const assert = require('assert');
const calc = require('./calculator');

const fees = {
  commissionRate: 0.025, // 0.025%
  minCommission: 5,
  stampTax: 0.05,        // 0.05%
  transferFee: 0.001,    // 0.001%
};

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

console.log('calculator tests');

test('买入费用：佣金低于最低值时取最低佣金', () => {
  // 1000元买入，佣金 0.25元 < 5元 => 取 5
  const f = calc.buyFees(1000, fees);
  assert.strictEqual(f.commission, 5);
});

test('买入费用：佣金高于最低值时按费率', () => {
  // 100000元买入，佣金 = 25元 > 5
  const f = calc.buyFees(100000, fees);
  assert.strictEqual(f.commission, 25);
});

test('卖出费用包含印花税', () => {
  const f = calc.sellFees(100000, fees);
  assert.strictEqual(f.stampTax, 50); // 0.05% of 100000
  assert.ok(f.total > f.commission);
});

test('总成本 = 买入金额 + 买入费用', () => {
  const r = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: '', fees });
  // 买入金额 10000，佣金 max(2.5,5)=5，过户费 0.1 => total 5.1
  assert.strictEqual(r.buyAmount, 10000);
  assert.strictEqual(r.totalCost, 10005.1);
});

test('盈利场景：收益率为正', () => {
  const r = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: 12, fees });
  assert.ok(r.profit > 0, `profit=${r.profit}`);
  assert.ok(r.returnRate > 0);
});

test('亏损场景：收益率为负', () => {
  const r = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: 9, fees });
  assert.ok(r.profit < 0, `profit=${r.profit}`);
});

test('保本价高于买入价（覆盖费用）', () => {
  const r = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: '', fees });
  assert.ok(r.breakEvenPrice > 10, `breakEven=${r.breakEvenPrice}`);
});

test('按保本价卖出，盈亏约等于 0', () => {
  const r0 = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: '', fees });
  const r = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: r0.breakEvenPrice, fees });
  assert.ok(Math.abs(r.profit) < 1, `profit≈0 but got ${r.profit}`);
});

test('目标卖出价能达到目标收益率', () => {
  const r0 = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: '', fees });
  const tp = calc.targetSellPrice(r0.totalCost, 1000, fees, 20);
  const r = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: tp, fees });
  assert.ok(Math.abs(r.returnRate - 20) < 0.5, `returnRate=${r.returnRate}`);
});

// ---- 新费率预设场景（与页面预设一致） ----
const stockFees = { commissionRate: 0.01, minCommission: 0, stampTax: 0.05, transferFee: 0.001 };

test('沪深股票 万1 不免5：买卖费用正确', () => {
  const r = calc.calculate({ buyPrice: 10, shares: 1000, sellPrice: 12, fees: stockFees });
  // 买入：佣金 10000*0.0001=1，过户 0.1 → 1.1
  assert.strictEqual(r.buyFees.total, 1.1);
  // 卖出：佣金 1.2 + 印花税 6 + 过户 0.12 = 7.32
  assert.strictEqual(r.sellFees.total, 7.32);
  assert.strictEqual(r.profit, 1991.58);
});

test('沪深股票 万1：小额也不收最低5元（不免5即0）', () => {
  // 买 1000 元，佣金 0.1 元，不再被抬到 5
  const r = calc.calculate({ buyPrice: 10, shares: 100, sellPrice: '', fees: stockFees });
  assert.strictEqual(r.buyFees.commission, 0.1);
});

test('可转债·深交所 万0.5 且 0.1 元起收', () => {
  const cbsz = { commissionRate: 0.005, minCommission: 0.1, stampTax: 0, transferFee: 0 };
  // 买 1000 元，佣金 1000*0.00005=0.05 < 0.1 → 取 0.1；无印花税/过户费
  const r = calc.calculate({ buyPrice: 100, shares: 10, sellPrice: 100, fees: cbsz });
  assert.strictEqual(r.buyFees.commission, 0.1);
  assert.strictEqual(r.sellFees.stampTax, 0);
});

test('债基/货币基金：0 手续费', () => {
  const zero = { commissionRate: 0, minCommission: 0, stampTax: 0, transferFee: 0 };
  const r = calc.calculate({ buyPrice: 1, shares: 10000, sellPrice: 1.05, fees: zero });
  assert.strictEqual(r.buyFees.total, 0);
  assert.strictEqual(r.sellFees.total, 0);
});

console.log(`\n${passed} passed`);
