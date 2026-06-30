/**
 * 股票基本面汇总 - 核心解析与排序（纯函数，浏览器 / Node 通用）。
 *
 * 目标：把 /score 等来源「打分后的股票」无论什么格式（JSON / Markdown 表格 /
 * CSV / TSV / 「名称 分数」文本行）都解析成统一的行对象，自动识别「基本面分数」
 * 列，并按分数排序、排名。
 */

/**
 * 解析输入文本，返回 { rows, columns, scoreKey, nameKey, codeKey, warnings }。
 * rows: 统一的对象数组；数值型字符串会转成 number。
 */
function parse(text) {
  const out = { rows: [], columns: [], scoreKey: null, nameKey: null, codeKey: null, warnings: [] };
  if (!text || !String(text).trim()) return out;
  const raw = String(text).trim();

  let rows = null;
  if (raw[0] === '[' || raw[0] === '{') {
    rows = tryJSON(raw, out);
  }
  if (!rows) rows = parseTable(raw, out);
  if (!rows || !rows.length) { out.warnings.push('未能解析出任何数据行'); return out; }

  // 数值化
  rows = rows.map((r) => {
    const o = {};
    Object.keys(r).forEach((k) => { o[k] = coerce(r[k]); });
    return o;
  });

  const columns = unionKeys(rows);
  out.rows = rows;
  out.columns = columns;
  out.scoreKey = pickKey(columns, [/score/i, /评分/, /基本面/, /得分/, /分数/, /rating/i, /分$/]);
  out.nameKey = pickKey(columns, [/name/i, /名称/, /股票/, /简称/]);
  out.codeKey = pickKey(columns, [/code/i, /代码/, /symbol/i, /ticker/i]);
  if (!out.scoreKey) out.warnings.push('未识别到「分数」列，请手动指定排序列');
  return out;
}

function tryJSON(raw, out) {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      // 数组里若是对象 → 直接用；若是基础值 → 包成 {value}
      if (data.length && typeof data[0] === 'object' && data[0] !== null) return data;
      return data.map((v) => ({ value: v }));
    }
    if (data && typeof data === 'object') {
      // 可能是 { rows:[...] } 或 { "茅台": 85, ... }
      if (Array.isArray(data.rows)) return data.rows;
      const entries = Object.entries(data);
      if (entries.every(([, v]) => typeof v !== 'object')) {
        return entries.map(([k, v]) => ({ name: k, score: v }));
      }
      return [data];
    }
  } catch (e) {
    out.warnings.push('JSON 解析失败，尝试按表格解析');
  }
  return null;
}

/** 解析 Markdown 表格 / CSV / TSV / 「名称 分数」文本行 */
function parseTable(raw, out) {
  let lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 去掉 markdown 分隔行，如 |---|---|
  lines = lines.filter((l) => !/^\|?\s*:?-{2,}/.test(l.replace(/\|/g, '').trim()) && !/^[\s|:-]+$/.test(l));
  if (!lines.length) return null;

  const delim = detectDelim(lines);
  if (delim) {
    const cells = (l) => l.replace(/^\||\|$/g, '').split(delim).map((c) => c.trim());
    const header = cells(lines[0]);
    // 若首行不像表头（全是数字），则用占位列名
    const looksHeader = header.some((h) => h && Number.isNaN(Number(h)));
    const cols = looksHeader ? header : header.map((_, i) => 'col' + (i + 1));
    const body = looksHeader ? lines.slice(1) : lines;
    return body.map((l) => {
      const vals = cells(l);
      const o = {};
      cols.forEach((c, i) => { o[c || ('col' + (i + 1))] = vals[i] != null ? vals[i] : ''; });
      return o;
    });
  }

  // 无分隔符：尝试「名称 分数」——每行最后一个 token 是数字
  const parsed = lines.map((l) => {
    const m = l.match(/^(.*?)[\s\t]+(-?\d+(?:\.\d+)?)$/);
    return m ? { name: m[1].trim(), score: m[2] } : null;
  });
  if (parsed.every(Boolean)) return parsed;

  out.warnings.push('无法识别分隔符，请用 JSON / 逗号 / 制表符 / Markdown 表格');
  return null;
}

function detectDelim(lines) {
  const sample = lines.slice(0, Math.min(5, lines.length));
  if (sample.some((l) => l.includes('|'))) return '|';
  if (sample.some((l) => l.includes('\t'))) return '\t';
  if (sample.some((l) => l.includes(','))) return ',';
  return null;
}

/** 按分数排序并加排名，返回新数组。dir: 'desc'(默认)|'asc' */
function sortByScore(rows, key, dir) {
  const k = key;
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const av = a[k], bv = b[k];
    const an = typeof av === 'number', bn = typeof bv === 'number';
    if (an && bn) return (av - bv) * sign;
    if (an) return -1;            // 数字排在非数字前
    if (bn) return 1;
    return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv)) * sign;
  });
  return sorted.map((r, i) => ({ ...r, __rank: i + 1 }));
}

/** 基本统计：分数列的数量、均值、最高、最低 */
function scoreStats(rows, key) {
  const nums = rows.map((r) => r[key]).filter((v) => typeof v === 'number');
  if (!nums.length) return { count: rows.length, scored: 0, avg: null, max: null, min: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: rows.length,
    scored: nums.length,
    avg: round2(sum / nums.length),
    max: round2(Math.max(...nums)),
    min: round2(Math.min(...nums)),
  };
}

/* ---------- 工具 ---------- */
function coerce(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v).trim();
  if (s === '') return '';
  // 去掉百分号/逗号后是纯数字则转 number
  const cleaned = s.replace(/,/g, '').replace(/%$/, '');
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  return s;
}
function unionKeys(rows) {
  const seen = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (!seen.includes(k)) seen.push(k); }));
  return seen;
}
function pickKey(columns, patterns) {
  for (const p of patterns) {
    const hit = columns.find((c) => p.test(c));
    if (hit) return hit;
  }
  return null;
}
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

const API = { parse, sortByScore, scoreStats, coerce, pickKey };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.Fundamentals = API;
