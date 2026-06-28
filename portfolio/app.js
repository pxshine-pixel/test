/* 投资组合追踪器：表格编辑 + 本地存储 + SVG 饼图渲染 */
(function () {
  const STORAGE_KEY = 'portfolio.holdings.v1';
  const COLORS = [
    '#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa',
    '#ec4899', '#14b8a6', '#eab308', '#fb923c', '#60a5fa',
  ];

  const rowsEl = document.getElementById('rows');
  const emptyEl = document.getElementById('empty');
  const legendEl = document.getElementById('legend');
  const pieEl = document.getElementById('pie');

  let holdings = load();

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    } catch (e) {
      /* 隐私模式等可能写入失败，忽略 */
    }
  }

  /* ---------- 数值格式化 ---------- */
  function fmt(n) {
    return Number(n).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function signClass(n) {
    if (n > 0) return 'profit';
    if (n < 0) return 'loss';
    return '';
  }

  /* ---------- 渲染表格 ---------- */
  function renderRows(summary) {
    rowsEl.innerHTML = '';
    emptyEl.hidden = holdings.length > 0;

    summary.rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input data-i="${i}" data-k="name" value="${escapeAttr(r.name || '')}" placeholder="如 贵州茅台" /></td>
        <td><input data-i="${i}" data-k="shares" type="number" min="0" step="1" value="${attrNum(r.shares)}" /></td>
        <td><input data-i="${i}" data-k="buyPrice" type="number" min="0" step="0.001" value="${attrNum(r.buyPrice)}" /></td>
        <td><input data-i="${i}" data-k="currentPrice" type="number" min="0" step="0.001" value="${attrNum(r.currentPrice)}" /></td>
        <td class="ro">¥${fmt(r.marketValue)}</td>
        <td class="ro ${signClass(r.profit)}">${r.profit >= 0 ? '+' : ''}${fmt(r.profit)}</td>
        <td class="ro ${signClass(r.profit)}">${r.returnRate >= 0 ? '+' : ''}${fmt(r.returnRate)}%</td>
        <td><button class="del" data-del="${i}" title="删除">✕</button></td>
      `;
      rowsEl.appendChild(tr);
    });
  }

  /* ---------- 渲染汇总 ---------- */
  function renderSummary(s) {
    document.getElementById('sumValue').textContent = `¥${fmt(s.totalMarketValue)}`;
    document.getElementById('sumCost').textContent = `¥${fmt(s.totalCost)}`;

    const profitEl = document.getElementById('sumProfit');
    profitEl.textContent = `${s.totalProfit >= 0 ? '+' : ''}¥${fmt(s.totalProfit)}`;
    profitEl.className = `stat-value ${signClass(s.totalProfit)}`;

    const retEl = document.getElementById('sumReturn');
    retEl.textContent = `${s.totalReturnRate >= 0 ? '+' : ''}${fmt(s.totalReturnRate)}%`;
    retEl.className = `stat-value ${signClass(s.totalProfit)}`;
  }

  /* ---------- 渲染饼图（纯 SVG） ---------- */
  function renderPie(s) {
    const slices = s.allocation.filter((a) => a.marketValue > 0);
    pieEl.innerHTML = '';
    legendEl.innerHTML = '';

    if (slices.length === 0) {
      pieEl.innerHTML = '<circle cx="100" cy="100" r="80" fill="#273449" />' +
        '<text x="100" y="105" text-anchor="middle" fill="#94a3b8" font-size="12">暂无数据</text>';
      return;
    }

    const cx = 100, cy = 100, r = 80;
    let angle = -Math.PI / 2; // 从 12 点方向开始

    slices.forEach((slice, i) => {
      const frac = slice.weight / 100;
      const color = COLORS[i % COLORS.length];

      // 单只占满 100% 时用整圆，避免 arc 起终点重合不可见
      if (frac >= 0.9999) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', cx);
        c.setAttribute('cy', cy);
        c.setAttribute('r', r);
        c.setAttribute('fill', color);
        pieEl.appendChild(c);
      } else {
        const end = angle + frac * 2 * Math.PI;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const large = frac > 0.5 ? 1 : 0;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`);
        path.setAttribute('fill', color);
        pieEl.appendChild(path);
        angle = end;
      }

      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${color}"></span>` +
        `<span class="lg-name">${escapeHtml(slice.name)}</span>` +
        `<span class="lg-weight">${fmt(slice.weight)}%</span>`;
      legendEl.appendChild(li);
    });
  }

  /* ---------- 主渲染 ---------- */
  function render() {
    const s = summarize(holdings);
    renderSummary(s);
    renderRows(s);
    renderPie(s);
  }

  /* ---------- 事件 ---------- */
  rowsEl.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.i == null) return;
    const i = Number(t.dataset.i);
    const k = t.dataset.k;
    holdings[i][k] = k === 'name' ? t.value : t.value;
    save();
    // 只更新派生数据，避免重建输入框导致光标跳动
    updateDerived();
  });

  rowsEl.addEventListener('click', (e) => {
    const del = e.target.dataset.del;
    if (del == null) return;
    holdings.splice(Number(del), 1);
    save();
    render();
  });

  // 仅刷新只读列、汇总与饼图，不重建输入框
  function updateDerived() {
    const s = summarize(holdings);
    renderSummary(s);
    renderPie(s);
    s.rows.forEach((r, i) => {
      const tr = rowsEl.children[i];
      if (!tr) return;
      const tds = tr.querySelectorAll('td.ro');
      tds[0].textContent = `¥${fmt(r.marketValue)}`;
      tds[1].textContent = `${r.profit >= 0 ? '+' : ''}${fmt(r.profit)}`;
      tds[1].className = `ro ${signClass(r.profit)}`;
      tds[2].textContent = `${r.returnRate >= 0 ? '+' : ''}${fmt(r.returnRate)}%`;
      tds[2].className = `ro ${signClass(r.profit)}`;
    });
  }

  document.getElementById('addBtn').addEventListener('click', () => {
    holdings.push({ name: '', shares: '', buyPrice: '', currentPrice: '' });
    save();
    render();
    // 聚焦新行的第一个输入框
    const last = rowsEl.lastElementChild;
    if (last) last.querySelector('input').focus();
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (holdings.length && !confirm('确定清空全部持仓？此操作不可撤销。')) return;
    holdings = [];
    save();
    render();
  });

  document.getElementById('sampleBtn').addEventListener('click', () => {
    holdings = [
      { name: '贵州茅台', shares: 100, buyPrice: 1600, currentPrice: 1750 },
      { name: '宁德时代', shares: 500, buyPrice: 200, currentPrice: 185 },
      { name: '沪深300ETF', shares: 10000, buyPrice: 3.8, currentPrice: 4.05 },
    ];
    save();
    render();
  });

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
  function attrNum(v) {
    return v === '' || v == null ? '' : Number(v);
  }

  render();
})();
