# 部署到 Cloudflare Pages

本项目是纯静态站点（无需构建），最适合用 **Cloudflare Pages + GitHub 集成** 部署：
连接仓库后，每次推送自动部署。

## 一、连接仓库（一次性）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com) →左侧 **Workers & Pages**。
2. **Create application** → **Pages** → **Connect to Git**。
3. 授权 GitHub 并选择仓库 **`pxshine-pixel/test`**。
4. 在构建设置里填写（关键，因为本项目无需构建）：

   | 设置项 | 值 |
   | --- | --- |
   | Production branch（生产分支） | `main` |
   | Framework preset（框架预设） | **None** |
   | Build command（构建命令） | **留空** |
   | Build output directory（输出目录） | `/`（根目录） |

5. 点 **Save and Deploy**。约 1 分钟后会得到一个网址：
   `https://<项目名>.pages.dev`

> 之后每次推送到 `main`，Cloudflare 会自动重新部署。Pull Request 还会生成预览地址。

## 二、各工具上线后的状态

| 工具 | 云端可用性 |
| --- | --- |
| 📈 股价计算器 | ✅ 完全可用（纯前端，无外部依赖） |
| 📊 投资组合追踪器 | ✅ 完全可用（数据存浏览器本地） |
| 📡 个股长期跟踪系统 | ⚠️ 界面/手动录入可用；**实时拉价需本机桥接**（见下） |
| 📐 技术分析 | ⚠️ 「载入示例」可用；**实时分析需本机桥接**（见下） |

## 三、实时行情：在云端站点调用本机 OpenD

行情来自你本机的富途 OpenD，**不能上云**，仍由本机 `bridge.py` 提供。
部署后的站点是 HTTPS，要调用本机的 HTTP 桥接，需注意浏览器的「混合内容 / 私有网络访问」限制。

**步骤：**

1. 本机启动 OpenD 并登录。
2. 本机启动桥接服务：
   ```bash
   pip install futu-api
   python tracker/bridge.py        # 监听 http://127.0.0.1:8617
   ```
   （已内置 `Access-Control-Allow-Private-Network: true` 响应头以配合浏览器。）
3. 打开云端站点的「个股长期跟踪 / 技术分析」页面。若顶栏显示「行情未连接」：
   - **Chrome/Edge**：点击地址栏右侧的「页面信息/盾牌」图标 → 网站设置 →
     将 **“不安全内容（Insecure content）”** 设为 **允许**，刷新页面。
   - 仍不行时，可直接用本地方式打开（见下）。

> **最稳妥的方式**：需要实时行情时，直接在本机用浏览器打开本地文件
> （`file://…/index.html`）或本地静态服务，与本机桥接同为本地环境，
> 不受混合内容限制。云端版本则适合随时随地查看计算器、组合与手动/示例数据。

## 四、可选：自定义域名

在 Pages 项目 → **Custom domains** → 添加你的域名，按提示在 DNS 加一条
CNAME 即可（若域名也在 Cloudflare 托管，会自动配置）。

## 备注

- 仓库根目录的 `_headers` 用于 Pages 的缓存与基础安全头配置。
- `bridge.py` 与测试文件也会被一并托管为静态文件，其中不含任何密钥；
  如不希望公开，可在 Pages 项目设置中排除，或将它们移出部署分支。
