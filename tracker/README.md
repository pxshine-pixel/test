# 个股长期跟踪系统

对自选股做**长期跟踪**：按时间记录价格/估值快照，自动计算累计收益、年化（CAGR）与操作区间，并绘制长期价格曲线。行情通过本机 **富途 OpenD** 实时拉取。

## 功能

- **自选股管理**：A 股 / 港股 / 美股，按代码添加
- **时间序列快照**：每条记录日期 + 价格 + PE/PB/股息率 + 备注
- **自动分析**：累计涨跌、年化收益 CAGR、区间最高/最低、距目标买入价的下跌空间
- **操作区间信号**：现价 ≤ 目标买入价 → 买入区；≥ 目标卖出价 → 卖出区；否则持有
- **长期价格曲线**：纯 SVG 折线图，叠加目标买/卖参考线
- **投资逻辑笔记**：记录每只股票的买卖依据
- **实时行情**：一键从 OpenD 拉取现价与估值，自动生成当日快照
- **历史回填**：从 OpenD 日线 K 线批量回填收盘价，快速建立长期曲线
- **本地存储 + 导入/导出**：数据存浏览器 localStorage，可导出 JSON 备份

## 架构

浏览器无法直接连 OpenD 的 TCP 端口，因此用一个本地桥接服务中转：

```
网页(浏览器) ──HTTP/JSON──> bridge.py ──futu SDK──> OpenD(11111) ──> 富途服务器
```

## 使用步骤

1. **启动 OpenD** 并登录（富途牛牛 OpenD，默认端口 11111）。
2. **安装依赖并启动桥接服务**：
   ```bash
   pip install futu-api
   python bridge.py            # 默认 http://127.0.0.1:8617
   ```
   桥接服务参数：
   ```bash
   python bridge.py --port 8617 --opend-host 127.0.0.1 --opend-port 11111
   ```
3. **用浏览器打开 `index.html`**。顶栏状态灯变绿即表示行情已连接。
   - 若桥接地址不是默认值，点顶栏 ⚙ 修改。

> 不启动桥接服务也能用：所有数据可手动录入，只是没有「实时拉价 / 回填历史」。

## 接口（bridge.py）

| 接口 | 说明 |
| --- | --- |
| `GET /health` | 检查 OpenD 连通性 |
| `GET /quote?code=SH.600519,HK.00700` | 实时快照：现价、PE、PB、股息率 |
| `GET /kline?code=SH.600519&num=120&ktype=K_DAY` | 历史 K 线收盘价 |
| `GET /financials?code=SH.600519&quarter=ANNUAL` | 单只股票基本面：营收/净利同比、ROE、毛利率、净利率、负债率、经营现金流/净利。供「基本面打分」拉取 |
| `GET /screen?market=A&peMax=30&roeMin=10&revenueYoYMin=15&...` | 全市场基本面筛（条件选股），返回命中股票及其基本面字段 |
| `GET /fields` | 列出本机 futu 版本可用的 StockField / 财报期，用于字段校准 |

代码支持 `600519` / `sh600519` / `SH.600519` / `00700` 等写法，自动补全市场前缀。

### 基本面筛（条件选股）

底层是 OpenD 的 `get_stock_filter` 接口。`/screen` 支持的条件参数（都可选，`Min`/`Max` 后缀）：

| 参数 | 含义 | 例 |
| --- | --- | --- |
| `market` | `A`(沪深) / `SH` / `SZ` | `A` |
| `quarter` | `ANNUAL` 年报 / `MOST_RECENT_QUARTER` 最近季报 / `INTERIM` 中报 / `FIRST_QUARTER` / `THIRD_QUARTER` | `ANNUAL` |
| `peMax` / `pbMax` | 市盈率 TTM / 市净率 上限 | `peMax=30` |
| `roeMin` | ROE 下限 % | `roeMin=10` |
| `revenueYoYMin` / `netProfitYoYMin` | 营收 / 净利同比增速 下限 % | `revenueYoYMin=15` |
| `debtRatioMax` | 资产负债率 上限 % | `debtRatioMax=60` |
| `marketCapMin` | 总市值下限（**亿**，自动 ×1e8） | `marketCapMin=50` |
| `limit` | 返回数量上限 | `limit=300` |

在「基本面打分」页点 **🔍 全市场基本面筛**，填条件 → 「筛选并打分」，结果会直接进入打分表排序。

> **频率与耗时**：条件选股约 30 秒 10 次，本服务翻页间自动节流（`THROTTLE_SEC`）。**设了条件**时富途服务端已过滤、通常 1～2 页秒回；**无条件**的全市场扫描（如单只 `/financials` 首次拉取）需扫整个市场，数十秒，之后命中 12 小时缓存即时返回。
>
> **字段校准**：`StockField` 各枚举名可能随 futu 版本不同。若 `/screen` 报字段错误，先 `GET /fields` 看本机可用字段，再对齐 `bridge.py` 顶部的 `SCREEN_FIELDS` 表。返回里的 `skippedFields` 会列出本机不支持、已自动跳过的字段。

## 文件结构

- `index.html` / `styles.css` — 界面
- `tracker.js` — 计算核心（浏览器 / Node 通用）
- `quotes.js` — 桥接客户端
- `app.js` — 界面逻辑、SVG 曲线、本地存储
- `bridge.py` — OpenD ↔ HTTP 桥接服务
- `tracker.test.js` — 单元测试（`node tracker.test.js`）

## 测试

```bash
node tracker.test.js        # 核心计算 12 项测试
python3 bridge.test.py      # 桥接基本面筛逻辑 25 项（mock futu，无需 OpenD）
```

> 数据仅保存在本地浏览器，不上传。本工具不构成投资建议，行情以 OpenD 实际返回为准。
