# VR MCP 模块

> 待 VPS 改版更新：由 services/relay 的同一进程加载，不单独监听。

负责 Streamable HTTP、`server/discover`、工具列表和工具调用。协议版本是 `2026-07-28`，并接受 `2025-11-25` 的初始化握手。工具定义以 [MCP 契约](../../docs/04-mcp.md) 为准。

鉴权由中继在进入本模块之前完成。本模块不代理其它连接器的凭据，也不执行工具参数里的代码。显示页确认之前，结果里的 `delivered` 保持 false。
