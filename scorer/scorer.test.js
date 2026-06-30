/* 基本面打分测试：node scorer.test.js */
const assert = require('assert');
const { scoreFundamentals, gradeOf } = require('./scorer');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const between = (x, a, b) => x >= a && x <= b;

console.log('scorer tests');

const strong = { revenueYoY: 30, netProfitYoY: 40, roe: 22, grossMargin: 55, netMargin: 28, debtRatio: 25, pe: 18, pb: 3 };
const weak = { revenueYoY: -48, netProfitYoY: -680, roe: -5, grossMargin: 7, netMargin: -10, debtRatio: 85, pe: -12, pb: 6 };

test('优质公司总分高（≥75）', () => {
  const r = scoreFundamentals(strong);
  assert.ok(r.total >= 75, `total=${r.total}`);
  assert.ok(['优', '良'].includes(r.grade), `grade=${r.grade}`);
});

test('困境公司总分低（≤35）', () => {
  const r = scoreFundamentals(weak);
  assert.ok(r.total <= 35, `total=${r.total}`);
});

test('四个维度都返回', () => {
  const r = scoreFundamentals(strong);
  assert.strictEqual(r.dimensions.length, 4);
  assert.deepStrictEqual(r.dimensions.map((d) => d.key), ['growth', 'profit', 'health', 'valuation']);
  r.dimensions.forEach((d) => assert.ok(d.score >= 0 && d.score <= 100, `${d.key}=${d.score}`));
});

test('亏损时 PE 记 0（估值维度被拉低）', () => {
  const loss = { pe: -10, pb: 2 };
  const r = scoreFundamentals(loss);
  const v = r.dimensions.find((d) => d.key === 'valuation');
  // PE=0 分，PB=2→78 分，加权 0.6*0+0.4*78≈31
  assert.ok(v.score < 40, `valuation=${v.score}`);
});

test('缺失维度被剔除并记入 missing', () => {
  const r = scoreFundamentals({ roe: 18, grossMargin: 40 }); // 只有盈利
  assert.ok(r.missing.includes('成长性'));
  assert.ok(r.missing.includes('估值'));
  const g = r.dimensions.find((d) => d.key === 'growth');
  assert.strictEqual(g.score, null);
  assert.ok(r.total != null, '仍能用可用维度算总分');
});

test('权重可调：估值权重为 0 时不参与', () => {
  const m = { revenueYoY: 30, netProfitYoY: 30, roe: 20, grossMargin: 50, netMargin: 20, debtRatio: 30, pe: 80, pb: 8 };
  const withVal = scoreFundamentals(m).total;
  const noVal = scoreFundamentals(m, { valuation: 0 }).total;
  assert.ok(noVal > withVal, `去掉高估值惩罚后应更高: ${noVal} vs ${withVal}`);
});

test('全空返回 total=null', () => {
  const r = scoreFundamentals({});
  assert.strictEqual(r.total, null);
  assert.strictEqual(r.grade, '—');
});

test('成长性随增速单调', () => {
  const lo = scoreFundamentals({ revenueYoY: -10, netProfitYoY: -10 }).dimensions[0].score;
  const hi = scoreFundamentals({ revenueYoY: 40, netProfitYoY: 40 }).dimensions[0].score;
  assert.ok(hi > lo, `${hi} > ${lo}`);
});

test('评级分档', () => {
  assert.strictEqual(gradeOf(85), '优');
  assert.strictEqual(gradeOf(70), '良');
  assert.strictEqual(gradeOf(55), '中');
  assert.strictEqual(gradeOf(40), '偏弱');
  assert.strictEqual(gradeOf(20), '弱');
});

console.log(`\n${passed} passed`);
