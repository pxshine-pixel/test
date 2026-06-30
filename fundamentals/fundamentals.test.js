/* 基本面汇总解析/排序测试：node fundamentals.test.js */
const assert = require('assert');
const F = require('./fundamentals');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('fundamentals tests');

test('解析 JSON 数组对象，识别分数/名称/代码列', () => {
  const r = F.parse('[{"name":"茅台","code":"600519","score":85,"pe":30},{"name":"五粮液","code":"000858","score":78,"pe":22}]');
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.scoreKey, 'score');
  assert.strictEqual(r.nameKey, 'name');
  assert.strictEqual(r.codeKey, 'code');
  assert.strictEqual(r.rows[0].score, 85);
});

test('解析 JSON 对象映射 {名称: 分数}', () => {
  const r = F.parse('{"茅台":85,"五粮液":78}');
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.scoreKey, 'score');
  assert.strictEqual(r.rows[0].name, '茅台');
});

test('解析 Markdown 表格并识别中文分数列', () => {
  const md = `| 股票 | 代码 | 基本面分 | ROE |
| --- | --- | --- | --- |
| 茅台 | 600519 | 85 | 30 |
| 宁德 | 300750 | 72 | 18 |`;
  const r = F.parse(md);
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.scoreKey, '基本面分');
  assert.strictEqual(r.nameKey, '股票');
  assert.strictEqual(r.rows[0]['ROE'], 30);
});

test('解析 CSV', () => {
  const csv = 'name,score,pe\n茅台,85,30\n五粮液,78,22';
  const r = F.parse(csv);
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.scoreKey, 'score');
  assert.strictEqual(r.rows[1].pe, 22);
});

test('解析「名称 分数」文本行', () => {
  const r = F.parse('贵州茅台 85\n五粮液 78\n中国平安 60');
  assert.strictEqual(r.rows.length, 3);
  assert.strictEqual(r.scoreKey, 'score');
  assert.strictEqual(r.rows[0].name, '贵州茅台');
  assert.strictEqual(r.rows[0].score, 85);
});

test('百分号/千分位数值被正确转换', () => {
  const r = F.parse('[{"name":"A","score":"88","roe":"15.5%","mktcap":"1,234"}]');
  assert.strictEqual(r.rows[0].score, 88);
  assert.strictEqual(r.rows[0].roe, 15.5);
  assert.strictEqual(r.rows[0].mktcap, 1234);
});

test('按分数降序排序并排名', () => {
  const r = F.parse('[{"name":"A","score":60},{"name":"B","score":90},{"name":"C","score":75}]');
  const sorted = F.sortByScore(r.rows, 'score');
  assert.deepStrictEqual(sorted.map((x) => x.name), ['B', 'C', 'A']);
  assert.strictEqual(sorted[0].__rank, 1);
  assert.strictEqual(sorted[2].__rank, 3);
});

test('升序排序', () => {
  const r = F.parse('[{"name":"A","score":60},{"name":"B","score":90}]');
  const sorted = F.sortByScore(r.rows, 'score', 'asc');
  assert.strictEqual(sorted[0].name, 'A');
});

test('分数统计：均值/最高/最低', () => {
  const r = F.parse('[{"name":"A","score":60},{"name":"B","score":90},{"name":"C","score":"未评"}]');
  const s = F.scoreStats(r.rows, 'score');
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.scored, 2);
  assert.strictEqual(s.avg, 75);
  assert.strictEqual(s.max, 90);
});

test('空输入安全返回', () => {
  const r = F.parse('   ');
  assert.deepStrictEqual(r.rows, []);
});

test('非数字分数排在数字之后', () => {
  const rows = [{ name: 'A', score: 'NA' }, { name: 'B', score: 50 }];
  const sorted = F.sortByScore(rows, 'score');
  assert.strictEqual(sorted[0].name, 'B');
});

console.log(`\n${passed} passed`);
