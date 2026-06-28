/**
 * 个股长期跟踪 - 核心计算（纯函数，浏览器 / Node 通用）。
 *
 * 数据模型：
 *   stock = {
 *     id, name, code, market: 'sh'|'sz',
 *     thesis,                       // 投资逻辑/笔记
 *     targetBuy, targetSell,        // 目标买入价 / 目标卖出价
 *     snapshots: [
 *       { date:'YYYY-MM-DD', price, pe, pb, dividend, note }
 *     ]
 *   }
 *
 * “长期跟踪”的核心是时间维度：对每只股票按时间记录价格/估值快照，
 * 从而计算累计涨跌、年化收益（CAGR），并对照目标价给出操作区间。
 */

/** 按日期升序排序快照（不改变原数组） */
function sortByDate(snapshots) {
  return [...(snapshots || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function firstSnapshot(stock) {
  const s = sortByDate(stock.snapshots);
  return s.length ? s[0] : null;
}

function latestSnapshot(stock) {
  const s = sortByDate(stock.snapshots);
  return s.length ? s[s.length - 1] : null;
}

/** 相对最早一笔快照的累计涨跌幅(%) */
function totalReturnPct(stock) {
  const first = firstSnapshot(stock);
  const last = latestSnapshot(stock);
  if (!first || !last || !(first.price > 0)) return null;
  return round2(((num(last.price) - num(first.price)) / num(first.price)) * 100);
}

/** 相对上一笔快照的涨跌幅(%) */
function changeFromPrevious(stock) {
  const s = sortByDate(stock.snapshots);
  if (s.length < 2) return null;
  const prev = s[s.length - 2];
  const last = s[s.length - 1];
  if (!(prev.price > 0)) return null;
  return round2(((num(last.price) - num(prev.price)) / num(prev.price)) * 100);
}

/** 两个日期字符串相差的年数（按 365.25 天计） */
function yearsBetween(d1, d2) {
  const t1 = Date.parse(d1);
  const t2 = Date.parse(d2);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return (t2 - t1) / (365.25 * 24 * 3600 * 1000);
}

/**
 * 年化收益率 CAGR(%)。跨度过短（<约1个月）或数据不足时返回 null。
 * CAGR = (末值/初值)^(1/年数) - 1
 */
function annualizedReturn(stock) {
  const first = firstSnapshot(stock);
  const last = latestSnapshot(stock);
  if (!first || !last || !(first.price > 0) || !(last.price > 0)) return null;
  const years = yearsBetween(first.date, last.date);
  if (years == null || years < 1 / 12) return null;
  const cagr = Math.pow(num(last.price) / num(first.price), 1 / years) - 1;
  return round2(cagr * 100);
}

/** 价格区间统计：最高、最低、当前、快照数 */
function priceStats(stock) {
  const s = sortByDate(stock.snapshots);
  if (!s.length) return { min: null, max: null, latest: null, count: 0 };
  const prices = s.map((x) => num(x.price)).filter((p) => p > 0);
  return {
    min: prices.length ? round2(Math.min(...prices)) : null,
    max: prices.length ? round2(Math.max(...prices)) : null,
    latest: round2(num(s[s.length - 1].price)),
    count: s.length,
  };
}

/**
 * 根据当前价与目标价判断操作区间。
 *   price <= targetBuy  → 买入区 (buy)
 *   price >= targetSell → 卖出区 (sell)
 *   其余                → 持有/观察 (hold)
 * 目标价缺失时返回 watch（仅观察，不给信号）。
 */
function evaluateStatus(price, targetBuy, targetSell) {
  const p = num(price);
  const tb = numOrNull(targetBuy);
  const ts = numOrNull(targetSell);
  if (!(p > 0)) return { level: 'watch', label: '观察' };
  if (tb != null && p <= tb) return { level: 'buy', label: '买入区' };
  if (ts != null && p >= ts) return { level: 'sell', label: '卖出区' };
  if (tb == null && ts == null) return { level: 'watch', label: '观察' };
  return { level: 'hold', label: '持有' };
}

/** 距离目标买入价还需下跌多少(%)，已在买入区返回 0 */
function distanceToBuy(price, targetBuy) {
  const p = num(price);
  const tb = numOrNull(targetBuy);
  if (tb == null || !(p > 0)) return null;
  if (p <= tb) return 0;
  return round2(((p - tb) / p) * 100);
}

/* ---------- 工具 ---------- */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const TrackerAPI = {
  sortByDate, firstSnapshot, latestSnapshot, totalReturnPct,
  changeFromPrevious, yearsBetween, annualizedReturn, priceStats,
  evaluateStatus, distanceToBuy,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackerAPI;          // Node / 测试
}
if (typeof window !== 'undefined') {
  window.Tracker = TrackerAPI;          // 浏览器全局
}
