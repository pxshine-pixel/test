/* 页面交互逻辑：读取表单、调用 calculator、渲染结果 */
(function () {
  const form = document.getElementById('calc-form');
  const resultsEl = document.getElementById('results');
  const outputEl = document.getElementById('output');
  const resetBtn = document.getElementById('resetBtn');

  /* 品种费率预设（佣金/印花税/过户费均为百分比，如 0.01 表示万1）。
     tier 为大资金优惠档：达到门槛后佣金费率切换为 rate。 */
  const PRESETS = {
    stock: {
      commissionRate: 0.01, minCommission: 0, stampTax: 0.05, transferFee: 0.001,
      tier: { label: '50万以上（万0.854）', rate: 0.00854 },
      note: '沪深股票：佣金万1、不免5；50万以上万0.854。卖出收印花税0.05%，买卖双向过户费0.001%。',
    },
    etf: {
      commissionRate: 0.005, minCommission: 0, stampTax: 0, transferFee: 0,
      note: '场内基金 ETF/REITs：佣金万0.5，无印花税、无过户费。（资金量大可议至更低甚至0净佣金）',
    },
    lof: {
      commissionRate: 0.01, minCommission: 0, stampTax: 0, transferFee: 0,
      note: 'LOF 基金：不打折，按万1计；基金免印花税、无过户费。',
    },
    bondfund: {
      commissionRate: 0, minCommission: 0, stampTax: 0, transferFee: 0,
      note: '债基 / 货币基金：交易与申赎 0 手续费。',
    },
    cbsh: {
      commissionRate: 0.005, minCommission: 0, stampTax: 0, transferFee: 0,
      note: '可转债·上交所：佣金万0.5，0 元起收，无印花税、无过户费。',
    },
    cbsz: {
      commissionRate: 0.005, minCommission: 0.1, stampTax: 0, transferFee: 0,
      note: '可转债·深交所：佣金万0.5，0.1 元起收，无印花税、无过户费。',
    },
    hk: {
      commissionRate: 0.01, minCommission: 0, stampTax: 0, transferFee: 0,
      note: '港股通：佣金万1、无最低收费。注意港股印花税(0.1%双向)、交易费、结算费等本工具未计入，实际成本更高，仅供参考。',
    },
    bj: {
      commissionRate: 0.03, minCommission: 0, stampTax: 0.05, transferFee: 0.001,
      tier: { label: '500万以上（万2）', rate: 0.02 },
      note: '北交所：佣金万3、500万以上万2。卖出印花税0.05%，过户费0.001%。',
    },
    custom: { note: '自定义：可直接修改下方各项费率。' },
  };

  const productType = document.getElementById('productType');
  const largeTier = document.getElementById('largeTier');
  const tierWrap = document.getElementById('tierWrap');
  const tierLabel = document.getElementById('tierLabel');
  const presetNote = document.getElementById('presetNote');

  function setVal(id, v) { document.getElementById(id).value = v; }

  function applyPreset() {
    const p = PRESETS[productType.value];
    if (!p) return;
    if (productType.value === 'custom') {
      tierWrap.hidden = true;
      presetNote.textContent = p.note;
      return;
    }
    // 大资金档
    if (p.tier) {
      tierWrap.hidden = false;
      tierLabel.textContent = p.tier.label;
    } else {
      tierWrap.hidden = true;
      largeTier.checked = false;
    }
    const commission = p.tier && largeTier.checked ? p.tier.rate : p.commissionRate;
    setVal('commissionRate', commission);
    setVal('minCommission', p.minCommission);
    setVal('stampTax', p.stampTax);
    setVal('transferFee', p.transferFee);
    presetNote.textContent = p.note;
  }

  // 手动改动费率时切换为「自定义」，避免预设与实际值不一致
  ['commissionRate', 'minCommission', 'stampTax', 'transferFee'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      if (productType.value !== 'custom') {
        // 区分「程序填充」与「用户输入」：用户输入时切到自定义
        if (!filling) { productType.value = 'custom'; applyPreset(); }
      }
    });
  });

  let filling = false;
  function applyPresetSafe() { filling = true; applyPreset(); filling = false; }

  productType.addEventListener('change', applyPresetSafe);
  largeTier.addEventListener('change', applyPresetSafe);
  applyPresetSafe(); // 初始化为默认品种（沪深股票）

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
    applyPresetSafe(); // 重置后恢复默认品种费率
    resultsEl.hidden = true;
    outputEl.innerHTML = '';
  });
})();
