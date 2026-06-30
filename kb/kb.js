/**
 * 基本面知识库 - 核心（纯函数，浏览器 / Node 通用）。
 *
 * 提供：
 *   - filterStocks：按名称/代码搜索
 *   - metricsTemplate：用行情指标生成报告骨架（Markdown）
 *   - renderMarkdown：零依赖的安全 Markdown → HTML（标题/粗斜体/列表/表格/引用/代码/链接）
 */

/** 按关键字筛选股票（匹配名称或代码，忽略大小写） */
function filterStocks(stocks, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return stocks;
  return stocks.filter((s) =>
    String(s.name || '').toLowerCase().includes(q) ||
    String(s.code || '').toLowerCase().includes(q));
}

/** 用行情快照生成一份基本面报告骨架（Markdown） */
function metricsTemplate(q) {
  q = q || {};
  const row = (k, v, suffix) => `| ${k} | ${v == null || v === '' ? '—' : v}${v == null || v === '' ? '' : (suffix || '')} |`;
  const px = q.price != null && q.price !== '' ? q.price : '—';
  const lines = [
    `# ${q.name || ''} ${q.code || ''}`.trim(),
    '',
    '> **一句话定性**：（先写核心结论：是基本面标的还是题材/事件驱动标的）',
    '',
    `**数据口径**：财务以最新定期报告为准；价格约 ${px}；若涉破产重整 / 资本公积转增，股本与市值口径混乱，**务必以 OpenD / 券商校准当前真实总股本**再估值。`,
    '',
    '## 一、公司是什么',
    '（主营业务、历史沿革、是否经历重整 / 转型、各业务板块拆分）',
    '',
    '## 二、基本面',
    '',
    '| 指标 | 数值 |',
    '| --- | --- |',
    row('现价', q.price),
    row('市盈率 PE', q.peTtm != null ? q.peTtm : q.pe),
    row('市净率 PB', q.pb),
    row('股息率', q.dividend, '%'),
    '',
    '（营收 / 利润 / 毛利率 / 负债率 / 速动比率 / 现金流的趋势与结论）',
    '',
    '## 三、催化剂 / 多头逻辑',
    '（题材、并购、事件驱动；标的质地、可信度、兑现节点）',
    '',
    '## 四、风险',
    '（最硬的风险：股东质押 / 平仓线、流动性、整合不确定、商誉、退市等）',
    '',
    '## 五、框架收口',
    '- **F 基本面**：',
    '- **C 催化剂**：',
    '- **估值**：',
    '- **趋势**：',
    '',
    '> **一句话定性**：',
  ];
  return lines.join('\n');
}

/* ---------------- 极简 Markdown 渲染 ---------------- */
function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;

  const flushList = (items, ordered) => {
    const tag = ordered ? 'ol' : 'ul';
    html.push(`<${tag}>` + items.map((it) => `<li>${inline(it)}</li>`).join('') + `</${tag}>`);
  };

  while (i < lines.length) {
    let line = lines[i];

    // 空行
    if (!line.trim()) { i++; continue; }

    // 代码块 ```
    if (/^```/.test(line.trim())) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // 跳过结束 ```
      html.push('<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // 标题 #..######
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lv = h[1].length; html.push(`<h${lv}>${inline(h[2].trim())}</h${lv}>`); i++; continue; }

    // 分割线
    if (/^(\s*([-*_])\s*){3,}$/.test(line)) { html.push('<hr/>'); i++; continue; }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]*-{1,}[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { body.push(splitRow(lines[i])); i++; }
      let t = '<table><thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      t += body.map((r) => '<tr>' + header.map((_, idx) => `<td>${inline(r[idx] || '')}</td>`).join('') + '</tr>').join('');
      t += '</tbody></table>';
      html.push(t);
      continue;
    }

    // 引用 >
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      html.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      flushList(items, false); continue;
    }
    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      flushList(items, true); continue;
    }

    // 段落（合并连续非空、非块级行）
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|```|\s*>[\s]|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length)) {
      buf.push(lines[i]); i++;
    }
    html.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return html.join('\n');
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/** 行内格式：粗体、斜体、行内代码、链接（先转义 HTML 防注入） */
function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const API = { filterStocks, metricsTemplate, renderMarkdown, escapeHtml };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.KB = API;
