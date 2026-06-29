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

代码格式：支持 "SH.600519" / "600519" / "sh600519" / "00700" 等，自动补全市场前缀。
所有响应均为 JSON，并带 Access-Control-Allow-Origin: *，便于本地静态页直接 fetch。
"""

import argparse
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    from futu import (
        OpenQuoteContext, RET_OK, KLType, AuType, SubType,
    )
except ImportError:  # 友好提示而非堆栈
    OpenQuoteContext = None
    _IMPORT_ERROR = "未安装 futu-api，请先运行：pip install futu-api"
else:
    _IMPORT_ERROR = None


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
