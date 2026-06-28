/**
 * 行情桥接客户端（浏览器端）。
 * 通过本地桥接服务 bridge.py 访问 OpenD 行情，避免浏览器直连 TCP 与 CORS 问题。
 */
(function (global) {
  const DEFAULT_BASE = 'http://127.0.0.1:8617';

  function base() {
    try {
      return localStorage.getItem('tracker.bridgeBase') || DEFAULT_BASE;
    } catch (e) {
      return DEFAULT_BASE;
    }
  }

  function setBase(url) {
    try { localStorage.setItem('tracker.bridgeBase', url); } catch (e) { /* ignore */ }
  }

  async function getJSON(path, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
    try {
      const res = await fetch(base() + path, { signal: ctrl.signal });
      const data = await res.json().catch(() => ({ ok: false, error: '响应不是有效 JSON' }));
      return data;
    } catch (e) {
      const reason = e.name === 'AbortError'
        ? '请求超时：桥接服务未响应'
        : '无法连接桥接服务（请确认 bridge.py 已在本机运行）';
      return { ok: false, error: reason };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 健康检查：桥接服务 + OpenD 是否就绪 */
  function health() {
    return getJSON('/health', 5000);
  }

  /** 拉取一只或多只代码的实时快照 */
  function quote(codes) {
    const list = Array.isArray(codes) ? codes.join(',') : String(codes);
    return getJSON('/quote?code=' + encodeURIComponent(list));
  }

  /** 拉取历史 K 线（用于回填长期曲线） */
  function kline(code, num) {
    return getJSON('/kline?code=' + encodeURIComponent(code) + '&num=' + (num || 120), 15000);
  }

  global.Quotes = { base, setBase, health, quote, kline, DEFAULT_BASE };
})(window);
