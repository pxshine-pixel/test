/**
 * 行情桥接客户端 —— 与跟踪/分析工具共用 bridge.py。
 * 知识库用它在添加股票时自动取名称与 PE/PB/股息等基本面指标。
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
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
    try {
      const res = await fetch(base() + path, { signal: ctrl.signal });
      return await res.json().catch(() => ({ ok: false, error: '响应不是有效 JSON' }));
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? '请求超时：桥接服务未响应' : '无法连接桥接服务（确认 bridge.py 在运行）' };
    } finally { clearTimeout(timer); }
  }
  function health() { return getJSON('/health', 5000); }
  function quote(code) { return getJSON('/quote?code=' + encodeURIComponent(code)); }
  function financials(code) { return getJSON('/financials?code=' + encodeURIComponent(code), 12000); }
  global.Quotes = { base, setBase, health, quote, financials, DEFAULT_BASE };
})(window);
