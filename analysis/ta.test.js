/* 技术分析核心测试：node ta.test.js */
const assert = require('assert');
const TA = require('./ta');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('ta tests');

test('SMA 基本正确', () => {
  const r = TA.sma([1, 2, 3, 4, 5], 3);
  assert.strictEqual(r[0], null);
  assert.strictEqual(r[1], null);
  assert.strictEqual(r[2], 2); // (1+2+3)/3
  assert.strictEqual(r[3], 3);
  assert.strictEqual(r[4], 4);
});

test('EMA 首值播种、单调向价格收敛', () => {
  const r = TA.ema([10, 10, 10, 10], 3);
  assert.ok(approx(r[0], 10) && approx(r[3], 10)); // 常数序列 EMA 恒为该值
});

test('EMA 计算值正确(period=2,k=2/3)', () => {
  // ema0=2; ema1=4*2/3+2*1/3=3.333; ema2=6*2/3+3.333*1/3=5.111
  const r = TA.ema([2, 4, 6], 2);
  assert.ok(approx(r[1], 3.333), `r1=${r[1]}`);
  assert.ok(approx(r[2], 5.111), `r2=${r[2]}`);
});

test('MACD 结构与零值（常数序列 dif=dea=0）', () => {
  const closes = new Array(40).fill(100);
  const m = TA.macd(closes);
  assert.ok(approx(TA.lastValid(m.dif), 0));
  assert.ok(approx(TA.lastValid(m.hist), 0));
});

test('RSI：单调上涨应接近 100', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const r = TA.lastValid(TA.rsi(closes, 14));
  assert.ok(r > 99, `rsi=${r}`);
});

test('RSI：单调下跌应接近 0', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
  const r = TA.lastValid(TA.rsi(closes, 14));
  assert.ok(r < 1, `rsi=${r}`);
});

test('RSI 在 0~100 之间', () => {
  const closes = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const r = TA.lastValid(TA.rsi(closes, 14));
  assert.ok(r > 0 && r < 100, `rsi=${r}`);
});

test('KDJ 取值合理、J=3K-2D', () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({
    high: 10 + i + 0.5, low: 10 + i - 0.5, close: 10 + i,
  }));
  const { k, d, j } = TA.kdj(bars);
  const ki = TA.lastValid(k), di = TA.lastValid(d), ji = TA.lastValid(j);
  assert.ok(approx(ji, 3 * ki - 2 * di), 'J=3K-2D');
  assert.ok(ki >= 0 && ki <= 100);
});

test('密集成交区：成交量集中价位识别为 POC', () => {
  // 让 20 元附近成交量极大
  const bars = [];
  for (let i = 0; i < 30; i++) {
    const heavy = i % 3 === 0;
    bars.push({
      high: heavy ? 20.4 : 25.4, low: heavy ? 19.6 : 24.6,
      close: heavy ? 20 : 25, volume: heavy ? 1000 : 50,
    });
  }
  const vp = TA.volumeProfile(bars, 24);
  assert.ok(vp.poc >= 19 && vp.poc <= 21, `poc=${vp.poc}`);
  assert.ok(vp.valueArea.low <= vp.poc && vp.valueArea.high >= vp.poc);
  const sumPct = vp.bins.reduce((a, b) => a + b.pct, 0);
  assert.ok(approx(sumPct, 100, 1), `pct和=${sumPct}`);
});

const sigDir = (r, name) => (r.signals.find((s) => s.name === name) || {}).dir;

test('阶段信号：上涨趋势中均线多头、MACD 多头', () => {
  const bars = Array.from({ length: 70 }, (_, i) => ({
    date: `2024-${String(1 + Math.floor(i / 30)).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
    open: 100 + i, high: 100 + i + 1, low: 100 + i - 1, close: 100 + i + 0.5, volume: 1000,
  }));
  const r = TA.stageSignal(bars);
  assert.strictEqual(sigDir(r, '均线排列'), 1, '应多头排列');
  assert.strictEqual(sigDir(r, 'MACD'), 1, 'MACD 应多头');
  assert.ok(r.signals.length >= 4);
});

test('阶段信号：下跌趋势中均线空头、MACD 空头', () => {
  const bars = Array.from({ length: 70 }, (_, i) => ({
    open: 200 - i, high: 200 - i + 1, low: 200 - i - 1, close: 200 - i - 0.5, volume: 1000,
  }));
  const r = TA.stageSignal(bars);
  assert.strictEqual(sigDir(r, '均线排列'), -1, '应空头排列');
  assert.strictEqual(sigDir(r, 'MACD'), -1, 'MACD 应空头');
});

test('阶段信号：回调后的健康上涨 → 买入/逢低', () => {
  // 先涨 60 根，再回调 8 根，使 RSI/KDJ 降温、价格回到密集区下沿
  const bars = [];
  for (let i = 0; i < 60; i++) bars.push(bar(100 + i, 1000));
  let p = 160;
  for (let i = 0; i < 10; i++) { p -= 4; bars.push(bar(p, 3000)); } // 放量回调形成下方密集区
  const r = TA.stageSignal(bars);
  assert.ok(r.score >= 1, `score=${r.score}`);
  assert.ok(['buy', 'accumulate'].includes(r.level), `level=${r.level}`);
  function bar(c, v) { return { open: c, high: c + 1, low: c - 1, close: c, volume: v }; }
});

test('金叉检测', () => {
  const fast = [1, 2, 3, 4, 5];
  const slow = [3, 3, 3, 3, 3];
  // fast 在某点上穿 slow → 最后一点判断 cur>0
  assert.strictEqual(TA.crossAt([2, 2, 2, 4], [3, 3, 3, 3]), 1);
  assert.strictEqual(TA.crossAt([4, 4, 4, 2], [3, 3, 3, 3]), -1);
});

console.log(`\n${passed} passed`);
