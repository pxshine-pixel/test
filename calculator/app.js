/* 页面交互逻辑：读取表单、调用 calculator、渲染结果 */
(function () {
  const form = document.getElementById('calc-form');
  const resultsEl = document.getElementById('results');
  const outputEl = document.getElementById('output');
  const resetBtn = document.getElementById('resetBtn');

  function num(id) {
    return parseFloat(document.getElementById(id).value);
  }

  function readFees() {
    return {
      commissionRate: num('commissionRate'),
      minCommission: num('minCommission'),
      stampTax: num('stampTax'),
      transferFee: num('transferFee'),
    };
  }

  function fmt(n) {
    return Number(n).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }

  function row(label, value, cls) {
    return `<div class="result-row ${cls || ''}"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function render(buyPrice, shares, sellPriceRaw, targetReturn) {
    const fees = readFees();
    const res = calculate({ buyPrice, shares, sellPrice: sellPriceRaw, fees });

    let html = '';
    html += '<h3>买入</h3>';
    html += row('买入金额', `¥${fmt(res.buyAmount)}`);
    html += row('买入费用（佣金+过户费）', `¥${fmt(res.buyFees.total)}`);
    html += row('总成本', `¥${fmt(res.totalCost)}`, 'highlight');
    html += row('每股成本', `¥${fmt(res.costPerShare)}`, 'highlight');
    html += row('保本价', `¥${fmt(res.breakEvenPrice)}`);

    if (res.profit != null) {
      const sign = res.profit >= 0 ? 'profit' : 'loss';
      html += '<h3>卖出 / 盈亏</h3>';
      html += row('卖出金额', `¥${fmt(res.sellAmount)}`);
      html += row('卖出费用（含印花税）', `¥${fmt(res.sellFees.total)}`);
      html += row('卖出净收入', `¥${fmt(res.netProceeds)}`);
      html += row('盈亏', `${res.profit >= 0 ? '+' : ''}¥${fmt(res.profit)}`, sign);
      html += row('收益率', `${res.returnRate >= 0 ? '+' : ''}${fmt(res.returnRate)}%`, sign);
    }

    if (!Number.isNaN(targetReturn) && shares > 0) {
      const tp = targetSellPrice(res.totalCost, shares, fees, targetReturn);
      html += '<h3>目标价</h3>';
      html += row(`达到 ${fmt(targetReturn)}% 收益需卖出价`, `¥${fmt(tp)}`, 'highlight');
    }

    outputEl.innerHTML = html;
    resultsEl.hidden = false;
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const buyPrice = num('buyPrice');
    const shares = num('shares');
    const sellPriceRaw = document.getElementById('sellPrice').value;
    const targetReturn = num('targetReturn');

    if (Number.isNaN(buyPrice) || Number.isNaN(shares) || buyPrice <= 0 || shares <= 0) {
      outputEl.innerHTML = '<p class="error">请填写有效的买入价格和买入数量。</p>';
      resultsEl.hidden = false;
      return;
    }

    render(buyPrice, shares, sellPriceRaw, targetReturn);
  });

  resetBtn.addEventListener('click', function () {
    form.reset();
    resultsEl.hidden = true;
    outputEl.innerHTML = '';
  });
})();
