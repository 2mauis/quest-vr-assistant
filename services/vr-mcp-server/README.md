# MCP 协议验证模块

由 [本地验证服务](../relay/README.md) 同一进程加载，不独立监听。`src/streamable-http.ts` 使用 `@modelcontextprotocol/server` 2.4.0 的 `createMcpHandler` 和 `@modelcontextprotocol/node` 2.1.2 的 Streamable HTTP 传输，接受 `2026-07-28` 与 `2025-11-25`，详见[协议基线](../../docs/04-protocol-baseline.md)和[双轨架构](../../docs/07-architecture-two-track.md)。

鉴权在进入本模块前由服务检查。模块不执行工具参数中的代码，不代理其他连接器凭据；收到渲染 ACK 前 `delivered` 为 false。现有代码是原生显示客户端的契约参考，消费方式见[评审](../../docs/06-native-spatial-review.md)。它不代表已有 Android MCP、视觉输入或语音实现。

| 文件 | 职责 |
|---|---|
| `src/tool-schemas.ts` | 三个工具的输入 schema 与结果形状；`tools/list` 线上格式由 `test/fixtures/mcp-golden.json` 锁定 |
| `src/validate-tool-call.ts` | 参数校验，失败时给出结构化 `error_code` |
| `src/mcp-server.ts` | 注册工具；SDK 侧只公布 schema 不拦截，拒绝由中继以 `error_code` 返回 |
| `src/streamable-http.ts` | `/mcp` 请求分派：`2026-07-28` 无会话，`2025-11-25` 经 `initialize` 建立会话 |
| `src/legacy-sessions.ts` | 有上限的 2025 会话表，关闭服务时全部关闭 |
