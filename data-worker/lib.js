/**
 * data-worker 纯逻辑（浏览器 / Node / Worker 通用，便于单测）。
 * 负责：股票代码 → 东方财富 secid 归一化；K线行解析；数值工具。
 */

/**
 * 把各种写法的代码归一化为东方财富 secid（market.code）。
 * 东方财富 market：1=上交所，0=深交所/北交所，116=港股，105/106=美股(此处不展开)。
 * @returns {{secid, market, code, f10}|null}
 */
function normalizeSecid(raw) {
  let s = String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s/g, '');
  if (!s) return null;
  let market = null;
  let code = s;
  if (s.includes('.')) {
    const [a, b] = s.split('.');
    if (/^(SH|SZ|HK|BJ)$/.test(a)) { market = a; code = b; }
    else if (/^(SH|SZ|HK|BJ)$/.test(b)) { market = b; code = a; }
    else { code = s.replace(/\./g, ''); }
  } else {
    const m = s.match(/^(SH|SZ|HK|BJ)(\w+)$/);
    if (m) { market = m[1]; code = m[2]; }
  }
  if (!market) {
    if (/^\d{6}$/.test(code)) {
      if (/^(60|68|9)/.test(code)) market = 'SH';
      else if (/^(00|30|20)/.test(code)) market = 'SZ';
      else if (/^(8|4)/.test(code)) market = 'BJ';
      else market = 'SH';
    } else if (/^\d{5}$/.test(code)) {
      market = 'HK';
    } else {
      market = 'SH';
    }
  }
  const em = market === 'SH' ? '1' : market === 'SZ' ? '0' : market === 'BJ' ? '0' : market === 'HK' ? '116' : '1';
  return { secid: `${em}.${code}`, market, code, f10: market + code };
}

/**
 * 解析东方财富 kline 的一行：
 * "date,open,close,high,low,volume,amount,amplitude,changepct,change,turnover"
 */
function parseKlineLine(line) {
  const p = String(line).split(',');
  return {
    date: p[0],
    open: toNum(p[1]),
    close: toNum(p[2]),
    high: toNum(p[3]),
    low: toNum(p[4]),
    volume: toNum(p[5]),
    amount: toNum(p[6]),
  };
}

function toNum(v) {
  if (v == null || v === '' || v === '-' || v === '—') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const API = { normalizeSecid, parseKlineLine, toNum };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.DataLib = API;
