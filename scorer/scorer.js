/**
 * 基本面打分核心（纯函数，浏览器 / Node 通用）。
 *
 * 四维加权打分（每维 0~100，按权重汇总成 0~100）：
 *   成长性  growth      —— 营收增速、净利增速
 *   盈利能力 profit      —— ROE、毛利率、净利率
 *   财务健康 health      —— 资产负债率（越低越好）
 *   估值     valuation   —— PE、PB（越低越好，亏损/负值记 0）
 *
 * 阈值为 A 股常用经验值，不同行业差异大（银行/地产高负债属正常、周期股低 PE 未必便宜），
 * 结果仅供横向初筛参考；可调权重、可手动覆盖总分。缺失的维度自动剔除并重新归一化。
 */

const DEFAULT_WEIGHTS = { growth: 30, profit: 30, health: 20, valuation: 20 };

function scoreFundamentals(m, weights) {
  m = m || {};
  const w = Object.assign({}, DEFAULT_WEIGHTS, weights || {});

  const dims = [
    { key: 'growth', label: '成长性', weight: num(w.growth), ...growth(m) },
    { key: 'profit', label: '盈利能力', weight: num(w.profit), ...profit(m) },
    { key: 'health', label: '财务健康', weight: num(w.health), ...health(m) },
    { key: 'valuation', label: '估值', weight: num(w.valuation), ...valuation(m) },
  ];

  const avail = dims.filter((d) => d.score != null && d.weight > 0);
  const wsum = avail.reduce((a, d) => a + d.weight, 0);
  const total = wsum > 0 ? round1(avail.reduce((a, d) => a + d.score * d.weight, 0) / wsum) : null;
  const missing = dims.filter((d) => d.score == null).map((d) => d.label);

  return { total, dimensions: dims, missing, grade: gradeOf(total) };
}

/* ---------------- 各维度 ---------------- */
function growth(m) {
  const gRev = has(m.revenueYoY) ? clamp(50 + n(m.revenueYoY), 0, 100) : null;
  const gPro = has(m.netProfitYoY) ? clamp(50 + n(m.netProfitYoY), 0, 100) : null;
  const score = wavg([[gRev, 0.4], [gPro, 0.6]]);
  return { score, detail: `营收增速 ${pct(m.revenueYoY)}、净利增速 ${pct(m.netProfitYoY)}` };
}
function profit(m) {
  const roeS = has(m.roe) ? clamp(n(m.roe) * 5, 0, 100) : null;       // ROE 20% → 100
  const grS = has(m.grossMargin) ? clamp(n(m.grossMargin) * 2, 0, 100) : null; // 毛利 50% → 100
  const nmS = has(m.netMargin) ? clamp(n(m.netMargin) * 4, 0, 100) : null;     // 净利率 25% → 100
  const score = wavg([[roeS, 0.5], [grS, 0.3], [nmS, 0.2]]);
  return { score, detail: `ROE ${pct(m.roe)}、毛利率 ${pct(m.grossMargin)}、净利率 ${pct(m.netMargin)}` };
}
function health(m) {
  const score = has(m.debtRatio) ? clamp(110 - n(m.debtRatio), 0, 100) : null; // 负债 10%→100,60%→50,90%→20
  return { score, detail: `资产负债率 ${pct(m.debtRatio)}` };
}
function valuation(m) {
  const peS = has(m.pe) ? (n(m.pe) <= 0 ? 0 : clamp(110 - n(m.pe) * 1.5, 0, 100)) : null; // PE10→95,40→50,73→0
  const pbS = has(m.pb) ? (n(m.pb) <= 0 ? 0 : clamp(110 - n(m.pb) * 16, 0, 100)) : null;  // PB1→94,3→62,5→30
  const score = wavg([[peS, 0.6], [pbS, 0.4]]);
  const note = (has(m.pe) && n(m.pe) <= 0) ? '（亏损，PE 记 0）' : '';
  return { score, detail: `PE ${val(m.pe)}、PB ${val(m.pb)}${note}` };
}

function gradeOf(total) {
  if (total == null) return '—';
  if (total >= 80) return '优';
  if (total >= 65) return '良';
  if (total >= 50) return '中';
  if (total >= 35) return '偏弱';
  return '弱';
}

/* ---------------- 工具 ---------------- */
function wavg(pairs) {
  const a = pairs.filter(([v]) => v != null);
  if (!a.length) return null;
  const wsum = a.reduce((s, [, w]) => s + w, 0);
  return round1(a.reduce((s, [v, w]) => s + v * w, 0) / wsum);
}
function has(v) { return v !== '' && v != null && Number.isFinite(Number(v)); }
function n(v) { return Number(v); }
function num(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function round1(x) { return Math.round(x * 10) / 10; }
function pct(v) { return has(v) ? `${Number(v)}%` : '—'; }
function val(v) { return has(v) ? `${Number(v)}` : '—'; }

const API = { scoreFundamentals, gradeOf, DEFAULT_WEIGHTS };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.Scorer = API;
