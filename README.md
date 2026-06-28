# 投资工具集

一组零依赖的网页版投资工具，纯前端实现，数据只存在本地浏览器，直接打开即可使用。

**入口首页**：用浏览器打开根目录 `index.html`，即可导航到下面三个工具。

| 工具 | 目录 | 说明 |
| --- | --- | --- |
| 📈 股价计算器 | [`calculator/`](calculator/) | 单笔交易的成本、盈亏、保本价与目标价（含手续费） |
| 📊 投资组合追踪器 | [`portfolio/`](portfolio/) | 多只持仓管理、总盈亏汇总与资产配置饼图 |
| 📡 个股长期跟踪系统 | [`tracker/`](tracker/) | 时间序列快照、累计/年化收益、长期曲线，接富途 OpenD 实时行情 |
| 📐 技术分析 | [`analysis/`](analysis/) | 均线/MACD/RSI/KDJ 形态、密集成交区、买卖阶段信号（含示例数据） |

## 目录结构

```
.
├── index.html          # 统一入口首页
├── home.css            # 首页样式
├── calculator/         # 股价计算器
├── portfolio/          # 投资组合追踪器
├── tracker/            # 个股长期跟踪系统（含 bridge.py OpenD 桥接服务）
└── analysis/           # 技术分析（形态/密集区/买卖信号，复用 bridge.py）
```

每个工具目录内都有独立的 README 说明其功能与用法。

## 测试

三个工具的核心计算逻辑均为纯函数，附带单元测试：

```bash
npm test     # 依次运行 calculator / portfolio / tracker 的测试
```

## 技术说明

- **零依赖**：纯 HTML/CSS/JavaScript，无需构建或安装即可在浏览器打开。
- **本地优先**：数据保存在浏览器 `localStorage`，不上传。
- **实时行情**：个股长期跟踪系统通过本地 `bridge.py` 连接富途 OpenD，详见 [`tracker/README.md`](tracker/README.md)。

> 本工具集不构成投资建议。
