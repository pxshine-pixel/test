/**
 * 免费行情 / 财报数据 Worker（Cloudflare Workers）。
 *
 * 在 Cloudflare 边缘服务器端代理东方财富的公开接口，输出带 CORS 的 JSON，
 * 供部署在公网（HTTPS）的静态站点直接调用——无 CORS、无混合内容、不依赖本机 OpenD。
 *
 * 接口（返回结构尽量与本地 bridge.py 一致，便于前端无痛切换）：
 *   GET /health
 *   GET /quote?code=600519,000001            实时行情（现价/涨跌/PE/PB/市值）
 *   GET /kline?code=600519&num=120&klt=101    历史K线（含成交量）
 *   GET /financials?code=600519               主要财务指标（营收/净利/增速/ROE/毛利率…）
 *   附加 &debug=1 可在响应里看到上游原始数据，便于字段校准。
 *
 * 说明：东方财富为公开但非官方接口，数据仅供参考，可能限流或变动。
 */
import lib from './lib.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};
const UPSTREAM_HEADers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Referer': 'https://www.eastmoney.com/',
  'Accept': 'application/json, text/plain, */*',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: UPSTREAM_HEADers, cf: { cacheTtl: 10 } });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) {
    // 部分接口返回 jsonp 或前缀，尝试剥离
    const m = text.match(/[[{][\s\S]*[}\]]/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) { /* fallthrough */ } }
    throw new Error('上游返回非 JSON（可能被限流或拦截）');
  }
}

/* ----------------------------- /quote ----------------------------- */
async function quote(url) {
  const codes = (url.searchParams.get('code') || '').split(',').map((c) => c.trim()).filter(Boolean);
  if (!codes.length) return json({ ok: false, error: '缺少 code 参数' }, 400);
  const norm = codes.map(lib.normalizeSecid).filter(Boolean);
  const secids = norm.map((n) => n.secid).join(',');
  const fields = 'f12,f13,f14,f2,f3,f4,f15,f16,f17,f18,f9,f23,f20,f21,f8';
  const api = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=${encodeURIComponent(secids)}&fields=${fields}`;
  const data = await fetchJSON(api);
  const diff = data && data.data && data.data.diff ? data.data.diff : [];
  const arr = Array.isArray(diff) ? diff : Object.values(diff);
  const quotes = arr.map((d) => ({
    code: d.f12,
    name: d.f14,
    price: numOrNull(d.f2),
    changePct: numOrNull(d.f3),
    change: numOrNull(d.f4),
    high: numOrNull(d.f15),
    low: numOrNull(d.f16),
    open: numOrNull(d.f17),
    prevClose: numOrNull(d.f18),
    pe: numOrNull(d.f9),       // 市盈率(动)
    peTtm: null,
    pb: numOrNull(d.f23),      // 市净率
    dividend: null,            // 股息率：push2 不直接提供，留空（可由财报推算）
    marketCap: numOrNull(d.f20),
    floatCap: numOrNull(d.f21),
    turnoverRate: numOrNull(d.f8),
  }));
  const out = { ok: true, source: 'eastmoney', quotes };
  if (url.searchParams.get('debug')) out._raw = data;
  return json(out);
}

/* ----------------------------- /kline ----------------------------- */
async function kline(url) {
  const code = url.searchParams.get('code');
  const n = lib.normalizeSecid(code);
  if (!n) return json({ ok: false, error: '缺少有效 code' }, 400);
  const num = Math.min(parseInt(url.searchParams.get('num') || '120', 10) || 120, 800);
  const klt = url.searchParams.get('klt') || '101'; // 101日 102周 103月
  const api = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${n.secid}` +
    `&klt=${klt}&fqt=1&end=20500101&lmt=${num}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57`;
  const data = await fetchJSON(api);
  const lines = data && data.data && data.data.klines ? data.data.klines : [];
  const klines = lines.map(lib.parseKlineLine);
  const out = { ok: true, source: 'eastmoney', code: n.f10, klines };
  if (url.searchParams.get('debug')) out._raw = data;
  return json(out);
}

/* --------------------------- /financials --------------------------- */
async function financials(url) {
  const code = url.searchParams.get('code');
  const n = lib.normalizeSecid(code);
  if (!n) return json({ ok: false, error: '缺少有效 code' }, 400);
  // 东方财富 F10 主要财务指标（按报告期）
  const api = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/MainTargetAjax?type=0&code=${n.f10}`;
  let data;
  try { data = await fetchJSON(api); } catch (e) {
    return json({ ok: false, error: '财务接口获取失败：' + e.message }, 502);
  }
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  const financials = list.slice(0, 8).map((r) => ({
    period: r.REPORTDATE || r.REPORT_DATE || r.STD_REPORT_DATE,
    revenue: numOrNull(r.TOTALOPERATEREVE),            // 营业总收入(元)
    revenueYoY: numOrNull(r.TOTALOPERATEREVETZ),       // 营收同比(%)
    netProfit: numOrNull(r.PARENTNETPROFIT),           // 归母净利(元)
    netProfitYoY: numOrNull(r.PARENTNETPROFITTZ),      // 净利同比(%)
    roe: numOrNull(r.ROEJQ),                           // 加权ROE(%)
    grossMargin: numOrNull(r.XSMLL),                   // 销售毛利率(%)
    netMargin: numOrNull(r.XSJLL),                     // 销售净利率(%)
    debtRatio: numOrNull(r.ZCFZL),                     // 资产负债率(%)
    eps: numOrNull(r.EPSJB),                           // 每股收益
  }));
  const out = { ok: true, source: 'eastmoney', code: n.f10, financials };
  if (url.searchParams.get('debug')) out._raw = list.slice(0, 1);
  return json(out);
}

function numOrNull(v) {
  if (v == null || v === '' || v === '-' || v === '--' || v === '—') return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/' || path === '/health') return json({ ok: true, source: 'eastmoney', endpoints: ['/quote', '/kline', '/financials'] });
      if (path === '/quote') return await quote(url);
      if (path === '/kline') return await kline(url);
      if (path === '/financials') return await financials(url);
      return json({ ok: false, error: '未知路径: ' + path }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 502);
    }
  },
};
