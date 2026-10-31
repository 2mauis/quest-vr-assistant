# Node 中继

> 待 VPS 改版更新：公网中转仅使用 VPS、Caddy 与 systemd。

本目录是进程入口 `src/index.js`。同一进程加载 MCP 模块、WebSocket、配对、内存队列和显示页。`HOST`/`PORT` 提供页面和中继。`TUNNEL_HOST`/`TUNNEL_PORT` 只提供 `/mcp`。

`MCP_BEARER_SECRET` 与 `DEVICE_PAIRING_TOKEN` 没有默认值。缺失、过短、仍是占位符或两者相同，进程都会拒绝启动，并且错误信息里不打印值。

收到 SIGTERM 后停止接收新工作并关闭监听。队列和配对会话只在内存中。日志不记录令牌、配对口令或面板正文。

环境变量见 [config/.env.example](../../config/.env.example)。本地启动命令见 [README](../../README.md)。
