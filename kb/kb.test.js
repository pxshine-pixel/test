/* 基本面知识库核心测试：node kb.test.js */
const assert = require('assert');
const KB = require('./kb');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const has = (html, frag) => assert.ok(html.includes(frag), `期望包含 ${frag}\n实际: ${html}`);

console.log('kb tests');

test('筛选：按名称或代码匹配', () => {
  const list = [{ name: '贵州茅台', code: '600519' }, { name: '宁德时代', code: '300750' }];
  assert.strictEqual(KB.filterStocks(list, '茅台').length, 1);
  assert.strictEqual(KB.filterStocks(list, '300750').length, 1);
  assert.strictEqual(KB.filterStocks(list, '').length, 2);
  assert.strictEqual(KB.filterStocks(list, 'xyz').length, 0);
});

test('报告模板含名称、代码与指标', () => {
  const md = KB.metricsTemplate({ name: '贵州茅台', code: '600519', price: 1750, pe: 28, pb: 9, dividend: 2.5 });
  has(md, '贵州茅台 600519');
  has(md, '现价');
  has(md, '1750');
  has(md, '2.5%');
  has(md, '基本面');
  has(md, '一句话定性');
  has(md, '框架收口');
});

test('Markdown：标题', () => {
  has(KB.renderMarkdown('# 标题一'), '<h1>标题一</h1>');
  has(KB.renderMarkdown('### 小标题'), '<h3>小标题</h3>');
});

test('Markdown：粗体/斜体/行内代码', () => {
  has(KB.renderMarkdown('这是 **粗** 和 *斜* 和 `码`'), '<strong>粗</strong>');
  has(KB.renderMarkdown('这是 **粗** 和 *斜* 和 `码`'), '<em>斜</em>');
  has(KB.renderMarkdown('这是 **粗** 和 *斜* 和 `码`'), '<code>码</code>');
});

test('Markdown：无序与有序列表', () => {
  has(KB.renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  has(KB.renderMarkdown('1. 一\n2. 二'), '<ol><li>一</li><li>二</li></ol>');
});

test('Markdown：表格', () => {
  const html = KB.renderMarkdown('| 指标 | 值 |\n| --- | --- |\n| PE | 28 |\n| PB | 9 |');
  has(html, '<table>');
  has(html, '<th>指标</th>');
  has(html, '<td>28</td>');
});

test('Markdown：引用与段落', () => {
  has(KB.renderMarkdown('> 引用内容'), '<blockquote>引用内容</blockquote>');
  has(KB.renderMarkdown('普通段落'), '<p>普通段落</p>');
});

test('Markdown：转义 HTML 防注入', () => {
  const html = KB.renderMarkdown('正常 <script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), '不应保留原始 script 标签');
  has(html, '&lt;script&gt;');
});

test('Markdown：链接安全渲染', () => {
  const html = KB.renderMarkdown('见 [文档](https://example.com)');
  has(html, 'href="https://example.com"');
  has(html, 'rel="noopener noreferrer"');
});

test('空 Markdown 返回空串', () => {
  assert.strictEqual(KB.renderMarkdown(''), '');
});

console.log(`\n${passed} passed`);
