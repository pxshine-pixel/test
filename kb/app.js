/* 基本面知识库：左股票列表 / 右 Markdown 报告，本地存储，可从 OpenD 拉取指标 */
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'kb.stocks.v1';
  const SEL = 'kb.selected.v1';
  const DEL = 'kb.deleted.v1';

  // 随仓库部署的内置报告（reports.js 提供）与本地数据合并：
  //   - 内置报告(bundled)未被本地编辑则不写入 localStorage，便于后续更新随部署生效
  //   - 本地新增或编辑过的条目写入 localStorage，优先于内置
  let deletedCodes = loadDeleted();
  let stocks = mergeBundled(load(), deletedCodes);
  let selectedId = loadSel();
  let editing = false;

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save() {
    // 仅持久化非内置（用户新增/编辑过）的条目
    try { localStorage.setItem(KEY, JSON.stringify(stocks.filter((s) => !s.bundled))); } catch (e) { /* ignore */ }
  }
  function loadDeleted() { try { return JSON.parse(localStorage.getItem(DEL)) || []; } catch (e) { return []; } }
  function saveDeleted() { try { localStorage.setItem(DEL, JSON.stringify(deletedCodes)); } catch (e) { /* ignore */ } }
  function loadSel() { try { return localStorage.getItem(SEL) || null; } catch (e) { return null; } }
  function saveSel() { try { localStorage.setItem(SEL, selectedId || ''); } catch (e) { /* ignore */ } }

  function mergeBundled(local, deleted) {
    const out = [...local];
    const codes = new Set(local.map((s) => String(s.code)));
    const del = new Set(deleted.map(String));
    (window.KB_REPORTS || []).forEach((b) => {
      if (!codes.has(String(b.code)) && !del.has(String(b.code))) {
        out.push({ id: b.id || ('kb-' + b.code), code: b.code, name: b.name || '', report: b.report || '', updated: b.updated || '', bundled: true });
      }
    });
    return out;
  }

  function uid() {
    let n = 1;
    while (stocks.some((s) => s.id === 'k' + n)) n++;
    return 'k' + n;
  }
  function getSel() { return stocks.find((s) => s.id === selectedId) || null; }
  function esc(s) { return KB.escapeHtml(s); }

  /* ---------- 桥接状态 ---------- */
  async function checkBridge() {
    const dot = $('bridgeDot'), text = $('bridgeText');
    text.textContent = '检测中…'; dot.className = 'dot';
    const h = await Quotes.health();
    if (h.ok) { dot.className = 'dot ok'; text.textContent = 'OpenD 已连接'; }
    else { dot.className = 'dot err'; text.textContent = '行情未连接'; text.title = h.error || ''; }
  }

  /* ---------- 左侧列表 ---------- */
  function renderList() {
    const ul = $('stockList');
    const q = $('search').value;
    const list = KB.filterStocks(stocks, q);
    ul.innerHTML = '';
    if (!stocks.length) { ul.innerHTML = '<li class="empty">还没有股票，左上角添加</li>'; return; }
    if (!list.length) { ul.innerHTML = '<li class="empty">无匹配结果</li>'; return; }
    list.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'stock-item' + (s.id === selectedId ? ' active' : '');
      li.dataset.id = s.id;
      li.innerHTML = `<span class="s-name">${esc(s.name || '未命名')}</span><span class="s-code">${esc(s.code)}</span>`;
      ul.appendChild(li);
    });
  }

  /* ---------- 右侧报告 ---------- */
  function renderReport() {
    const ph = $('placeholder'), body = $('reportBody');
    const s = getSel();
    if (!s) { ph.hidden = false; body.hidden = true; return; }
    ph.hidden = true; body.hidden = false;

    const updated = s.updated ? `更新于 ${s.updated}` : '尚未填写';
    body.innerHTML = `
      <div class="r-head">
        <div>
          <h2>${esc(s.name || '未命名')} <span class="r-code">${esc(s.code)}</span></h2>
          <span class="r-meta">${updated}</span>
        </div>
        <div class="r-actions">
          <button class="btn" id="pullBtn">⤓ 拉取指标</button>
          <button class="btn" id="editBtn">${editing ? '✓ 预览' : '✎ 编辑'}</button>
          <button class="link danger" id="delBtn">删除</button>
        </div>
      </div>
      <div class="r-content" id="rContent"></div>`;

    const content = $('rContent');
    if (editing) {
      content.innerHTML = `<textarea id="md" class="md-edit" placeholder="用 Markdown 写基本面分析，或粘贴 /score 的报告…">${esc(s.report || '')}</textarea>`;
      const ta = $('md');
      ta.focus();
      ta.addEventListener('input', () => { s.report = ta.value; s.updated = today(); s.bundled = false; save(); });
    } else {
      content.innerHTML = s.report
        ? `<div class="md-view">${KB.renderMarkdown(s.report)}</div>`
        : `<div class="md-empty">还没有报告。点「编辑」开始写，或「拉取指标」生成骨架。</div>`;
    }

    $('editBtn').onclick = () => { editing = !editing; renderReport(); };
    $('delBtn').onclick = () => {
      if (!confirm(`删除「${s.name || s.code}」及其报告？`)) return;
      if (!deletedCodes.map(String).includes(String(s.code))) { deletedCodes.push(s.code); saveDeleted(); }
      stocks = stocks.filter((x) => x.id !== s.id);
      selectedId = stocks.length ? stocks[0].id : null;
      editing = false; save(); saveSel(); renderAll();
    };
    $('pullBtn').onclick = () => pull(s);
  }

  async function pull(s) {
    const btn = $('pullBtn');
    btn.disabled = true; btn.textContent = '拉取中…';
    const r = await Quotes.quote(s.code);
    btn.disabled = false; btn.textContent = '⤓ 拉取指标';
    if (!r.ok || !r.quotes || !r.quotes.length) {
      alert('拉取失败：' + (r.error || '无数据') + '\n确认 OpenD 已登录、bridge.py 运行中。');
      return;
    }
    const q = r.quotes[0];
    if (q.name && !s.name) s.name = q.name;
    const tpl = KB.metricsTemplate(q);
    // 已有报告则把指标表插到开头，否则用整个骨架
    if (s.report && s.report.trim()) {
      if (!confirm('已有报告。用最新指标生成新骨架会覆盖当前内容，确定？')) return;
    }
    s.report = tpl;
    s.updated = today();
    s.bundled = false;
    save(); renderAll();
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ---------- 事件 ---------- */
  $('addBtn').onclick = async () => {
    const code = $('newCode').value.trim();
    const name = $('newName').value.trim();
    if (!code) { alert('请输入股票代码'); return; }
    if (stocks.some((x) => x.code.toLowerCase() === code.toLowerCase())) { alert('该代码已存在'); return; }
    deletedCodes = deletedCodes.filter((c) => String(c) !== String(code)); saveDeleted();
    const s = { id: uid(), code, name, report: '', updated: '' };
    stocks.push(s); selectedId = s.id; editing = false;
    $('newCode').value = ''; $('newName').value = '';
    save(); saveSel(); renderAll();
    // 自动尝试拉取指标（连不上则静默跳过）
    const h = await Quotes.health();
    if (h.ok) pull(s);
  };
  $('newCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addBtn').click(); });
  $('search').addEventListener('input', renderList);

  $('stockList').onclick = (e) => {
    const li = e.target.closest('.stock-item');
    if (!li) return;
    selectedId = li.dataset.id; editing = false; saveSel();
    renderList(); renderReport();
  };

  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(stocks, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'fundamentals-kb.json'; a.click();
    URL.revokeObjectURL(a.href);
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('格式不对');
        stocks = data; selectedId = stocks.length ? stocks[0].id : null;
        save(); saveSel(); renderAll();
        alert(`已导入 ${stocks.length} 只股票。`);
      } catch (err) { alert('导入失败：' + err.message); }
    };
    reader.readAsText(f); e.target.value = '';
  };
  $('bridgeStatus').onclick = checkBridge;

  function renderAll() { renderList(); renderReport(); }

  if (selectedId && !getSel()) selectedId = stocks.length ? stocks[0].id : null;
  renderAll();
  checkBridge();
})();
