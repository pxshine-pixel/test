/* 数据源客户端：与跟踪/分析/知识库共用 tracker.bridgeBase（本机 bridge 或云端 Worker） */
(function (global) {
  const DEFAULT_BASE = 'http://127.0.0.1:8617';
  function base() { try { return localStorage.getItem('tracker.bridgeBase') || DEFAULT_BASE; } catch (e) { return DEFAULT_BASE; } }
  function setBase(url) { try { localStorage.setItem('tracker.bridgeBase', url); } catch (e) { /* ignore */ } }

  async function getJSON(path, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
    try {
      const res = await fetch(base() + path, { signal: ctrl.signal });
      return await res.json().catch(() => ({ ok: false, error: '响应非 JSON' }));
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? '请求超时' : '无法连接数据源（本机 bridge.py 或云端 Worker）' };
    } finally { clearTimeout(timer); }
  }
  function health() { return getJSON('/health', 5000); }
  function quote(code) { return getJSON('/quote?code=' + encodeURIComponent(code)); }
  function financials(code) { return getJSON('/financials?code=' + encodeURIComponent(code), 15000); }

  global.Quotes = { base, setBase, health, quote, financials, DEFAULT_BASE };
})(window);
