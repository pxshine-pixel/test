/**
 * 股价计算器核心逻辑（纯函数，便于测试）
 *
 * 费率以小数百分比表示，例如佣金 0.025 表示 0.025%。
 * A 股惯例：买入收取佣金 + 过户费；卖出额外收取印花税。
 */

/** 将百分比（如 0.025 表示 0.025%）转换为小数系数 */
function pct(value) {
  return (Number(value) || 0) / 100;
}

/**
 * 计算一笔买入的费用。
 * @returns {{commission:number, transferFee:number, total:number}}
 */
function buyFees(amount, fees) {
  const commission = Math.max(amount * pct(fees.commissionRate), Number(fees.minCommission) || 0);
  const transferFee = amount * pct(fees.transferFee);
  return {
    commission: round2(commission),
    transferFee: round2(transferFee),
    total: round2(commission + transferFee),
  };
}

/**
 * 计算一笔卖出的费用（含印花税）。
 * @returns {{commission:number, transferFee:number, stampTax:number, total:number}}
 */
function sellFees(amount, fees) {
  const commission = Math.max(amount * pct(fees.commissionRate), Number(fees.minCommission) || 0);
  const transferFee = amount * pct(fees.transferFee);
  const stampTax = amount * pct(fees.stampTax);
  return {
    commission: round2(commission),
    transferFee: round2(transferFee),
    stampTax: round2(stampTax),
    total: round2(commission + transferFee + stampTax),
  };
}

/**
 * 综合计算买入成本、卖出净收入与盈亏。
 * @param {object} input - { buyPrice, shares, sellPrice, fees }
 */
function calculate(input) {
  const { buyPrice, shares, sellPrice, fees } = input;

  const buyAmount = buyPrice * shares;
  const bFees = buyFees(buyAmount, fees);
  const totalCost = round2(buyAmount + bFees.total);
  const costPerShare = shares > 0 ? round4(totalCost / shares) : 0;

  const result = {
    buyAmount: round2(buyAmount),
    buyFees: bFees,
    totalCost,
    costPerShare,
  };

  if (sellPrice != null && sellPrice !== '' && !Number.isNaN(Number(sellPrice))) {
    const sellAmount = sellPrice * shares;
    const sFees = sellFees(sellAmount, fees);
    const netProceeds = round2(sellAmount - sFees.total);
    const profit = round2(netProceeds - totalCost);
    const returnRate = totalCost > 0 ? round4((profit / totalCost) * 100) : 0;

    result.sellAmount = round2(sellAmount);
    result.sellFees = sFees;
    result.netProceeds = netProceeds;
    result.profit = profit;
    result.returnRate = returnRate;
  }

  // 保本价：卖出净收入恰好等于总成本时的卖出价
  result.breakEvenPrice = shares > 0 ? breakEvenPrice(totalCost, shares, fees) : 0;

  return result;
}

/**
 * 求保本卖出价：使 netProceeds == totalCost。
 *
 * 由于最低佣金的存在，netProceeds 关于卖出价是分段线性的，闭式解会在
 * 小额交易时产生偏差。这里直接对真实费用函数做二分求解（netProceeds
 * 关于价格单调递增），保证在所有费率区间下都准确。
 */
function breakEvenPrice(totalCost, shares, fees) {
  if (shares <= 0) return 0;
  const netAt = (price) => {
    const amount = price * shares;
    return amount - sellFees(amount, fees).total;
  };
  let lo = 0;
  let hi = (totalCost / shares) * 2 + 1; // 上界足够覆盖费用
  while (netAt(hi) < totalCost) hi *= 2;  // 极端费率下扩大上界
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (netAt(mid) < totalCost) lo = mid;
    else hi = mid;
  }
  return round4((lo + hi) / 2);
}

/**
 * 根据目标收益率反推目标卖出价。
 * 目标：profit / totalCost == targetReturn
 * => netProceeds = totalCost * (1 + targetReturn)
 * => price*shares*(1 - feeRate) = totalCost*(1 + targetReturn)
 */
function targetSellPrice(totalCost, shares, fees, targetReturnPct) {
  const feeRate = pct(fees.commissionRate) + pct(fees.transferFee) + pct(fees.stampTax);
  const target = totalCost * (1 + (Number(targetReturnPct) || 0) / 100);
  const denom = shares * (1 - feeRate);
  return denom > 0 ? round4(target / denom) : 0;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

// 同时支持浏览器与 Node（测试）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pct, buyFees, sellFees, calculate, breakEvenPrice, targetSellPrice, round2, round4,
  };
}
