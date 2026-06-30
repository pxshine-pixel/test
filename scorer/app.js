/* 基本面打分：可调权重 + 指标录入/拉取 → 自动算分 → 排序 */
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'scorer.state.v1';
  const METRICS = [
    ['revenueYoY', '营收%'], ['netProfitYoY', '净利%'], ['roe', 'ROE%'],
    ['grossMargin', '毛利%'], ['netMargin', '净利率%'], ['debtRatio', '负债%'],
    ['pe', 'PE'], ['pb', 'PB'],
  ];

  let state = load() || { stocks: [], weights: { ...Scorer.DEFAULT_WEIGHTS } };

  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  function uid() { return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4); }

  function readWeights() {
    return {
      growth: numOr($('w-growth').value, 0),
      profit: numOr($('w-profit').value, 0),
      health: numOr($('w-health').value, 0),
      valuation: numOr($('w-valuation').value, 0),
    };
  }
  function numOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function valAttr(v) { return v === '' || v == null ? '' : v; }

  function scoreOf(s) { return Scorer.scoreFundamentals(s.metrics || {}, state.weights); }
  function finalOf(s, auto) {
    const ov = s.override;
    return (ov !== '' && ov != null && Number.isFinite(Number(ov))) ? Number(ov) : (auto == null ? null : auto);
  }

  /* ---------- 渲染 ---------- */
  function render() {
    // 同步权重输入
    $('w-growth').value = state.weights.growth;
    $('w-profit').value = state.weights.profit;
    $('w-health').value = state.weights.health;
    $('w-valuation').value = state.weights.valuation;

    const scored = state.stocks.map((s) => {
      const r = scoreOf(s);
      return { s, r, final: finalOf(s, r.total) };
    });
    scored.sort((a, b) => (b.final == null ? -1 : b.final) - (a.final == null ? -1 : a.final));

    const tbody = $('rows');
    tbody.innerHTML = '';
    $('empty').hidden = state.stocks.length > 0;

    scored.forEach((it, i) => {
      const { s, r, final } = it;
      const tr = document.createElement('tr');
      tr.dataset.id = s.id;
      const metricCells = METRICS.map(([k]) =>
        `<td><input class="m" data-id="${s.id}" data-k="${k}" type="number" step="0.01" value="${valAttr(s.metrics ? s.metrics[k] : '')}" /></td>`).join('');
      const sub = (key) => { const d = r.dimensions.find((x) => x.key === key); return d && d.score != null ? d.score : '—'; };
      tr.innerHTML =
        `<td class="rank">${i + 1}</td>` +
        `<td><input class="name" data-id="${s.id}" value="${esc(s.name || '')}" placeholder="名称" /></td>` +
        `<td class="code">${esc(s.code)}</td>` +
        metricCells +
        `<td class="sub">${sub('growth')}</td><td class="sub">${sub('profit')}</td><td class="sub">${sub('health')}</td><td class="sub">${sub('valuation')}</td>` +
        `<td class="total" style="background:${final == null ? '' : scoreColor(final)}"><strong>${r.total == null ? '—' : r.total}</strong></td>` +
        `<td><input class="ov" data-id="${s.id}" type="number" step="1" value="${valAttr(s.override)}" placeholder="—" /></td>` +
        `<td class="grade">${Scorer.gradeOf(final)}</td>` +
        `<td class="ops"><button class="mini pull" data-id="${s.id}" title="拉取指标">⤓</button><button class="mini del" data-id="${s.id}" title="删除">✕</button></td>`;
      tbody.appendChild(tr);
    });
  }

  // 录入时就地更新派生列，不重排（避免光标跳动）
  function updateRowDerived(id) {
    const s = state.stocks.find((x) => x.id === id);
    const tr = $('rows').querySelector(`tr[data-id="${id}"]`);
    if (!s || !tr) return;
    const r = scoreOf(s);
    const final = finalOf(s, r.total);
    const subs = tr.querySelectorAll('td.sub');
    ['growth', 'profit', 'health', 'valuation'].forEach((k, idx) => {
      const d = r.dimensions.find((x) => x.key === k);
      subs[idx].textContent = d && d.score != null ? d.score : '—';
    });
    const totalCell = tr.querySelector('td.total');
    totalCell.querySelector('strong').textContent = r.total == null ? '—' : r.total;
    totalCell.style.background = final == null ? '' : scoreColor(final);
    tr.querySelector('td.grade').textContent = Scorer.gradeOf(final);
  }

  function scoreColor(v) {
    const t = Math.max(0, Math.min(100, v)) / 100;
    const hue = t * 130; // 0红 → 130绿
    return `hsl(${hue.toFixed(0)}, 70%, 90%)`;
  }

  /* ---------- 事件 ---------- */
  $('rows').addEventListener('input', (e) => {
    const t = e.target;
    const id = t.dataset.id;
    if (!id) return;
    const s = state.stocks.find((x) => x.id === id);
    if (!s) return;
    if (t.classList.contains('m')) { s.metrics = s.metrics || {}; s.metrics[t.dataset.k] = t.value; updateRowDerived(id); }
    else if (t.classList.contains('ov')) { s.override = t.value; updateRowDerived(id); }
    else if (t.classList.contains('name')) { s.name = t.value; }
    save();
  });

  $('rows').addEventListener('click', (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    if (e.target.classList.contains('del')) {
      state.stocks = state.stocks.filter((x) => x.id !== id); save(); render();
    } else if (e.target.classList.contains('pull')) {
      pull(id);
    }
  });

  ['w-growth', 'w-profit', 'w-health', 'w-valuation'].forEach((wid) => {
    $(wid).addEventListener('change', () => { state.weights = readWeights(); save(); render(); });
  });
  $('resetW').onclick = () => { state.weights = { ...Scorer.DEFAULT_WEIGHTS }; save(); render(); };

  $('addBtn').onclick = () => {
    const code = $('newCode').value.trim();
    const name = $('newName').value.trim();
    if (!code) { alert('请输入代码'); return; }
    if (state.stocks.some((x) => x.code.toLowerCase() === code.toLowerCase())) { alert('已存在'); return; }
    state.stocks.push({ id: uid(), code, name, metrics: {}, override: '' });
    $('newCode').value = ''; $('newName').value = '';
    save(); render();
  };
  $('newCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addBtn').click(); });

  /* ---------- 数据拉取 ---------- */
  async function pull(id) {
    const s = state.stocks.find((x) => x.id === id);
    if (!s) return;
    const btn = $('rows').querySelector(`button.pull[data-id="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    const ok = await fillMetrics(s);
    if (btn) { btn.disabled = false; btn.textContent = '⤓'; }
    save(); render();
    if (!ok) alert('拉取失败：确认数据源可用（本机 bridge.py 或已配置的云端 Worker）。Shift+点击右上角状态可设置地址。');
  }

  async function fillMetrics(s) {
    const [q, f] = await Promise.all([
      Quotes.quote(s.code).catch(() => ({ ok: false })),
      Quotes.financials(s.code).catch(() => ({ ok: false })),
    ]);
    let any = false;
    s.metrics = s.metrics || {};
    if (q && q.ok && q.quotes && q.quotes[0]) {
      const x = q.quotes[0];
      if (!s.name && x.name) s.name = x.name;
      if (x.pe != null) { s.metrics.pe = x.pe; any = true; }
      if (x.pb != null) { s.metrics.pb = x.pb; any = true; }
    }
    if (f && f.ok && f.financials && f.financials[0]) {
      const fin = f.financials[0];
      [['revenueYoY', 'revenueYoY'], ['netProfitYoY', 'netProfitYoY'], ['roe', 'roe'],
       ['grossMargin', 'grossMargin'], ['netMargin', 'netMargin'], ['debtRatio', 'debtRatio']].forEach(([mk, fk]) => {
        if (fin[fk] != null) { s.metrics[mk] = fin[fk]; any = true; }
      });
    }
    return any;
  }

  $('pullAllBtn').onclick = async () => {
    if (!state.stocks.length) return;
    const btn = $('pullAllBtn'); btn.disabled = true; btn.textContent = '拉取中…';
    let n = 0;
    for (const s of state.stocks) { if (await fillMetrics(s)) n++; }
    btn.disabled = false; btn.textContent = '⤓ 拉取全部';
    save(); render();
    alert(`已更新 ${n} / ${state.stocks.length} 只股票的指标。`);
  };

  $('sampleBtn').onclick = () => {
    state.stocks = [
      { id: uid(), code: '600519', name: '贵州茅台', metrics: { revenueYoY: -1.21, netProfitYoY: -4.53, roe: 36.34, grossMargin: 91.93, netMargin: 47.8, debtRatio: 18, pe: 16.23, pb: 5.68 }, override: '' },
      { id: uid(), code: '688678', name: '福立旺', metrics: { revenueYoY: 53.46, netProfitYoY: 1.26, roe: 6, grossMargin: 22, netMargin: 3, debtRatio: 45, pe: 60, pb: 3 }, override: '' },
      { id: uid(), code: '300727', name: '润禾材料', metrics: { revenueYoY: 6.21, netProfitYoY: 24.66, roe: 9, grossMargin: 27.04, netMargin: 8.51, debtRatio: 40, pe: 30, pb: 2.2 }, override: '' },
      { id: uid(), code: '000620', name: '盈新发展', metrics: { revenueYoY: -48.38, netProfitYoY: -682, roe: -5, grossMargin: 6.74, netMargin: -10, debtRatio: 58.49, pe: -12, pb: 6 }, override: '' },
    ];
    save(); render();
  };

  $('exportBtn').onclick = () => {
    if (!state.stocks.length) return;
    const scored = state.stocks.map((s) => { const r = scoreOf(s); return { s, r, final: finalOf(s, r.total) }; })
      .sort((a, b) => (b.final == null ? -1 : b.final) - (a.final == null ? -1 : a.final));
    const head = ['排名', '名称', '代码', ...METRICS.map(([, l]) => l), '成长', '盈利', '健康', '估值', '自动分', '手动', '最终分', '评级'];
    const lines = [head.join(',')];
    scored.forEach((it, i) => {
      const { s, r, final } = it;
      const sub = (k) => { const d = r.dimensions.find((x) => x.key === k); return d && d.score != null ? d.score : ''; };
      const row = [i + 1, s.name || '', s.code, ...METRICS.map(([k]) => (s.metrics && s.metrics[k] != null ? s.metrics[k] : '')),
        sub('growth'), sub('profit'), sub('health'), sub('valuation'), r.total == null ? '' : r.total, s.override || '', final == null ? '' : final, Scorer.gradeOf(final)];
      lines.push(row.map(csv).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fundamental-scores.csv'; a.click();
    URL.revokeObjectURL(a.href);
  };
  function csv(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  /* ---------- 数据源状态 ---------- */
  async function checkBridge() {
    const dot = $('bridgeDot'), text = $('bridgeText');
    text.textContent = '检测中…'; dot.className = 'dot';
    const h = await Quotes.health();
    if (h.ok) { dot.className = 'dot ok'; text.textContent = '数据源已连接'; }
    else { dot.className = 'dot err'; text.textContent = '数据源未连接'; text.title = h.error || ''; }
  }
  $('bridgeStatus').onclick = (e) => {
    if (e.shiftKey || e.altKey) {
      const val = prompt('数据源地址（本机 bridge.py 或云端 Worker）：', Quotes.base());
      if (val) Quotes.setBase(val.trim());
    }
    checkBridge();
  };

  render();
  checkBridge();
})();
