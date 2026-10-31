# Quest 3 显示层

本地可运行的显示链路：托管端通过 MCP 调用 `show_scene`、`render_panel` 和 `clear`；本机 Node 进程把命令经 WebSocket 推到浏览器里的 three.js 页面。页面按 WebXR 方式编写，便于以后放到头显浏览器。语音和对话留在托管端的 Grok Bot，本仓库不实现模型 API 客户端。

**待 VPS 改版更新**：公网正式部署仍是 VPS 上的 Caddy + Node，Node 由 systemd 管理。当前调试阶段只在本机监听。

## 本地启动

一个进程同时提供显示页、中继和只含 `/mcp` 的隧道端口。秘密没有默认值，未设置时进程拒绝启动。

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

两个秘密各自至少 32 个字符，并且不能相同。在本机生成后只放在当前 shell 或私有环境文件里，不要写入仓库。

浏览器打开 `http://localhost:8787/`，输入 `DEVICE_PAIRING_TOKEN`，再点连接。显示页、WebSocket 和配对只在 `PORT` 上。`TUNNEL_PORT` 只接受路径正好是 `/mcp` 的请求，其它路径返回 404。

## 临时隧道与自定义连接器

快速隧道会转发整个来源端口，因此把隧道指到只提供 MCP 的端口：

```sh
cloudflared tunnel --url http://localhost:8788
```

在托管端添加自定义 MCP 连接器时填写：

| 字段 | 值 |
|---|---|
| URL | `https://<random>.example.com/mcp` |
| 请求头 | `Authorization` |
| 请求头的值 | `Bearer <PLACEHOLDER>` |

`<random>.example.com` 换成隧道命令打印出来的主机名。令牌换成 `MCP_BEARER_SECRET`。不要把令牌放进 URL。本仓库不启动隧道，也不做公网部署。

## 调用三个工具

服务已启动并且浏览器已连接时，在另一个 shell 里沿用同一组环境变量：

```sh
node scripts/demo-tools.mjs
```

脚本按 2026-07-28 调用 `show_scene`、`render_panel` 和 `clear`，并打印 `status`、`seq` 和 `delivered`。`delivered` 为 true 只表示显示页已经确认该序号。没有确认时结果是 `queued`，不能当成已经显示。

## 环境变量

| 变量 | 规则 |
|---|---|
| `HOST` / `PORT` | 显示页、WebSocket、配对。只允许 `localhost` |
| `TUNNEL_HOST` / `TUNNEL_PORT` | 仅 `/mcp`。只允许 `localhost`，且与 `PORT` 不同 |
| `PUBLIC_BASE_URL` | 本地为 `http://localhost:<PORT>`；https 来源使用 example.com 占位 |
| `MCP_BEARER_SECRET` | MCP 的 Bearer 秘密。缺失、过短或仍是占位符时拒绝启动 |
| `DEVICE_PAIRING_TOKEN` | 显示页配对口令。必须与 MCP 秘密不同 |
| `ALLOWED_ORIGINS` | 可选，逗号分隔。页面自身的 `http://localhost:<端口>` 会自动允许 |
| `ASSET_ALLOWED_ORIGINS` | 可选。glTF 的 https 来源必须整段匹配 |
| `ACK_WAIT_MS` | 可选，默认 2000。超时后返回 `queued` |
| `QUEUE_MAX_MESSAGES` / `QUEUE_TTL_SECONDS` | 可选，默认 100 条 / 300 秒 |
| `LOG_LEVEL` | 可选，`error`、`info` 或 `debug` |

完整模板见 [config/.env.example](config/.env.example)。

## 测试

```sh
npm test
npm run test:e2e
```

`npm test` 覆盖启动失败、Bearer 401、隧道端口拒绝非 `/mcp`、2026-07-28 与 2025-11-25 的工具调用，以及断线后的序号补发。`npm run test:e2e` 用无头浏览器打开显示页，调用三个工具，并确认画面从空场景变为预设场景、补发面板，再被清除。本次自动化结果写在交付说明里；未在头显或托管端实机上跑过的项目不能写成已通过。

## 阅读顺序

1. [架构](docs/01-architecture.md)
2. [显示页](docs/02-vr-app.md)
3. [交互事件](docs/03-interaction.md)
4. [MCP 契约](docs/04-mcp.md)
5. [VPS 部署契约](docs/05-vps-relay.md)与[检查表](deploy/vps-checklist.md)
6. [费用](docs/06-cost.md)、[里程碑](docs/07-milestones.md)、[决策](docs/decisions.md)

施工入口：[显示页](apps/web-display/index.html)、[MCP 模块](services/vr-mcp-server/README.md)、[中继进程](services/relay/README.md)、[Caddy 示例](deploy/caddy/Caddyfile.example)、[systemd 示例](deploy/systemd/vr-mcp-relay.service.example)。
