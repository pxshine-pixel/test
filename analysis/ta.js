/**
 * 技术分析核心（纯函数，浏览器 / Node 通用）。
 *
 * 输入统一为按时间升序的 K 线数组：
 *   bars = [{ date, open, high, low, close, volume }, ...]
 *
 * 提供：
 *   - 均线 sma / ema
 *   - MACD、RSI、KDJ
 *   - 密集成交区（成交量分布 volumeProfile：POC + 价值区间）
 *   - 综合「买卖阶段信号」stageSignal（规则化打分，透明可解释）
 *
 * 说明：这些都是机械的技术指标，仅用于辅助观察，不构成投资建议。
 */

function closesOf(bars) { return bars.map((b) => num(b.close)); }

/** 简单移动平均，返回与输入等长、前 period-1 个为 null 的数组 */
function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = round3(sum / period);
  }
  return out;
}

/** 指数移动平均，以首值播种，返回等长数组 */
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = round3(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = round3(prev);
  }
  return out;
}

/** MACD：dif=EMA(fast)-EMA(slow)，dea=EMA(dif,signal)，hist=(dif-dea)*2 */
function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = closes.map((_, i) => round3(emaFast[i] - emaSlow[i]));
  const dea = ema(dif, signal);
  const hist = dif.map((d, i) => round3((d - dea[i]) * 2));
  return { dif, dea, hist };
}

/** RSI（Wilder 平滑），返回等长数组，前 period 个为 null */
function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = round2(rsiFrom(avgGain, avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = round2(rsiFrom(avgGain, avgLoss));
  }
  return out;
}
function rsiFrom(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** KDJ：9 日 RSV，K/D 以 50 播种，J=3K-2D */
function kdj(bars, n = 9) {
  const len = bars.length;
  const K = new Array(len).fill(null);
  const D = new Array(len).fill(null);
  const J = new Array(len).fill(null);
  let prevK = 50, prevD = 50;
  for (let i = 0; i < len; i++) {
    if (i < n - 1) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      hh = Math.max(hh, num(bars[j].high));
      ll = Math.min(ll, num(bars[j].low));
    }
    const rsv = hh === ll ? 50 : ((num(bars[i].close) - ll) / (hh - ll)) * 100;
    const k = (2 / 3) * prevK + (1 / 3) * rsv;
    const d = (2 / 3) * prevD + (1 / 3) * k;
    K[i] = round2(k); D[i] = round2(d); J[i] = round2(3 * k - 2 * d);
    prevK = k; prevD = d;
  }
  return { k: K, d: D, j: J };
}

/**
 * 密集成交区（成交量分布 / 筹码分布近似）。
 * 把价格区间分成 bins 个价格桶，按每根 K 线的 [low, high] 区间把成交量
 * 均摊到覆盖的价格桶，统计每个价位累积成交量。
 * 返回：各价格桶、POC（成交量最大的价位）、价值区间（约70%成交量集中的价带）。
 */
function volumeProfile(bars, bins = 24, valueAreaPct = 0.7) {
  const valid = bars.filter((b) => num(b.high) > 0 && num(b.low) > 0);
  if (valid.length < 2) return { bins: [], poc: null, valueArea: null, total: 0 };
  let lo = Infinity, hi = -Infinity;
  valid.forEach((b) => { lo = Math.min(lo, num(b.low)); hi = Math.max(hi, num(b.high)); });
  if (hi <= lo) hi = lo + 1;
  const size = (hi - lo) / bins;
  const vol = new Array(bins).fill(0);

  valid.forEach((b) => {
    const bl = num(b.low), bh = num(b.high), v = num(b.volume) || 1;
    let i0 = Math.floor((bl - lo) / size);
    let i1 = Math.floor((bh - lo) / size);
    i0 = clamp(i0, 0, bins - 1); i1 = clamp(i1, 0, bins - 1);
    const span = i1 - i0 + 1;
    for (let i = i0; i <= i1; i++) vol[i] += v / span;
  });

  const total = vol.reduce((a, b) => a + b, 0);
  const binArr = vol.map((v, i) => ({
    low: round3(lo + i * size),
    high: round3(lo + (i + 1) * size),
    mid: round3(lo + (i + 0.5) * size),
    volume: round2(v),
    pct: total > 0 ? round2((v / total) * 100) : 0,
  }));

  // POC：成交量最大的价格桶
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (vol[i] > vol[pocIdx]) pocIdx = i;

  // 价值区间：从 POC 向两侧扩展，直到累计成交量达到 valueAreaPct
  let loI = pocIdx, hiI = pocIdx, acc = vol[pocIdx];
  const target = total * valueAreaPct;
  while (acc < target && (loI > 0 || hiI < bins - 1)) {
    const below = loI > 0 ? vol[loI - 1] : -1;
    const above = hiI < bins - 1 ? vol[hiI + 1] : -1;
    if (above >= below) { hiI++; acc += vol[hiI]; }
    else { loI--; acc += vol[loI]; }
  }

  return {
    bins: binArr,
    poc: binArr[pocIdx].mid,
    valueArea: { low: binArr[loI].low, high: binArr[hiI].high },
    total: round2(total),
  };
}

/** 检测两条序列在最后一个有效点的金叉(+1)/死叉(-1)/无(0) */
function crossAt(fast, slow) {
  let i = fast.length - 1;
  while (i > 0 && (fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null)) i--;
  if (i <= 0) return 0;
  const prev = fast[i - 1] - slow[i - 1];
  const cur = fast[i] - slow[i];
  if (prev <= 0 && cur > 0) return 1;
  if (prev >= 0 && cur < 0) return -1;
  return 0;
}

function lastValid(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

/**
 * 综合「买卖阶段信号」：把多项指标规则化打分（每项 -1/0/+1），
 * 汇总成分数并映射到阶段。返回每项明细，便于解释而非黑箱。
 */
function stageSignal(bars) {
  const closes = closesOf(bars);
  const price = closes[closes.length - 1];
  const sma5 = lastValid(sma(closes, 5));
  const sma20 = lastValid(sma(closes, 20));
  const sma60 = lastValid(sma(closes, 60));
  const m = macd(closes);
  const difL = lastValid(m.dif), deaL = lastValid(m.dea);
  const macdCross = crossAt(m.dif, m.dea);
  const rsiL = lastValid(rsi(closes));
  const kd = kdj(bars);
  const kL = lastValid(kd.k), dL = lastValid(kd.d), jL = lastValid(kd.j);
  const kdjCross = crossAt(kd.k, kd.d);
  const vp = volumeProfile(bars);

  const signals = [];
  const add = (name, dir, detail) => signals.push({ name, dir, detail });

  // 1) 均线排列
  if (sma5 != null && sma20 != null && sma60 != null) {
    if (sma5 > sma20 && sma20 > sma60) add('均线排列', 1, `多头排列（MA5>MA20>MA60）`);
    else if (sma5 < sma20 && sma20 < sma60) add('均线排列', -1, `空头排列（MA5<MA20<MA60）`);
    else add('均线排列', 0, '均线交织，方向不明');
  }

  // 2) MACD
  if (difL != null && deaL != null) {
    if (macdCross === 1) add('MACD', 1, '刚形成金叉');
    else if (macdCross === -1) add('MACD', -1, '刚形成死叉');
    else if (difL > deaL && difL > 0) add('MACD', 1, 'DIF 在 DEA 与零轴之上，多头');
    else if (difL < deaL && difL < 0) add('MACD', -1, 'DIF 在 DEA 与零轴之下，空头');
    else add('MACD', 0, '动能中性');
  }

  // 3) RSI 超买超卖
  if (rsiL != null) {
    if (rsiL >= 70) add('RSI', -1, `${rsiL} 超买，警惕回调`);
    else if (rsiL <= 30) add('RSI', 1, `${rsiL} 超卖，可能反弹`);
    else add('RSI', 0, `${rsiL} 中性`);
  }

  // 4) KDJ
  if (kL != null && dL != null) {
    if (kdjCross === 1 && kL < 80) add('KDJ', 1, '低位金叉');
    else if (kdjCross === -1 && kL > 20) add('KDJ', -1, '高位死叉');
    else if (jL != null && jL >= 100) add('KDJ', -1, `J=${jL} 超买`);
    else if (jL != null && jL <= 0) add('KDJ', 1, `J=${jL} 超卖`);
    else add('KDJ', 0, '中性');
  }

  // 5) 量价位置（相对密集成交区 POC）
  if (vp.poc != null && price != null) {
    if (price < vp.poc) add('量价位置', 1, `现价低于密集成交区 POC(${vp.poc})，处成本下方`);
    else if (price > vp.poc) add('量价位置', -1, `现价高于密集成交区 POC(${vp.poc})，上方获利盘多`);
    else add('量价位置', 0, '价格处于密集区');
  }

  const score = signals.reduce((a, s) => a + s.dir, 0);
  const stage = scoreToStage(score);
  return {
    score, ...stage, signals,
    indicators: { price, sma5, sma20, sma60, dif: difL, dea: deaL, rsi: rsiL, k: kL, d: dL, j: jL },
    volumeProfile: vp,
  };
}

function scoreToStage(score) {
  if (score >= 3) return { stage: '强势买入区', level: 'buy' };
  if (score >= 1) return { stage: '逢低布局', level: 'accumulate' };
  if (score <= -3) return { stage: '卖出区', level: 'sell' };
  if (score <= -1) return { stage: '逢高减仓', level: 'reduce' };
  return { stage: '震荡观望', level: 'neutral' };
}

/* ---------- 工具 ---------- */
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function round3(n) { return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000; }

const TA = {
  closesOf, sma, ema, macd, rsi, kdj, volumeProfile,
  crossAt, lastValid, stageSignal, scoreToStage,
};
if (typeof module !== 'undefined' && module.exports) module.exports = TA;
if (typeof window !== 'undefined') window.TA = TA;
