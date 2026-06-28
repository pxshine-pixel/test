/* 技术分析界面：拉取K线 → 计算指标 → 渲染形态/密集区/买卖信号 */
(function () {
  const $ = (id) => document.getElementById(id);
  let lastBars = null;

  /* ---------------- 桥接状态 ---------------- */
  async function checkBridge() {
    const dot = $('bridgeDot'), text = $('bridgeText');
    text.textContent = '检测中…'; dot.className = 'dot';
    const h = await Quotes.health();
    if (h.ok) { dot.className = 'dot ok'; text.textContent = 'OpenD 已连接'; }
    else { dot.className = 'dot err'; text.textContent = '行情未连接'; text.title = h.error || ''; }
  }

  /* ---------------- 入口 ---------------- */
  async function analyze() {
    const code = $('code').value.trim();
    if (!code) { alert('请输入股票代码'); return; }
    const btn = $('analyzeBtn');
    btn.disabled = true; btn.textContent = '拉取中…';
    const r = await Quotes.kline(code, 160);
    btn.disabled = false; btn.textContent = '分析';
    if (!r.ok || !r.klines || r.klines.length < 30) {
      alert('获取K线失败：' + (r.error || '数据不足') + '\n请确认 OpenD 已登录、bridge.py 运行中。\n（也可点「载入示例」先体验）');
      return;
    }
    render(r.klines, r.code || code);
  }

  function loadSample() {
    render(SAMPLE_BARS, '示例数据 DEMO');
  }

  /* ---------------- 渲染 ---------------- */
  function render(bars, title) {
    lastBars = bars;
    const sig = TA.stageSignal(bars);
    const ind = sig.indicators;
    $('placeholder').hidden = true;
    const el = $('result'); el.hidden = false;

    el.innerHTML = `
      <div class="banner ${sig.level}">
        <div class="banner-main">
          <span class="banner-title">${esc(title)}</span>
          <span class="banner-stage">${sig.stage}</span>
        </div>
        <div class="banner-score">综合评分 <strong>${sig.score > 0 ? '+' : ''}${sig.score}</strong>
          <span class="score-hint">(范围 −5 ~ +5)</span></div>
      </div>

      <div class="ind-grid">
        ${indCard('现价', fmt(ind.price))}
        ${indCard('MA5 / MA20 / MA60', `${fmt(ind.sma5)} / ${fmt(ind.sma20)} / ${fmt(ind.sma60)}`)}
        ${indCard('MACD (DIF/DEA)', `${fmt(ind.dif)} / ${fmt(ind.dea)}`)}
        ${indCard('RSI(14)', fmt(ind.rsi), rsiCls(ind.rsi))}
        ${indCard('KDJ (K/D/J)', `${fmt(ind.k)} / ${fmt(ind.d)} / ${fmt(ind.j)}`)}
        ${indCard('密集区 POC', fmt(sig.volumeProfile.poc))}
      </div>

      <section class="panel">
        <h3>📈 价格走势 · 均线 · 密集成交区</h3>
        <div id="priceChart"></div>
        <div class="vp-note">右侧横条为<strong>成交量分布</strong>：最长的是 <span class="poc">POC 筹码峰</span>，
          阴影带为约 70% 成交量集中的<strong>价值区间</strong>（常视作支撑/压力带）。</div>
      </section>

      <section class="panel">
        <h3>📉 MACD</h3>
        <div id="macdChart"></div>
      </section>

      <section class="panel">
        <h3>🚦 买卖阶段信号拆解</h3>
        <ul class="signal-list">
          ${sig.signals.map(sigRow).join('')}
        </ul>
        <div class="legend-stages">
          阶段：+3↑ 强势买入 ｜ +1~+2 逢低布局 ｜ 0 震荡观望 ｜ −1~−2 逢高减仓 ｜ −3↓ 卖出
        </div>
      </section>`;

    renderPriceChart(bars, sig);
    renderMacdChart(bars);
  }

  function indCard(label, val, cls) {
    return `<div class="ind"><span>${label}</span><strong class="${cls || ''}">${val}</strong></div>`;
  }
  function sigRow(s) {
    const dir = s.dir > 0 ? 'up' : s.dir < 0 ? 'down' : 'flat';
    const arrow = s.dir > 0 ? '▲ 偏多' : s.dir < 0 ? '▼ 偏空' : '— 中性';
    return `<li class="${dir}"><span class="sig-name">${esc(s.name)}</span>
      <span class="sig-dir">${arrow}</span>
      <span class="sig-detail">${esc(s.detail)}</span></li>`;
  }
  function rsiCls(v) { return v == null ? '' : v >= 70 ? 'down' : v <= 30 ? 'up' : ''; }

  /* ---------------- 价格图 + 均线 + 密集成交区 ---------------- */
  function renderPriceChart(bars, sig) {
    const W = 880, H = 340, pad = { l: 46, t: 14, b: 24, r: 12 };
    const vpW = 120;                         // 右侧成交量分布宽度
    const plotW = W - pad.l - pad.r - vpW;
    const plotH = H - pad.t - pad.b;
    const x0 = pad.l, xVP = pad.l + plotW;

    const n = bars.length;
    const highs = bars.map((b) => Number(b.high));
    const lows = bars.map((b) => Number(b.low));
    const closes = bars.map((b) => Number(b.close));
    let lo = Math.min(...lows), hi = Math.max(...highs);
    [sig.volumeProfile.valueArea, sig.volumeProfile.poc].forEach(() => {});
    const padY = (hi - lo) * 0.04 || 1; lo -= padY; hi += padY;

    const X = (i) => x0 + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
    const Y = (p) => pad.t + (1 - (p - lo) / (hi - lo || 1)) * plotH;

    // 价值区间阴影 + POC 线
    const va = sig.volumeProfile.valueArea;
    let bands = '';
    if (va) {
      bands += `<rect x="${x0}" y="${Y(va.high).toFixed(1)}" width="${plotW + vpW}" height="${(Y(va.low) - Y(va.high)).toFixed(1)}" fill="#38bdf8" opacity="0.07"/>`;
    }
    if (sig.volumeProfile.poc != null) {
      const yp = Y(sig.volumeProfile.poc);
      bands += `<line x1="${x0}" y1="${yp.toFixed(1)}" x2="${(x0 + plotW + vpW).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="5 3" opacity="0.8"/>
        <text x="${x0 + 4}" y="${(yp - 4).toFixed(1)}" class="axis" fill="#f59e0b">POC ${fmt(sig.volumeProfile.poc)}</text>`;
    }

    // 成交量分布横条
    const vp = sig.volumeProfile.bins;
    const maxPct = Math.max(...vp.map((b) => b.pct), 0.0001);
    const vaLo = va ? va.low : -Infinity, vaHi = va ? va.high : Infinity;
    const isPoc = (b) => sig.volumeProfile.poc >= b.low && sig.volumeProfile.poc <= b.high;
    const vpBars = vp.map((b) => {
      const len = (b.pct / maxPct) * vpW;
      const yTop = Y(b.high), yBot = Y(b.low);
      const h = Math.max(1, yBot - yTop - 1);
      const inVA = b.mid >= vaLo && b.mid <= vaHi;
      const color = isPoc(b) ? '#f59e0b' : inVA ? '#38bdf8' : '#475569';
      const op = isPoc(b) ? 0.95 : inVA ? 0.6 : 0.4;
      return `<rect x="${xVP.toFixed(1)}" y="${yTop.toFixed(1)}" width="${len.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="${op}"/>`;
    }).join('');

    // 价格收盘线
    const priceLine = closes.map((p, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(p).toFixed(1)}`).join(' ');

    // 均线
    const maLine = (period, color) => {
      const ma = TA.sma(closes, period);
      let d = '', started = false;
      ma.forEach((v, i) => { if (v == null) return; d += `${started ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)} `; started = true; });
      return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.9"/>` : '';
    };

    // y 轴刻度
    const ticks = [hi, (hi + lo) / 2, lo].map((v) => `
      <text x="${pad.l - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" class="axis">${fmt(v, 1)}</text>
      <line x1="${x0}" y1="${Y(v).toFixed(1)}" x2="${(x0 + plotW).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/>`).join('');

    $('priceChart').innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg">
        ${ticks}${bands}${vpBars}
        ${maLine(60, '#a78bfa')}${maLine(20, '#38bdf8')}${maLine(5, '#f59e0b')}
        <path d="${priceLine}" fill="none" stroke="#e2e8f0" stroke-width="1.6"/>
        <line x1="${xVP.toFixed(1)}" y1="${pad.t}" x2="${xVP.toFixed(1)}" y2="${(pad.t + plotH).toFixed(1)}" class="grid"/>
        <text x="${x0}" y="${H - 7}" class="axis">${esc(bars[0].date || '')}</text>
        <text x="${(x0 + plotW).toFixed(1)}" y="${H - 7}" text-anchor="end" class="axis">${esc(bars[n - 1].date || '')}</text>
        <g class="ma-legend">
          <text x="${x0 + 40}" y="${pad.t + 10}" fill="#f59e0b" class="axis">MA5</text>
          <text x="${x0 + 75}" y="${pad.t + 10}" fill="#38bdf8" class="axis">MA20</text>
          <text x="${x0 + 115}" y="${pad.t + 10}" fill="#a78bfa" class="axis">MA60</text>
        </g>
      </svg>`;
  }

  /* ---------------- MACD ---------------- */
  function renderMacdChart(bars) {
    const closes = bars.map((b) => Number(b.close));
    const m = TA.macd(closes);
    const n = bars.length;
    const W = 880, H = 150, pad = { l: 46, t: 10, b: 18, r: 12 + 120 };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const x0 = pad.l;
    const vals = [].concat(m.dif, m.dea, m.hist).filter((v) => v != null);
    const mx = Math.max(...vals, 0.001), mn = Math.min(...vals, -0.001);
    const X = (i) => x0 + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
    const Y = (v) => pad.t + (1 - (v - mn) / (mx - mn || 1)) * plotH;
    const zeroY = Y(0);

    const bw = Math.max(1, plotW / n - 1);
    const hist = m.hist.map((v, i) => {
      if (v == null) return '';
      const y = Y(v);
      const top = Math.min(y, zeroY), h = Math.abs(y - zeroY);
      return `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${v >= 0 ? '#22c55e' : '#ef4444'}" opacity="0.7"/>`;
    }).join('');
    const lineOf = (arr, color) => {
      let d = '', started = false;
      arr.forEach((v, i) => { if (v == null) return; d += `${started ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)} `; started = true; });
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2"/>`;
    };

    $('macdChart').innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg">
        <line x1="${x0}" y1="${zeroY.toFixed(1)}" x2="${(x0 + plotW).toFixed(1)}" y2="${zeroY.toFixed(1)}" class="grid"/>
        ${hist}${lineOf(m.dif, '#e2e8f0')}${lineOf(m.dea, '#f59e0b')}
        <text x="${x0 + 40}" y="${pad.t + 9}" fill="#e2e8f0" class="axis">DIF</text>
        <text x="${x0 + 72}" y="${pad.t + 9}" fill="#f59e0b" class="axis">DEA</text>
      </svg>`;
  }

  /* ---------------- 工具 ---------------- */
  function fmt(n, d) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 事件 ---------------- */
  $('analyzeBtn').onclick = analyze;
  $('sampleBtn').onclick = loadSample;
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });
  $('bridgeStatus').onclick = checkBridge;

  checkBridge();
})();
