# MCP 协议验证模块

由 [本地验证服务](../relay/README.md) 同一进程加载，不独立监听。负责 Streamable HTTP、`server/discover`、工具发现及调用，接受 `2026-07-28` 与 `2025-11-25` 两种协议流程，详见[协议基线](../../docs/04-protocol-baseline.md)。

鉴权在进入本模块前由服务检查。模块不执行工具参数中的代码，不代理其他连接器凭据；收到渲染 ACK 前 `delivered` 为 false。现有代码是原生显示客户端的契约参考，消费方式见[评审](../../docs/06-native-spatial-review.md)。它不代表已有 Android MCP、视觉输入或语音实现。
