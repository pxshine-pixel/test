# 免费行情 / 财报数据 Worker

一个独立的 Cloudflare Worker，在**边缘服务器端**代理东方财富的公开接口，输出带 CORS 的 JSON。
部署后，公网 HTTPS 站点（如本工具集的 Cloudflare 部署）可直接调用——**无 CORS、无混合内容、不依赖本机 OpenD**。

## 接口

| 接口 | 说明 |
| --- | --- |
| `GET /health` | 健康检查 |
| `GET /quote?code=600519,000001` | 实时行情：现价、涨跌幅、PE、PB、总/流通市值、换手率 |
| `GET /kline?code=600519&num=120&klt=101` | 历史 K 线（klt：101 日 / 102 周 / 103 月），含成交量 |
| `GET /financials?code=600519` | 主要财务指标（按报告期）：营收、净利及同比、ROE、毛利率、净利率、资产负债率、EPS |

- 代码支持 `600519` / `sh600519` / `SH.600519` / `00700`（港股）/ 北交所等，自动归一化。
- 加 `&debug=1` 可在响应里看到上游**原始数据**，便于字段校准。
- 返回结构与本地 `bridge.py` 的 `/quote`、`/kline` 基本一致，前端可无痛切换。

## 部署

需要一个 Cloudflare 账号。在本目录执行：

```bash
cd data-worker
npx wrangler login          # 浏览器授权（首次）
npx wrangler deploy         # 部署，得到 https://stock-data-api.<子域>.workers.dev
```

> 也可在 Cloudflare 控制台用 Git 集成把本目录作为单独的 Worker 项目部署。

部署成功后会得到一个 `*.workers.dev` 网址，例如：
`https://stock-data-api.yourname.workers.dev`

## 让前端用它

在「个股长期跟踪 / 技术分析 / 基本面知识库」页面，点顶栏的**行情状态**或 ⚙，把数据源地址设为你的 Worker 网址（上面的 `*.workers.dev`）。设置保存在浏览器本地（`tracker.bridgeBase`），三个工具共用。

之后实时行情、K 线、财报就走云端 Worker，**不再需要本机跑 bridge.py**。

## 重要说明

- 东方财富为**公开但非官方**接口，数据**仅供参考**，可能限流或字段变动；重要决策以官方财报 / 券商终端为准。
- 个别接口可能对境外 IP 有限制。若 `/quote` 等返回为空或报错，用 `?debug=1` 看上游原始返回，按需调整字段映射（`worker.js` 里集中处理）或更换数据源。

## 文件

- `worker.js` — Worker 主体（Cloudflare ESM）
- `lib.js` — 纯逻辑（代码归一化、K 线解析），浏览器 / Node / Worker 通用
- `worker.test.js` — 纯逻辑单测（`node worker.test.js`）
- `wrangler.jsonc` — 部署配置

## 测试

```bash
node worker.test.js     # 10 项：代码归一化、K 线解析
```
