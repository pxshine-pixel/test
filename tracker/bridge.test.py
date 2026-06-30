#!/usr/bin/env python3
"""
bridge.py 纯逻辑单测（不需要 futu / OpenD）。

用最小桩件替换 bridge 模块里的 futu 符号，验证条件解析、过滤器构造、行映射、
分页扫描等「基本面筛」核心逻辑。运行：

    python3 tracker/bridge.test.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bridge', os.path.join(HERE, 'bridge.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

# ---------------- 最小 futu 桩件 ----------------
class _SF:  # SimpleFilter
    def __init__(self): self.stock_field = None; self.is_no_filter = None; self.filter_min = None; self.filter_max = None
class _FF(_SF):  # FinancialFilter
    def __init__(self): super().__init__(); self.quarter = None
class _Quarter:
    ANNUAL = 'ANNUAL'; MOST_RECENT_QUARTER = 'MRQ'; INTERIM = 'INTERIM'
    FIRST_QUARTER = 'Q1'; THIRD_QUARTER = 'Q3'
class _Market:
    SH = 'SH'; SZ = 'SZ'; HK = 'HK'; US = 'US'
class _StockField:  # 提供 SCREEN_FIELDS 里的全部字段名
    pass
for _m, _fname, _k in b.SCREEN_FIELDS:
    setattr(_StockField, _fname, 'F_' + _fname)

class _Item:  # 模拟 FilterStockData：支持 item[filter_obj] 取值
    def __init__(self, code, name, values): self.stock_code = code; self.stock_name = name; self._v = values
    def __getitem__(self, fo): return self._v[fo]

b.SimpleFilter = _SF
b.FinancialFilter = _FF
b.FinancialQuarter = _Quarter
b.Market = _Market
b.StockField = _StockField
b.RET_OK = 0
b._IMPORT_ERROR = None
b.time.sleep = lambda *_a, **_k: None  # 别真睡

_passed = 0
def check(name, cond):
    global _passed
    if cond: _passed += 1; print('  ✓', name)
    else: print('  ✗', name); sys.exit(1)

print('parse_conditions')
c = b.parse_conditions({'peMax': ['30'], 'roeMin': ['10'], 'marketCapMin': ['50'],
                        'revenueYoYMin': ['15'], 'debtRatioMax': ['60']})
check('PE 上限', c['pe'] == (None, 30.0))
check('ROE 下限', c['roe'] == (10.0, None))
check('市值 50 亿 → 5e9', c['marketCap'] == (5e9, None))
check('营收增速下限', c['revenueYoY'] == (15.0, None))
check('负债率上限', c['debtRatio'] == (None, 60.0))
check('未给的字段不出现', 'pb' not in c)
check('别名 revYoY 映射', b.parse_conditions({'revYoYMin': ['8']}).get('revenueYoY') == (8.0, None))

print('build_filters')
filters, specs, skipped = b.build_filters('ANNUAL', c)
check('字段数与 SCREEN_FIELDS 一致', len(specs) == len(b.SCREEN_FIELDS))
check('无跳过（桩件字段齐全）', skipped == [])
by_metric = {m: fo for m, fo in specs}
check('设了条件的字段 is_no_filter=False', by_metric['pe'].is_no_filter is False and by_metric['pe'].filter_max == 30.0)
check('未设条件的字段 is_no_filter=True', by_metric['grossMargin'].is_no_filter is True)
check('financial 字段带 quarter', by_metric['roe'].quarter == 'ANNUAL')
check('simple 字段无 quarter 属性', not hasattr(by_metric['pe'], 'quarter'))

print('build_filters: 跳过本机不支持的字段')
saved = _StockField.PB_RATE
del _StockField.PB_RATE
_f2, _s2, skipped2 = b.build_filters('ANNUAL', {})
check('PB_RATE 被跳过', 'PB_RATE' in skipped2 and all(m != 'pb' for m, _ in _s2))
_StockField.PB_RATE = saved  # 还原

print('_map_row')
vals = {by_metric['pe']: 12.5, by_metric['pb']: 1.8, by_metric['marketCap']: 8.0e9,
        by_metric['revenueYoY']: 20.0, by_metric['netProfitYoY']: 18.0, by_metric['roe']: 15.0,
        by_metric['grossMargin']: 30.0, by_metric['netMargin']: 10.0, by_metric['debtRatio']: 40.0,
        by_metric['netProfit']: 1.0e8, by_metric['ocf']: 1.5e8, by_metric['price']: 25.0}
row = b._map_row(_Item('SH.600519', '贵州茅台', vals), specs)
check('代码/名称', row['code'] == 'SH.600519' and row['name'] == '贵州茅台')
check('PE 透传', row['pe'] == 12.5)
check('ocfToNp = 1.5e8/1e8*100 = 150', row['ocfToNp'] == 150.0)
check('市值转亿', row['marketCapYi'] == 80.0)

print('_map_row: 缺失/零净利不炸')
vals2 = dict(vals); vals2[by_metric['netProfit']] = 0
row2 = b._map_row(_Item('SZ.000001', '平安', vals2), specs)
check('净利为 0 时 ocfToNp 不计算', 'ocfToNp' not in row2 or row2['ocfToNp'] is None)

print('market_of / _markets')
check('market_of SH', b.market_of('SH.600519') == 'SH')
check('market_of SZ', b.market_of('SZ.300930') == 'SZ')
check('_markets A → 沪深', b._markets('A') == ['SH', 'SZ'])
check('_markets SH → 单市场', b._markets('SH') == ['SH'])

print('scan_market 分页 + 节流停止')
class _Ctx:
    def __init__(self, pages): self.pages = pages; self.calls = 0
    def get_stock_filter(self, market, filter_list, begin, num):
        page = self.pages[self.calls]; self.calls += 1
        last = self.calls >= len(self.pages)
        items = [_Item(f'{market}.{begin+i:06d}', f'股{begin+i}', {fo: 1.0 for _m, fo in specs}) for i in range(page)]
        return (b.RET_OK, (last, 999, items))
class _Hub:
    def __init__(self, ctx): self._c = ctx
    def ctx(self): return self._c
    def reset(self): pass
b.HUB = _Hub(_Ctx([200, 200, 50]))  # 三页：200+200+50
rows = b.scan_market('SH', filters, specs)
check('翻到 last_page 收集 450 行', len(rows) == 450)
check('调用了 3 次 get_stock_filter', b.HUB.ctx().calls == 3)

print('\n%d passed' % _passed)
