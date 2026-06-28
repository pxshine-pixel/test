/**
 * 投资组合核心计算（纯函数，浏览器 / Node 通用）。
 *
 * 一只持仓 holding：{ name, code, shares, buyPrice, currentPrice }
 *   - shares       持股数量
 *   - buyPrice     买入均价（每股成本）
 *   - currentPrice 当前价格
 */

/** 计算单只持仓的成本、市值与盈亏 */
function holdingMetrics(h) {
  const shares = num(h.shares);
  const buyPrice = num(h.buyPrice);
  const currentPrice = num(h.currentPrice);

  const cost = round2(buyPrice * shares);
  const marketValue = round2(currentPrice * shares);
  const profit = round2(marketValue - cost);
  const returnRate = cost > 0 ? round2((profit / cost) * 100) : 0;

  return { ...h, cost, marketValue, profit, returnRate };
}

/**
 * 汇总整个组合：总成本、总市值、总盈亏、总收益率，
 * 以及每只持仓按市值占比（资产配置）。
 */
function summarize(holdings) {
  const rows = holdings.map(holdingMetrics);

  const totalCost = round2(sum(rows.map((r) => r.cost)));
  const totalMarketValue = round2(sum(rows.map((r) => r.marketValue)));
  const totalProfit = round2(totalMarketValue - totalCost);
  const totalReturnRate = totalCost > 0 ? round2((totalProfit / totalCost) * 100) : 0;

  const allocation = rows.map((r) => ({
    name: r.name || r.code || '未命名',
    marketValue: r.marketValue,
    weight: totalMarketValue > 0 ? round2((r.marketValue / totalMarketValue) * 100) : 0,
  }));

  return {
    rows,
    totalCost,
    totalMarketValue,
    totalProfit,
    totalReturnRate,
    allocation,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { holdingMetrics, summarize, round2 };
}
