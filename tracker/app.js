/* 个股长期跟踪系统 - 界面逻辑：自选列表 / 详情 / 快照 / 实时拉价 / SVG曲线 / 本地存储 */
(function () {
  const KEY = 'tracker.stocks.v1';
  const SEL_KEY = 'tracker.selected.v1';

  let stocks = load();
  let selectedId = loadSel();

  /* ---------------- 持久化 ---------------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(stocks)); } catch (e) { /* ignore */ }
  }
  function loadSel() { try { return localStorage.getItem(SEL_KEY) || null; } catch (e) { return null; } }
  function saveSel() { try { localStorage.setItem(SEL_KEY, selectedId || ''); } catch (e) { /* ignore */ } }

  function uid() {
    return 's' + Math.abs(hash(JSON.stringify(stocks) + ':' + stocks.length + ':' + (stocks.length ? stocks[stocks.length - 1].code : '') + Object.keys(localStorage).length)).toString(36) + stocks.length;
  }
  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return h;
  }

  function today() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  /* ---------------- 工具 ---------------- */
  function getSelected() { return stocks.find((s) => s.id === selectedId) || null; }
  function fmt(n, d) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function signClass(n) { return n > 0 ? 'up' : n < 0 ? 'down' : ''; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 桥接状态 ---------------- */
  async function checkBridge() {
    const dot = document.getElementById('bridgeDot');
    const text = document.getElementById('bridgeText');
    text.textContent = '检测中…';
    dot.className = 'dot';
    const h = await Quotes.health();
    if (h.ok) {
      dot.className = 'dot ok';
      text.textContent = 'OpenD 已连接';
    } else {
      dot.className = 'dot err';
      text.textContent = '行情未连接';
      text.title = h.error || '';
    }
  }

  /* ---------------- 自选列表 ---------------- */
  function renderWatchlist() {
    const ul = document.getElementById('watchlist');
    ul.innerHTML = '';
    if (!stocks.length) {
      ul.innerHTML = '<li class="empty">还没有自选股</li>';
      return;
    }
    stocks.forEach((s) => {
      const last = Tracker.latestSnapshot(s);
      const price = last ? last.price : null;
      const ret = Tracker.totalReturnPct(s);
      const st = Tracker.evaluateStatus(price, s.targetBuy, s.targetSell);
      const li = document.createElement('li');
      li.className = 'wl-item' + (s.id === selectedId ? ' active' : '');
      li.dataset.id = s.id;
      li.innerHTML = `
        <div class="wl-main">
          <span class="wl-name">${esc(s.name || s.code)}</span>
          <span class="badge ${st.level}">${st.label}</span>
        </div>
        <div class="wl-sub">
          <span class="wl-code">${esc(s.code)}</span>
          <span class="wl-price">${price == null ? '—' : '¥' + fmt(price)}</span>
          <span class="wl-ret ${signClass(ret)}">${ret == null ? '' : (ret >= 0 ? '+' : '') + fmt(ret) + '%'}</span>
        </div>`;
      ul.appendChild(li);
    });
  }

  /* ---------------- 详情 ---------------- */
  function renderDetail() {
    const ph = document.getElementById('placeholder');
    const body = document.getElementById('detailBody');
    const s = getSelected();
    if (!s) { ph.hidden = false; body.hidden = true; return; }
    ph.hidden = true; body.hidden = false;

    const last = Tracker.latestSnapshot(s);
    const price = last ? last.price : null;
    const st = Tracker.evaluateStatus(price, s.targetBuy, s.targetSell);
    const ret = Tracker.totalReturnPct(s);
    const cagr = Tracker.annualizedReturn(s);
    const stats = Tracker.priceStats(s);
    const dist = Tracker.distanceToBuy(price, s.targetBuy);

    body.innerHTML = `
      <div class="d-head">
        <div>
          <h2>${esc(s.name || s.code)} <span class="d-code">${esc(s.code)}</span></h2>
          <div class="d-price">
            <span class="big">${price == null ? '—' : '¥' + fmt(price)}</span>
            <span class="badge ${st.level}">${st.label}</span>
            <button class="btn primary" id="pullBtn">⤓ 拉取实时价</button>
          </div>
        </div>
        <button class="link danger" id="delStockBtn">删除该股</button>
      </div>

      <div class="stat-grid">
        <div class="stat"><span>累计收益</span><strong class="${signClass(ret)}">${ret == null ? '—' : (ret >= 0 ? '+' : '') + fmt(ret) + '%'}</strong></div>
        <div class="stat"><span>年化(CAGR)</span><strong class="${signClass(cagr)}">${cagr == null ? '—' : (cagr >= 0 ? '+' : '') + fmt(cagr) + '%'}</strong></div>
        <div class="stat"><span>区间最高/最低</span><strong>${stats.max == null ? '—' : fmt(stats.max) + ' / ' + fmt(stats.min)}</strong></div>
        <div class="stat"><span>距买入价</span><strong>${dist == null ? '—' : (dist === 0 ? '已到位' : '需跌 ' + fmt(dist) + '%')}</strong></div>
      </div>

      <div class="targets">
        <label>目标买入价 <input type="number" step="0.001" id="tBuy" value="${s.targetBuy == null ? '' : s.targetBuy}" /></label>
        <label>目标卖出价 <input type="number" step="0.001" id="tSell" value="${s.targetSell == null ? '' : s.targetSell}" /></label>
      </div>

      <section class="panel">
        <h3>📈 价格走势</h3>
        <div id="chart"></div>
      </section>

      <section class="panel">
        <h3>📝 投资逻辑</h3>
        <textarea id="thesis" rows="3" placeholder="为什么买/卖？核心逻辑、估值依据、跟踪要点…">${esc(s.thesis || '')}</textarea>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h3>📅 历史快照</h3>
          <div>
            <button class="btn" id="backfillBtn" title="用 OpenD 历史K线回填日线收盘价">⤓ 回填历史</button>
            <button class="btn" id="addSnapBtn">＋ 记一笔</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="snap-table">
            <thead><tr><th>日期</th><th>价格</th><th>PE</th><th>PB</th><th>股息%</th><th>备注</th><th></th></tr></thead>
            <tbody id="snapRows"></tbody>
          </table>
        </div>
      </section>`;

    renderSnapRows(s);
    renderChart(s);
    bindDetailEvents(s);
  }

  function renderSnapRows(s) {
    const tbody = document.getElementById('snapRows');
    const rows = Tracker.sortByDate(s.snapshots).reverse(); // 最新在上
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">还没有快照，点「记一笔」或「拉取实时价」</td></tr>';
      return;
    }
    rows.forEach((snap) => {
      const realIdx = s.snapshots.indexOf(snap);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input data-i="${realIdx}" data-k="date" type="date" value="${esc(snap.date || '')}" /></td>
        <td><input data-i="${realIdx}" data-k="price" type="number" step="0.001" value="${valNum(snap.price)}" /></td>
        <td><input data-i="${realIdx}" data-k="pe" type="number" step="0.01" value="${valNum(snap.pe)}" /></td>
        <td><input data-i="${realIdx}" data-k="pb" type="number" step="0.01" value="${valNum(snap.pb)}" /></td>
        <td><input data-i="${realIdx}" data-k="dividend" type="number" step="0.01" value="${valNum(snap.dividend)}" /></td>
        <td><input data-i="${realIdx}" data-k="note" value="${esc(snap.note || '')}" placeholder="—" /></td>
        <td><button class="del" data-del="${realIdx}">✕</button></td>`;
      tbody.appendChild(tr);
    });
  }
  function valNum(v) { return v === '' || v == null ? '' : Number(v); }

  /* ---------------- SVG 折线图 ---------------- */
  function renderChart(s) {
    const el = document.getElementById('chart');
    const data = Tracker.sortByDate(s.snapshots).filter((x) => Number(x.price) > 0);
    if (data.length < 2) {
      el.innerHTML = '<p class="empty">至少需要 2 条快照才能绘制走势</p>';
      return;
    }
    const W = 720, H = 240, pad = { l: 48, r: 16, t: 16, b: 28 };
    const xs = data.map((d) => Date.parse(d.date));
    const prices = data.map((d) => Number(d.price));
    const extra = [s.targetBuy, s.targetSell].map(Number).filter((n) => n > 0);
    const minY = Math.min(...prices, ...extra);
    const maxY = Math.max(...prices, ...extra);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const padY = (maxY - minY) * 0.1 || maxY * 0.1 || 1;
    const lo = minY - padY, hi = maxY + padY;

    const sx = (x) => pad.l + ((x - minX) / (maxX - minX || 1)) * (W - pad.l - pad.r);
    const sy = (y) => pad.t + (1 - (y - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);

    const line = prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(xs[i]).toFixed(1)} ${sy(p).toFixed(1)}`).join(' ');
    const area = `${line} L ${sx(maxX).toFixed(1)} ${sy(lo).toFixed(1)} L ${sx(minX).toFixed(1)} ${sy(lo).toFixed(1)} Z`;

    const up = prices[prices.length - 1] >= prices[0];
    const stroke = up ? '#22c55e' : '#ef4444';

    let targets = '';
    if (s.targetBuy > 0) targets += dashLine(sy(Number(s.targetBuy)), '#22c55e', '买 ' + fmt(s.targetBuy), pad.l, W - pad.r);
    if (s.targetSell > 0) targets += dashLine(sy(Number(s.targetSell)), '#ef4444', '卖 ' + fmt(s.targetSell), pad.l, W - pad.r);

    const dots = prices.map((p, i) => `<circle cx="${sx(xs[i]).toFixed(1)}" cy="${sy(p).toFixed(1)}" r="2.5" fill="${stroke}"><title>${data[i].date}: ¥${fmt(p)}</title></circle>`).join('');

    // y 轴刻度
    const ticks = [hi, (hi + lo) / 2, lo].map((v) => `
      <text x="${pad.l - 6}" y="${sy(v) + 3}" text-anchor="end" class="axis">${fmt(v, 0)}</text>
      <line x1="${pad.l}" y1="${sy(v)}" x2="${W - pad.r}" y2="${sy(v)}" class="grid"/>`).join('');

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">
        ${ticks}
        <path d="${area}" fill="${stroke}" opacity="0.08"/>
        <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2"/>
        ${targets}
        ${dots}
        <text x="${pad.l}" y="${H - 8}" class="axis">${data[0].date}</text>
        <text x="${W - pad.r}" y="${H - 8}" text-anchor="end" class="axis">${data[data.length - 1].date}</text>
      </svg>`;
  }
  function dashLine(y, color, label, x1, x2) {
    return `<line x1="${x1}" y1="${y.toFixed(1)}" x2="${x2}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="4 3" opacity="0.7"/>
      <text x="${x2 - 2}" y="${(y - 3).toFixed(1)}" text-anchor="end" class="axis" fill="${color}">${esc(label)}</text>`;
  }

  /* ---------------- 详情内事件 ---------------- */
  function bindDetailEvents(s) {
    document.getElementById('delStockBtn').onclick = () => {
      if (!confirm(`删除「${s.name || s.code}」及其所有快照？`)) return;
      stocks = stocks.filter((x) => x.id !== s.id);
      selectedId = stocks.length ? stocks[0].id : null;
      save(); saveSel(); renderAll();
    };

    document.getElementById('tBuy').onchange = (e) => { s.targetBuy = e.target.value === '' ? null : Number(e.target.value); save(); renderDetail(); renderWatchlist(); };
    document.getElementById('tSell').onchange = (e) => { s.targetSell = e.target.value === '' ? null : Number(e.target.value); save(); renderDetail(); renderWatchlist(); };
    document.getElementById('thesis').onchange = (e) => { s.thesis = e.target.value; save(); };

    document.getElementById('addSnapBtn').onclick = () => {
      s.snapshots = s.snapshots || [];
      if (!s.snapshots.some((x) => x.date === today())) {
        s.snapshots.push({ date: today(), price: '', pe: '', pb: '', dividend: '', note: '' });
      }
      save(); renderDetail();
    };

    document.getElementById('pullBtn').onclick = () => pullQuote(s);
    document.getElementById('backfillBtn').onclick = () => backfill(s);

    const tbody = document.getElementById('snapRows');
    tbody.oninput = (e) => {
      const i = e.target.dataset.i;
      if (i == null) return;
      const k = e.target.dataset.k;
      s.snapshots[Number(i)][k] = e.target.value;
      save();
      // 价格/日期变化才需要重画图与统计
      if (k === 'price' || k === 'date') { renderChart(s); refreshStats(s); renderWatchlist(); }
    };
    tbody.onclick = (e) => {
      const d = e.target.dataset.del;
      if (d == null) return;
      s.snapshots.splice(Number(d), 1);
      save(); renderDetail(); renderWatchlist();
    };
  }

  // 局部刷新统计区，避免输入时重建整页
  function refreshStats(s) {
    const last = Tracker.latestSnapshot(s);
    const price = last ? last.price : null;
    const st = Tracker.evaluateStatus(price, s.targetBuy, s.targetSell);
    const grid = document.querySelector('.stat-grid');
    if (!grid) return;
    const ret = Tracker.totalReturnPct(s);
    const cagr = Tracker.annualizedReturn(s);
    const stats = Tracker.priceStats(s);
    const dist = Tracker.distanceToBuy(price, s.targetBuy);
    grid.children[0].querySelector('strong').textContent = ret == null ? '—' : (ret >= 0 ? '+' : '') + fmt(ret) + '%';
    grid.children[0].querySelector('strong').className = signClass(ret);
    grid.children[1].querySelector('strong').textContent = cagr == null ? '—' : (cagr >= 0 ? '+' : '') + fmt(cagr) + '%';
    grid.children[1].querySelector('strong').className = signClass(cagr);
    grid.children[2].querySelector('strong').textContent = stats.max == null ? '—' : fmt(stats.max) + ' / ' + fmt(stats.min);
    grid.children[3].querySelector('strong').textContent = dist == null ? '—' : (dist === 0 ? '已到位' : '需跌 ' + fmt(dist) + '%');
    const big = document.querySelector('.d-price .big');
    if (big) big.textContent = price == null ? '—' : '¥' + fmt(price);
    const badge = document.querySelector('.d-price .badge');
    if (badge) { badge.className = 'badge ' + st.level; badge.textContent = st.label; }
  }

  /* ---------------- 实时拉价 / 回填 ---------------- */
  async function pullQuote(s) {
    const btn = document.getElementById('pullBtn');
    btn.disabled = true; btn.textContent = '拉取中…';
    const r = await Quotes.quote(s.code);
    btn.disabled = false; btn.textContent = '⤓ 拉取实时价';
    if (!r.ok || !r.quotes || !r.quotes.length) {
      alert('拉取失败：' + (r.error || '无数据') + '\n请确认 OpenD 已登录、bridge.py 正在运行。');
      return;
    }
    const q = r.quotes[0];
    if (q.name && !s.name) s.name = q.name;
    s.snapshots = s.snapshots || [];
    let snap = s.snapshots.find((x) => x.date === today());
    if (!snap) { snap = { date: today(), price: '', pe: '', pb: '', dividend: '', note: '实时' }; s.snapshots.push(snap); }
    if (q.price != null) snap.price = q.price;
    if (q.peTtm != null || q.pe != null) snap.pe = q.peTtm != null ? q.peTtm : q.pe;
    if (q.pb != null) snap.pb = q.pb;
    if (q.dividend != null) snap.dividend = q.dividend;
    save(); renderDetail(); renderWatchlist();
  }

  async function backfill(s) {
    const btn = document.getElementById('backfillBtn');
    btn.disabled = true; btn.textContent = '回填中…';
    const r = await Quotes.kline(s.code, 120);
    btn.disabled = false; btn.textContent = '⤓ 回填历史';
    if (!r.ok || !r.klines || !r.klines.length) {
      alert('回填失败：' + (r.error || '无数据'));
      return;
    }
    s.snapshots = s.snapshots || [];
    const have = new Set(s.snapshots.map((x) => x.date));
    let added = 0;
    r.klines.forEach((k) => {
      if (k.date && k.close != null && !have.has(k.date)) {
        s.snapshots.push({ date: k.date, price: k.close, pe: '', pb: '', dividend: '', note: 'K线' });
        have.add(k.date); added++;
      }
    });
    save(); renderDetail(); renderWatchlist();
    alert(`已回填 ${added} 条历史日线收盘价。`);
  }

  /* ---------------- 列表/全局事件 ---------------- */
  document.getElementById('watchlist').onclick = (e) => {
    const li = e.target.closest('.wl-item');
    if (!li) return;
    selectedId = li.dataset.id; saveSel();
    renderWatchlist(); renderDetail();
  };

  document.getElementById('addStockBtn').onclick = () => {
    const code = document.getElementById('newCode').value.trim();
    const name = document.getElementById('newName').value.trim();
    if (!code) { alert('请输入股票代码'); return; }
    if (stocks.some((x) => x.code.toLowerCase() === code.toLowerCase())) { alert('该代码已在自选列表'); return; }
    const s = { id: uid(), code, name, thesis: '', targetBuy: null, targetSell: null, snapshots: [] };
    stocks.push(s); selectedId = s.id;
    document.getElementById('newCode').value = ''; document.getElementById('newName').value = '';
    save(); saveSel(); renderAll();
  };
  document.getElementById('newCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('addStockBtn').click(); });

  document.getElementById('refreshAllBtn').onclick = async () => {
    if (!stocks.length) return;
    const codes = stocks.map((s) => s.code);
    const r = await Quotes.quote(codes);
    if (!r.ok) { alert('刷新失败：' + (r.error || '')); return; }
    const byCode = {};
    (r.quotes || []).forEach((q) => { byCode[(q.code || '').toUpperCase()] = q; byCode[(q.code || '').split('.').pop()] = q; });
    let n = 0;
    stocks.forEach((s) => {
      const q = byCode[s.code.toUpperCase()] || byCode[s.code.replace(/^(sh|sz|hk|us)\.?/i, '').toUpperCase()];
      if (q && q.price != null) {
        s.snapshots = s.snapshots || [];
        let snap = s.snapshots.find((x) => x.date === today());
        if (!snap) { snap = { date: today(), price: '', note: '实时' }; s.snapshots.push(snap); }
        snap.price = q.price;
        if (q.peTtm != null) snap.pe = q.peTtm;
        if (q.pb != null) snap.pb = q.pb;
        n++;
      }
    });
    save(); renderAll();
    alert(`已更新 ${n} 只股票的最新价。`);
  };

  document.getElementById('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(stocks, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stock-tracker-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('格式不对');
        stocks = data; selectedId = stocks.length ? stocks[0].id : null;
        save(); saveSel(); renderAll();
        alert(`已导入 ${stocks.length} 只股票。`);
      } catch (err) { alert('导入失败：' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  document.getElementById('bridgeCfg').onclick = () => {
    const cur = Quotes.base();
    const val = prompt('桥接服务地址（bridge.py 监听的地址）：', cur);
    if (val) { Quotes.setBase(val.trim()); checkBridge(); }
  };
  document.getElementById('bridgeStatus').onclick = (e) => { if (e.target.id !== 'bridgeCfg') checkBridge(); };

  /* ---------------- 主渲染 ---------------- */
  function renderAll() { renderWatchlist(); renderDetail(); }

  if (selectedId && !getSelected()) selectedId = stocks.length ? stocks[0].id : null;
  renderAll();
  checkBridge();
})();
