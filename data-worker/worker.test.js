/* data-worker 纯逻辑测试：node worker.test.js */
const assert = require('assert');
const { normalizeSecid, parseKlineLine } = require('./lib');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('data-worker tests');

test('沪市 6 开头 → 1.code', () => {
  assert.strictEqual(normalizeSecid('600519').secid, '1.600519');
});
test('深市 0/3 开头 → 0.code', () => {
  assert.strictEqual(normalizeSecid('000001').secid, '0.000001');
  assert.strictEqual(normalizeSecid('300750').secid, '0.300750');
});
test('科创板 688 → 1.code', () => {
  assert.strictEqual(normalizeSecid('688678').secid, '1.688678');
});
test('北交所 8 开头 → 0.code（market=BJ）', () => {
  const r = normalizeSecid('830799');
  assert.strictEqual(r.market, 'BJ');
  assert.strictEqual(r.secid, '0.830799');
});
test('港股 5 位 → 116.code', () => {
  assert.strictEqual(normalizeSecid('00700').secid, '116.00700');
});
test('带前缀 sh600519 / SH.600519 / 600519.SH', () => {
  assert.strictEqual(normalizeSecid('sh600519').secid, '1.600519');
  assert.strictEqual(normalizeSecid('SH.600519').secid, '1.600519');
  assert.strictEqual(normalizeSecid('600519.SH').secid, '1.600519');
});
test('f10 代码用于财务接口（SH600519）', () => {
  assert.strictEqual(normalizeSecid('600519').f10, 'SH600519');
});
test('空输入返回 null', () => {
  assert.strictEqual(normalizeSecid('  '), null);
});

test('解析 K 线行', () => {
  const k = parseKlineLine('2025-06-30,1700.00,1750.50,1760,1690,12345,67890,1.2,0.8,14,0.5');
  assert.strictEqual(k.date, '2025-06-30');
  assert.strictEqual(k.open, 1700);
  assert.strictEqual(k.close, 1750.5);
  assert.strictEqual(k.high, 1760);
  assert.strictEqual(k.low, 1690);
  assert.strictEqual(k.volume, 12345);
});
test('K 线缺失值转 null', () => {
  const k = parseKlineLine('2025-06-30,-,-,-,-,-,-');
  assert.strictEqual(k.open, null);
});

console.log(`\n${passed} passed`);
