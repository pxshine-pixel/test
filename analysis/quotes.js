/**
 * 行情桥接客户端（浏览器端）——与个股长期跟踪系统共用同一个 bridge.py。
 * 仅取历史 K 线（含成交量）用于技术分析。
 */
(function (global) {
  const DEFAULT_BASE = 'http://127.0.0.1:8617';

  function base() {
    try { return localStorage.getItem('tracker.bridgeBase') || DEFAULT_BASE; }
    catch (e) { return DEFAULT_BASE; }
  }
  function setBase(url) {
    try { localStorage.setItem('tracker.bridgeBase', url); } catch (e) { /* ignore */ }
  }

  async function getJSON(path, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
    try {
      const res = await fetch(base() + path, { signal: ctrl.signal });
      return await res.json().catch(() => ({ ok: false, error: '响应不是有效 JSON' }));
    } catch (e) {
      const reason = e.name === 'AbortError'
        ? '请求超时：桥接服务未响应'
        : '无法连接桥接服务（请确认 bridge.py 已在本机运行）';
      return { ok: false, error: reason };
    } finally {
      clearTimeout(timer);
    }
  }

  function health() { return getJSON('/health', 5000); }
  function kline(code, num) {
    return getJSON('/kline?code=' + encodeURIComponent(code) + '&num=' + (num || 120));
  }

  global.Quotes = { base, setBase, health, kline, DEFAULT_BASE };
})(window);
