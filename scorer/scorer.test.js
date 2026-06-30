/* 基本面打分测试：node scorer.test.js */
const assert = require('assert');
const { scoreFundamentals, redFlags, gradeOf, WEIGHT_PRESETS } = require('./scorer');

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

test('五个维度都返回', () => {
  const r = scoreFundamentals(strong);
  assert.strictEqual(r.dimensions.length, 5);
  assert.deepStrictEqual(r.dimensions.map((d) => d.key), ['growth', 'profit', 'cashflow', 'health', 'valuation']);
});

test('现金流质量维度：含金量高→高分，现金流为负→很低', () => {
  const good = scoreFundamentals({ ocfToNp: 110 }).dimensions.find((d) => d.key === 'cashflow');
  const bad = scoreFundamentals({ ocfToNp: -40 }).dimensions.find((d) => d.key === 'cashflow');
  assert.ok(good.score > 80, `good=${good.score}`);
  assert.ok(bad.score <= 10, `bad=${bad.score}`);
});

test('PEG：高增长让高 PE 不被过度惩罚', () => {
  const v = (m) => scoreFundamentals(m).dimensions.find((d) => d.key === 'valuation').score;
  // 同样 PE=40，净利增速 50% vs 0%
  const hiGrowth = v({ pe: 40, pb: 4, netProfitYoY: 50 });
  const noGrowth = v({ pe: 40, pb: 4, netProfitYoY: 0 });
  assert.ok(hiGrowth > noGrowth, `高增长估值分应更高: ${hiGrowth} vs ${noGrowth}`);
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

test('红旗：困境股触发多个警示', () => {
  const flags = redFlags(weak).map((f) => f.label);
  assert.ok(flags.includes('亏损'), flags.join());
  assert.ok(flags.includes('高杠杆'), flags.join());
  assert.ok(flags.includes('利润大幅下滑'), flags.join());
});

test('红旗：增收不增利识别', () => {
  const flags = redFlags({ revenueYoY: 53, netProfitYoY: 1 }).map((f) => f.label);
  assert.ok(flags.includes('增收不增利'), flags.join());
});

test('红旗：现金流为负标记 danger', () => {
  const f = redFlags({ ocfToNp: -20 }).find((x) => x.label === '现金流存疑');
  assert.ok(f && f.level === 'danger');
});

test('红旗：优质公司无警示', () => {
  assert.strictEqual(redFlags(strong).length, 0);
});

test('权重预设存在且字段完整', () => {
  ['均衡', '价值', '成长', '质量'].forEach((k) => {
    const p = WEIGHT_PRESETS[k];
    assert.ok(p, k);
    ['growth', 'profit', 'cashflow', 'health', 'valuation'].forEach((d) => assert.ok(typeof p[d] === 'number', `${k}.${d}`));
  });
});

test('成长预设比价值预设更看重成长权重', () => {
  assert.ok(WEIGHT_PRESETS.成长.growth > WEIGHT_PRESETS.价值.growth);
  assert.ok(WEIGHT_PRESETS.价值.valuation > WEIGHT_PRESETS.成长.valuation);
});

console.log(`\n${passed} passed`);
