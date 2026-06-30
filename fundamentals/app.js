/* 基本面汇总排序：解析粘贴内容 → 按分数排序 → 渲染汇总表 */
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'fundamentals.state.v1';

  let state = load() || { raw: '', scoreKey: null, sortKey: null, sortDir: 'desc' };
  let parsed = null;

  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }

  const SAMPLE = `| 股票 | 代码 | 基本面分 | PE | ROE% | 营收增长% | 负债率% | 股息率% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 贵州茅台 | 600519 | 88 | 28 | 31 | 16 | 18 | 2.5 |
| 宁德时代 | 300750 | 74 | 22 | 22 | 35 | 58 | 0.3 |
| 中国平安 | 601318 | 69 | 8 | 12 | 5 | 88 | 5.6 |
| 长江电力 | 600900 | 81 | 19 | 15 | 8 | 55 | 3.8 |
| 隆基绿能 | 601012 | 52 | 16 | 9 | -18 | 60 | 1.1 |`;

  /* ---------- 解析 ---------- */
  function doParse() {
    const text = $('input').value;
    state.raw = text;
    parsed = Fundamentals.parse(text);

    const warn = $('warn');
    if (parsed.warnings.length) { warn.hidden = false; warn.textContent = '提示：' + parsed.warnings.join('；'); }
    else warn.hidden = true;

    if (!parsed.rows.length) {
      $('result').innerHTML = '<p class="empty">没有可显示的数据。请粘贴 /score 的输出后点「解析并排序」。</p>';
      $('stats').hidden = true; $('scorePickWrap').hidden = true; $('exportBtn').hidden = true;
      save();
      return;
    }

    // 选择排序列：优先沿用用户上次选择，否则自动识别的分数列
    const cols = parsed.columns;
    state.scoreKey = (state.scoreKey && cols.includes(state.scoreKey)) ? state.scoreKey
      : (parsed.scoreKey || cols[0]);
    state.sortKey = state.scoreKey;
    state.sortDir = 'desc';

    buildScorePicker(cols);
    render();
    save();
  }

  function buildScorePicker(cols) {
    const sel = $('scoreKey');
    sel.innerHTML = cols.map((c) => `<option value="${esc(c)}"${c === state.scoreKey ? ' selected' : ''}>${esc(c)}</option>`).join('');
    $('scorePickWrap').hidden = false;
    $('exportBtn').hidden = false;
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const rows = Fundamentals.sortByScore(parsed.rows, state.sortKey, state.sortDir);
    const cols = orderedColumns(parsed.columns);
    const scoreKey = state.scoreKey;
    const sc = Fundamentals.scoreStats(parsed.rows, scoreKey);

    // 统计条
    const st = $('stats');
    st.hidden = false;
    st.innerHTML = [
      statCard('股票数', sc.count),
      statCard('已评分', sc.scored),
      statCard('平均分', sc.avg == null ? '—' : sc.avg),
      statCard('最高 / 最低', sc.max == null ? '—' : `${sc.max} / ${sc.min}`),
    ].join('');

    // 分数色阶范围
    const nums = parsed.rows.map((r) => r[scoreKey]).filter((v) => typeof v === 'number');
    const lo = nums.length ? Math.min(...nums) : 0;
    const hi = nums.length ? Math.max(...nums) : 1;

    const th = (c) => {
      const active = c === state.sortKey;
      const arrow = active ? (state.sortDir === 'desc' ? ' ▼' : ' ▲') : '';
      const cls = (c === scoreKey ? 'score-col ' : '') + (active ? 'active' : '');
      return `<th class="${cls}" data-col="${esc(c)}">${esc(c)}${arrow}</th>`;
    };
    const td = (r, c) => {
      const v = r[c];
      const txt = v === '' || v == null ? '—' : v;
      if (c === scoreKey && typeof v === 'number') {
        return `<td class="score-col" style="background:${scoreColor(v, lo, hi)}"><strong>${txt}</strong></td>`;
      }
      const numCls = typeof v === 'number' ? ' num' : '';
      return `<td class="${numCls.trim()}">${esc(txt)}</td>`;
    };

    const html = `
      <div class="table-wrap">
        <table class="rank-table">
          <thead><tr><th>#</th>${cols.map(th).join('')}</tr></thead>
          <tbody>
            ${rows.map((r) => `<tr><td class="rank">${r.__rank}</td>${cols.map((c) => td(r, c)).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    $('result').innerHTML = html;

    // 表头点击排序
    $('result').querySelectorAll('th[data-col]').forEach((el) => {
      el.addEventListener('click', () => {
        const c = el.dataset.col;
        if (state.sortKey === c) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        else { state.sortKey = c; state.sortDir = 'desc'; }
        render(); save();
      });
    });
  }

  function orderedColumns(cols) {
    const front = [parsed.nameKey, parsed.codeKey, state.scoreKey].filter(Boolean);
    const rest = cols.filter((c) => !front.includes(c));
    return [...front, ...rest];
  }

  function statCard(label, val) {
    return `<div class="stat"><span>${label}</span><strong>${val}</strong></div>`;
  }

  // 分数 → 红(低)到绿(高)的淡色背景
  function scoreColor(v, lo, hi) {
    const t = hi === lo ? 1 : (v - lo) / (hi - lo);   // 0..1
    const hue = 0 + t * 130;                           // 0红 → 130绿
    return `hsl(${hue.toFixed(0)}, 70%, 92%)`;
  }

  /* ---------- 事件 ---------- */
  $('parseBtn').onclick = doParse;
  $('sampleBtn').onclick = () => { $('input').value = SAMPLE; doParse(); };
  $('clearBtn').onclick = () => {
    $('input').value = ''; state = { raw: '', scoreKey: null, sortKey: null, sortDir: 'desc' };
    parsed = null; $('result').innerHTML = ''; $('stats').hidden = true;
    $('scorePickWrap').hidden = true; $('exportBtn').hidden = true; $('warn').hidden = true;
    save();
  };
  $('scoreKey').onchange = (e) => {
    state.scoreKey = e.target.value; state.sortKey = e.target.value; state.sortDir = 'desc';
    render(); save();
  };
  $('exportBtn').onclick = exportCSV;

  function exportCSV() {
    if (!parsed || !parsed.rows.length) return;
    const cols = orderedColumns(parsed.columns);
    const rows = Fundamentals.sortByScore(parsed.rows, state.sortKey, state.sortDir);
    const esc2 = (v) => {
      const s = v === '' || v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [['排名', ...cols].join(',')];
    rows.forEach((r) => lines.push([r.__rank, ...cols.map((c) => esc2(r[c]))].join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'fundamentals-ranked.csv'; a.click();
    URL.revokeObjectURL(a.href);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 初始化 ---------- */
  if (state.raw) { $('input').value = state.raw; doParse(); }
})();
