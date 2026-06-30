#!/usr/bin/env python3
"""
OpenD 本地桥接服务
==================

把富途 OpenD（默认 TCP 11111）的行情接口，转成网页能直接调用的 HTTP/JSON 接口
（带 CORS）。因为浏览器无法直接连 OpenD 的原始 TCP 端口，所以需要这个本地中转。

依赖：
    pip install futu-api

启动 OpenD 后运行：
    python bridge.py                 # 默认监听 127.0.0.1:8617，连 OpenD 127.0.0.1:11111
    python bridge.py --port 9000 --opend-port 11111

接口：
    GET /health
        检查与 OpenD 的连通性。
    GET /quote?code=SH.600519,HK.00700
        实时快照：现价、涨跌幅、PE、PB、股息率、名称等。
    GET /kline?code=SH.600519&num=120&ktype=K_DAY
        历史 K 线收盘价（用于回填长期价格曲线）。
    GET /financials?code=SH.600519&quarter=ANNUAL
        单只股票的基本面指标（营收/净利同比、ROE、毛利率、净利率、负债率、
        经营现金流/净利 等），供「基本面打分」拉取。底层用 OpenD 的条件选股
        get_stock_filter 接口；首次会扫描该股所在市场并缓存，后续命中缓存。
    GET /screen?market=A&quarter=ANNUAL&peMax=30&roeMin=10&revenueYoYMin=15&...
        全市场基本面筛（条件选股）：按 PE/PB/ROE/营收增速/净利增速/负债率/市值
        等条件扫描 A 股（SH+SZ），返回命中股票及其基本面字段，网页端再用打分核心
        排序。条件越具体，返回越快（富途服务端已过滤）。
    GET /fields
        列出本机 futu 版本里可用的 StockField / FinancialQuarter，便于字段校准。

代码格式：支持 "SH.600519" / "600519" / "sh600519" / "00700" 等，自动补全市场前缀。
所有响应均为 JSON，并带 Access-Control-Allow-Origin: *，便于本地静态页直接 fetch。

注意：条件选股有频率限制（约 30 秒 10 次），本服务在翻页间自动节流；无条件的
全市场扫描（如单只 /financials 首次拉取）会较慢（数十秒），命中缓存后即时返回。
字段名（StockField 各枚举）可能随 futu 版本不同，若某接口报字段错误，先用 /fields
查看本机可用字段，再到 SCREEN_FIELDS 表里对齐。
"""

import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    from futu import (
        OpenQuoteContext, RET_OK, KLType, AuType, SubType,
        Market, SimpleFilter, FinancialFilter, StockField, FinancialQuarter,
    )
except ImportError:  # 友好提示而非堆栈
    OpenQuoteContext = None
    Market = SimpleFilter = FinancialFilter = StockField = FinancialQuarter = None
    _IMPORT_ERROR = "未安装 futu-api，请先运行：pip install futu-api"
else:
    _IMPORT_ERROR = None

# 翻页节流（秒）：条件选股约 30s/10 次，每页间隔 ≥3s 比较安全
THROTTLE_SEC = 3.1
# 全市场基本面扫描的缓存有效期（秒）：基本面按季更新，缓存 12 小时足够
SCAN_CACHE_TTL = 12 * 3600
# 单次扫描安全上限（行）：避免极端情况下无限翻页
SCAN_MAX_ROWS = 6000

# 基本面字段映射：(打分用的 metric 名, futu StockField 枚举名, 'simple' 快照类 / 'financial' 财报类)
# financial 类需要指定财报期（quarter）。字段名按 futu 版本可能微调，可用 /fields 校准。
SCREEN_FIELDS = [
    ('price',        'CUR_PRICE',              'simple'),
    ('pe',           'PE_TTM',                 'simple'),
    ('pb',           'PB_RATE',                'simple'),
    ('marketCap',    'TOTAL_MARKET_VAL',       'simple'),
    ('revenueYoY',   'SUM_OF_BUSINESS_GROWTH', 'financial'),
    ('netProfitYoY', 'NET_PROFIT_GROWTH',      'financial'),
    ('roe',          'RETURN_ON_EQUITY_RATE',  'financial'),
    ('grossMargin',  'GROSS_PROFIT_RATE',      'financial'),
    ('netMargin',    'NET_PROFIT_RATE',        'financial'),
    ('debtRatio',    'DEBT_ASSET_RATE',        'financial'),
    ('netProfit',    'NET_PROFIT',             'financial'),
    ('ocf',          'OPERATING_CASH_FLOW_TTM','financial'),
]

# 全市场扫描结果缓存：{(market, quarter): {'ts':.., 'rows': {code: row}}}
_SCAN_CACHE = {}
_SCAN_LOCK = threading.Lock()


# ----------------------------- 行情上下文（单例，复用连接） -----------------------------
class QuoteHub:
    """线程安全地持有一个 OpenQuoteContext，按需懒连接。"""

    def __init__(self, host, port):
        self._host = host
        self._port = port
        self._ctx = None
        self._lock = threading.Lock()

    def ctx(self):
        if _IMPORT_ERROR:
            raise RuntimeError(_IMPORT_ERROR)
        with self._lock:
            if self._ctx is None:
                self._ctx = OpenQuoteContext(host=self._host, port=self._port)
            return self._ctx

    def reset(self):
        with self._lock:
            if self._ctx is not None:
                try:
                    self._ctx.close()
                except Exception:
                    pass
                self._ctx = None


HUB = None  # 在 main 中初始化


# ----------------------------- 代码归一化 -----------------------------
def normalize_code(raw):
    """把各种写法的股票代码统一成 Futu 的 'MARKET.CODE' 形式。"""
    s = str(raw).strip().upper().replace(' ', '')
    if not s:
        return None
    if '.' in s:  # 已是 SH.600519 形式
        return s
    m = re.match(r'^(SH|SZ|HK|US)(\d+|[A-Z.]+)$', s)  # sh600519 / hk00700
    if m:
        return f'{m.group(1)}.{m.group(2)}'
    if s.isdigit():
        if len(s) == 6:  # A 股
            return f'SH.{s}' if s[0] == '6' else f'SZ.{s}'
        if len(s) == 5:  # 港股
            return f'HK.{s}'
    return f'US.{s}'  # 兜底当美股代码（如 AAPL）


# ----------------------------- 业务逻辑 -----------------------------
def do_health():
    if _IMPORT_ERROR:
        return 503, {'ok': False, 'error': _IMPORT_ERROR}
    try:
        ctx = HUB.ctx()
        ret, data = ctx.get_global_state()
        if ret == RET_OK:
            return 200, {'ok': True, 'opend': 'connected', 'state': _jsonable(data)}
        return 502, {'ok': False, 'error': f'OpenD 返回错误: {data}'}
    except Exception as e:
        HUB.reset()
        return 502, {'ok': False, 'error': f'无法连接 OpenD（请确认已启动并登录）: {e}'}


def do_quote(codes):
    codes = [normalize_code(c) for c in codes if normalize_code(c)]
    if not codes:
        return 400, {'ok': False, 'error': '缺少有效的 code 参数'}
    try:
        ctx = HUB.ctx()
        ret, data = ctx.get_market_snapshot(codes)
        if ret != RET_OK:
            return 502, {'ok': False, 'error': f'获取快照失败: {data}'}
        rows = data.to_dict('records')
        quotes = [_quote_row(r) for r in rows]
        return 200, {'ok': True, 'quotes': quotes}
    except Exception as e:
        HUB.reset()
        return 502, {'ok': False, 'error': f'查询行情失败: {e}'}


def do_kline(code, num, ktype_name):
    code = normalize_code(code)
    if not code:
        return 400, {'ok': False, 'error': '缺少有效的 code 参数'}
    ktype = getattr(KLType, ktype_name, KLType.K_DAY)
    try:
        ctx = HUB.ctx()
        ret, data = ctx.get_cur_kline(code, num=num, ktype=ktype, autype=AuType.QFQ)
        if ret != RET_OK:
            # 退回历史接口（消耗历史额度）
            ret, data, _ = ctx.request_history_kline(code, ktype=ktype, max_count=num)
            if ret != RET_OK:
                return 502, {'ok': False, 'error': f'获取K线失败: {data}'}
        recs = data.to_dict('records')
        klines = [{
            'date': str(r.get('time_key', ''))[:10],
            'close': _f(r.get('close')),
            'open': _f(r.get('open')),
            'high': _f(r.get('high')),
            'low': _f(r.get('low')),
            'volume': _f(r.get('volume')),
            'turnover': _f(r.get('turnover')),
        } for r in recs]
        return 200, {'ok': True, 'code': code, 'klines': klines}
    except Exception as e:
        HUB.reset()
        return 502, {'ok': False, 'error': f'查询K线失败: {e}'}


def _quote_row(r):
    return {
        'code': r.get('code'),
        'name': r.get('name') or r.get('stock_name'),
        'price': _f(r.get('last_price')),
        'prevClose': _f(r.get('prev_close_price')),
        'open': _f(r.get('open_price')),
        'high': _f(r.get('high_price')),
        'low': _f(r.get('low_price')),
        'pe': _f(r.get('pe_ratio')),
        'peTtm': _f(r.get('pe_ttm_ratio')),
        'pb': _f(r.get('pb_ratio')),
        'dividend': _f(r.get('dividend_ratio_ttm') or r.get('dividend_ratio')),
        'updateTime': r.get('update_time'),
    }


def _f(v):
    try:
        if v is None or v == '' or v == 'N/A':
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _jsonable(data):
    try:
        return data.to_dict('records')
    except Exception:
        return str(data)


# ----------------------------- 基本面筛 / 条件选股 -----------------------------
def _quarter(name):
    """财报期名 → FinancialQuarter 枚举（默认年报）。"""
    return getattr(FinancialQuarter, str(name or 'ANNUAL').upper(), FinancialQuarter.ANNUAL)


def _markets(name):
    """市场名 → [Market...]；A/CN/ALL = 沪深两市。"""
    name = str(name or 'A').upper()
    if name in ('A', 'CN', 'ALL'):
        return [Market.SH, Market.SZ]
    return [getattr(Market, name, Market.SH)]


def market_of(code):
    """归一化代码（SH.600519）→ Market 枚举。"""
    pre = str(code).split('.')[0]
    return {'SH': getattr(Market, 'SH', None), 'SZ': getattr(Market, 'SZ', None),
            'HK': getattr(Market, 'HK', None), 'US': getattr(Market, 'US', None)}.get(pre)


def build_filters(quarter_name, conditions):
    """按 SCREEN_FIELDS 构造 filter_list；conditions: {metric: (min, max)}。
    设了条件的字段交给富途服务端过滤，其余字段 is_no_filter=True 仅取值。
    返回 (filter_list, specs)；specs 为 [(metric, filter_obj)]，用于回读每只股票的字段值。
    跳过本机 futu 版本不存在的字段（不会整体报错）。"""
    filters, specs, skipped = [], [], []
    quarter = _quarter(quarter_name)
    for metric, fieldname, kind in SCREEN_FIELDS:
        field = getattr(StockField, fieldname, None)
        if field is None:
            skipped.append(fieldname)
            continue
        fo = SimpleFilter() if kind == 'simple' else FinancialFilter()
        fo.stock_field = field
        if kind == 'financial':
            fo.quarter = quarter
        cond = conditions.get(metric)
        if cond and (cond[0] is not None or cond[1] is not None):
            fo.is_no_filter = False
            if cond[0] is not None:
                fo.filter_min = cond[0]
            if cond[1] is not None:
                fo.filter_max = cond[1]
        else:
            fo.is_no_filter = True
        filters.append(fo)
        specs.append((metric, fo))
    return filters, specs, skipped


def _map_row(item, specs):
    """把一条 FilterStockData 映射成 {code, name, 各 metric}。"""
    row = {'code': getattr(item, 'stock_code', None), 'name': getattr(item, 'stock_name', None)}
    for metric, fo in specs:
        try:
            row[metric] = _f(item[fo])  # FilterStockData 支持按 filter 对象索引取值
        except Exception:
            row[metric] = None
    # 派生：经营现金流 / 归母净利（含金量）。TTM 现金流 vs 期净利，量纲近似，仅作参考。
    ocf, np = row.get('ocf'), row.get('netProfit')
    if ocf is not None and np:
        try:
            row['ocfToNp'] = round(ocf / np * 100, 2)
        except (TypeError, ZeroDivisionError):
            row['ocfToNp'] = None
    # 市值转「亿」更易读（前端也可直接用原值）
    if row.get('marketCap') is not None:
        row['marketCapYi'] = round(row['marketCap'] / 1e8, 2)
    return row


def scan_market(market, filters, specs, limit=None):
    """对单个市场分页扫描，翻页间节流。返回 [row...]。"""
    ctx = HUB.ctx()
    rows, begin = [], 0
    while True:
        ret, data = ctx.get_stock_filter(market=market, filter_list=filters, begin=begin, num=200)
        if ret != RET_OK:
            raise RuntimeError(f'条件选股失败: {data}')
        last_page, _all_count, ret_list = data
        rows.extend(_map_row(it, specs) for it in ret_list)
        begin += 200
        if last_page or not ret_list or begin >= SCAN_MAX_ROWS or (limit and len(rows) >= limit):
            break
        time.sleep(THROTTLE_SEC)  # 频率限制
    return rows


def market_financials(market, quarter_name):
    """缓存的全市场基本面（无条件扫描），返回 {code: row}。首次较慢，之后命中缓存。"""
    key = (str(market), str(quarter_name).upper())
    now = time.time()
    with _SCAN_LOCK:
        ent = _SCAN_CACHE.get(key)
        if ent and now - ent['ts'] < SCAN_CACHE_TTL:
            return ent['rows']
    filters, specs, _ = build_filters(quarter_name, {})
    rows = {r['code']: r for r in scan_market(market, filters, specs) if r.get('code')}
    with _SCAN_LOCK:
        _SCAN_CACHE[key] = {'ts': time.time(), 'rows': rows}
    return rows


def parse_conditions(q):
    """从 query 解析 <metric>Min / <metric>Max。市值条件用「亿」自动 ×1e8。"""
    cond = {}
    metrics = [m for (m, _f1, _k) in SCREEN_FIELDS]
    aliases = {'revYoY': 'revenueYoY', 'npYoY': 'netProfitYoY', 'roeRate': 'roe'}
    for metric in metrics:
        lo = _qnum(q, metric + 'Min')
        hi = _qnum(q, metric + 'Max')
        if metric == 'marketCap':
            lo = lo * 1e8 if lo is not None else None
            hi = hi * 1e8 if hi is not None else None
        if lo is not None or hi is not None:
            cond[metric] = (lo, hi)
    for alias, metric in aliases.items():
        lo, hi = _qnum(q, alias + 'Min'), _qnum(q, alias + 'Max')
        if (lo is not None or hi is not None) and metric not in cond:
            cond[metric] = (lo, hi)
    return cond


def _qnum(q, key):
    try:
        v = q.get(key, [None])[0]
        return float(v) if v not in (None, '') else None
    except (TypeError, ValueError):
        return None


def do_financials(code, quarter_name):
    code = normalize_code(code)
    if not code:
        return 400, {'ok': False, 'error': '缺少有效的 code 参数'}
    if _IMPORT_ERROR:
        return 503, {'ok': False, 'error': _IMPORT_ERROR}
    market = market_of(code)
    if market is None:
        return 400, {'ok': False, 'error': f'无法识别市场: {code}'}
    try:
        rows = market_financials(market, quarter_name)
        row = rows.get(code)
        if not row:
            return 200, {'ok': True, 'financials': [], 'note': f'{code} 不在 {quarter_name} 筛选结果中（可能停牌/无财报）'}
        return 200, {'ok': True, 'financials': [row]}
    except Exception as e:
        HUB.reset()
        return 502, {'ok': False, 'error': f'查询基本面失败: {e}'}


def do_screen(q):
    if _IMPORT_ERROR:
        return 503, {'ok': False, 'error': _IMPORT_ERROR}
    quarter = q.get('quarter', ['ANNUAL'])[0]
    market_name = q.get('market', ['A'])[0]
    limit = int(q.get('limit', ['300'])[0] or 300)
    conditions = parse_conditions(q)
    try:
        filters, specs, skipped = build_filters(quarter, conditions)
        rows = []
        for mk in _markets(market_name):
            rows.extend(scan_market(mk, filters, specs, limit=(None if conditions else limit)))
        rows = rows[:limit] if limit else rows
        out = {'ok': True, 'count': len(rows), 'quarter': quarter, 'market': market_name,
               'conditions': {k: v for k, v in conditions.items()}, 'rows': rows}
        if skipped:
            out['skippedFields'] = skipped  # 本机 futu 不支持的字段，便于校准
        if not conditions:
            out['note'] = '未设条件：仅取前若干只（建议加 PE/ROE/增速等条件以缩小范围、加快返回）'
        return 200, out
    except Exception as e:
        HUB.reset()
        return 502, {'ok': False, 'error': f'基本面筛失败: {e}'}


def do_fields():
    """列出本机 futu 可用的 StockField / FinancialQuarter，便于字段校准。"""
    if _IMPORT_ERROR:
        return 503, {'ok': False, 'error': _IMPORT_ERROR}
    fields = [{'metric': m, 'field': f, 'kind': k, 'available': hasattr(StockField, f)}
              for (m, f, k) in SCREEN_FIELDS]
    quarters = [x for x in dir(FinancialQuarter) if not x.startswith('_')] if FinancialQuarter else []
    return 200, {'ok': True, 'fields': fields, 'quarters': quarters}


# ----------------------------- HTTP 处理 -----------------------------
class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # 允许部署在 HTTPS 公网站点（如 Cloudflare Pages）的页面访问本机回环地址
        # （Chrome 的 Private Network Access 要求）
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # CORS 预检
        self._send(200, {'ok': True})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        q = parse_qs(parsed.query)

        try:
            if path == '/health' or path == '':
                status, payload = do_health()
            elif path == '/quote':
                codes = ','.join(q.get('code', [])).split(',')
                status, payload = do_quote(codes)
            elif path == '/kline':
                code = (q.get('code', [''])[0])
                num = int(q.get('num', ['120'])[0])
                ktype = q.get('ktype', ['K_DAY'])[0]
                status, payload = do_kline(code, num, ktype)
            elif path == '/financials':
                code = (q.get('code', [''])[0])
                quarter = q.get('quarter', ['ANNUAL'])[0]
                status, payload = do_financials(code, quarter)
            elif path == '/screen':
                status, payload = do_screen(q)
            elif path == '/fields':
                status, payload = do_fields()
            else:
                status, payload = 404, {'ok': False, 'error': f'未知路径: {path}'}
        except Exception as e:
            status, payload = 500, {'ok': False, 'error': str(e)}

        self._send(status, payload)

    def log_message(self, fmt, *args):  # 精简日志
        print(f'[bridge] {self.address_string()} {fmt % args}')


def main():
    global HUB
    ap = argparse.ArgumentParser(description='OpenD 本地行情桥接服务')
    ap.add_argument('--host', default='127.0.0.1', help='桥接服务监听地址')
    ap.add_argument('--port', type=int, default=8617, help='桥接服务监听端口')
    ap.add_argument('--opend-host', default='127.0.0.1', help='OpenD 地址')
    ap.add_argument('--opend-port', type=int, default=11111, help='OpenD 端口')
    args = ap.parse_args()

    HUB = QuoteHub(args.opend_host, args.opend_port)

    if _IMPORT_ERROR:
        print(f'⚠️  {_IMPORT_ERROR}（服务仍会启动，但行情接口会报错）')

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'✅ 桥接服务已启动: http://{args.host}:{args.port}')
    print(f'   连接 OpenD: {args.opend_host}:{args.opend_port}')
    print(f'   健康检查: http://{args.host}:{args.port}/health')
    print('   按 Ctrl+C 停止')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n正在关闭…')
    finally:
        srv.shutdown()
        if HUB:
            HUB.reset()


if __name__ == '__main__':
    main()
