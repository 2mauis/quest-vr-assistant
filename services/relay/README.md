# 本地协议验证服务

此 Node 进程是阶段 1 的中继。2026-11-01 已拍板：网页语音先调用本进程的 `/mcp`，头显取得 `delivered: true` 之后，才把 MCP 迁入 APK。[决策](../../docs/05-decisions.md)与[评审](../../docs/06-native-spatial-review.md)记录边界。它还不是 Quest 原生运行时。

`src/index.js` 加载 MCP、配对、WebSocket、有界内存队列，并提供 Vite 构建后的网页显示。先执行 `npm run build:display`，或直接 `npm start`。`HOST` / `PORT` 提供显示、配对与 WebSocket；`TUNNEL_HOST` / `TUNNEL_PORT` 只处理精确 `/mcp`，其他路径返回 404。两个监听均只允许 localhost。

## 启动与配置

在仓库根目录执行 `npm ci` 安装锁定依赖。环境变量模板为 [.env.example](.env.example)，启动器只读取已导出的环境，不会自动读取模板或 `.env` 文件。真实值只放在当前 shell 或仓库外的私有文件；两项秘密至少各 32 字符、互不相同且不能保留占位符。

```sh
export HOST=localhost
export PORT=8787
export TUNNEL_HOST=localhost
export TUNNEL_PORT=8788
export PUBLIC_BASE_URL=http://localhost:8787
export MCP_BEARER_SECRET='<PLACEHOLDER>'
export DEVICE_PAIRING_TOKEN='<PLACEHOLDER>'
./scripts/start-local.sh
```

替换私有环境中的占位符后启动。浏览器打开 `http://localhost:8787/`，用配对口令连接；另一终端沿用环境执行 `npm run demo` 可调用三个工具。只有渲染 ACK 才返回 `delivered=true`；`queued` 不代表显示成功。当前只保留一个鉴权后的活动显示端，切换后旧端停止自动抢占。

| 配置 | 规则 / 默认值 |
|---|---|
| `HOST`、`TUNNEL_HOST` | 必须为 localhost |
| `PORT`、`TUNNEL_PORT` | 必填且互不相同；自动化测试允许 0 分配随机端口 |
| `PUBLIC_BASE_URL` | 本地 HTTP 仅 localhost；其余须 HTTPS；拒绝 IP、用户信息、查询和片段 |
| `MCP_BEARER_SECRET`、`DEVICE_PAIRING_TOKEN` | 必填、至少 32 字符、不同、无首尾空白、非占位符 |
| `ALLOWED_ORIGINS`、`ASSET_ALLOWED_ORIGINS` | 可选，逗号分隔精确来源，不接受通配符；显示自身来源不会放行 MCP 端口 |
| `SESSION_TTL_SECONDS`、`PAIRING_TTL_SECONDS` | 默认 900 / 600 秒 |
| `DEVICE_GRANT_TTL_SECONDS` | 默认 7776000 秒（90 天），范围 1 小时至 365 天；仅用于已选择记住配对的显示设备 |
| `PAIRING_MAX_ATTEMPTS`、`PAIRING_RATE_PER_MINUTE` | 默认 5 / 5 |
| `QUEUE_MAX_MESSAGES`、`QUEUE_TTL_SECONDS` | 默认 100 条 / 300 秒 |
| `IDEMPOTENCY_TTL_SECONDS`、`ACK_WAIT_MS` | 默认 300 秒 / 2000 毫秒 |
| `MCP_RATE_PER_MINUTE`、`LOG_LEVEL` | 默认 60 / info；日志级别 error、info、debug |

真实校验和范围由 [config.js](src/config.js) 执行，正文上限 256 KiB。SIGTERM 关闭监听；短期会话、队列和幂等状态只在内存。原生客户端持有独立的显示恢复授权，可在中继重启或短期会话到期后取得新会话；旧浏览器配对行为不变。恢复授权不包含 MCP 权限，轮换 `DEVICE_PAIRING_TOKEN` 后全部失效；尚无按设备单独撤销的管理接口。日志不记录秘密或面板正文。公网入口与 Quest 探针不由此启动命令创建，当前探针也不连接本服务。

具名 Tunnel 的当前状态、私有凭据分工、固定入口模板与切换步骤见[正式入口说明](../../config/cloudflared/README.md)。`PUBLIC_BASE_URL` 不是 Tunnel 创建 / 启动参数；固定 MCP 入口单独使用 `MCP_PUBLIC_URL`。本机已按用户授权应用精确 `/mcp` 路由并切换 `qvr`；配置 env 本身不会自动创建或应用云端路由。

## 基线测试

在仓库根目录执行：

```sh
npm test
npm run test:e2e
```

E2E 首次使用需安装对应的无头浏览器：`npx playwright install chromium --only-shell`。测试使用随机本地端口与临时秘密并在结束后关闭，输出在忽略的 `test-results/`；模拟 XR 不能代替头显实测。契约见[协议基线](../../docs/04-protocol-baseline.md)。
