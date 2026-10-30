# Node 中转宿主施工边界

> 待 VPS 改版更新：公网中转仅使用 VPS、Caddy 与 systemd。

当前只有说明，无业务代码。以后产物契约为 /opt/vr-mcp-relay/dist/index.js，由一个 Node 进程承载 MCP 模块、WSS、配对、设备会话、队列、健康检查和受控 webhook 发送。接收 SIGTERM 后停止新请求、有限排空并退出。

环境文件每项均需解析校验；缺失、占位或非法值应拒绝启动，不在错误日志中打印值。以下是 [模板](../../config/.env.example)的填写契约：

| 变量 | 私有部署值或规则 |
|---|---|
| NODE_ENV | production |
| HOST / PORT | localhost / 8787，仅回环监听 |
| PUBLIC_BASE_URL | https://vr.example.com，私有部署替换 |
| STATE_DIR | /var/lib/vr-mcp-relay |
| MCP_AUTH_MODE | 静态头模式为 bearer；其它模式须先实现并通过兼容验证 |
| MCP_BEARER_SECRET | <PLACEHOLDER>，独立生成与轮换，不用作设备凭据 |
| DEVICE_SESSION_SIGNING_SECRET | <PLACEHOLDER>，独立生成与轮换 |
| ROUTINE_WEBHOOK_URL | https://vr.example.com/routine 为格式占位，必须私有配置真实受信 webhook；不是本服务已实现路由 |
| ROUTINE_WEBHOOK_SECRET | <PLACEHOLDER>，只用于 webhook 请求鉴权，不嵌入 URL |
| ALLOWED_ORIGINS | https://vr.example.com，逗号分隔允许源，禁止通配 |
| ASSET_ALLOWED_ORIGINS | https://vr.example.com，默认关闭任意外部抓取 |
| SESSION_TTL_SECONDS / PAIRING_TTL_SECONDS | 900 / 600 |
| PAIRING_MAX_ATTEMPTS | 5 |
| QUEUE_MAX_MESSAGES / QUEUE_TTL_SECONDS | 100 / 300 |
| LOG_LEVEL | info，脱敏日志 |
| VOICE_API_ENABLED | false，默认不调用付费语音 |
| VOICE_API_SECRET | <PLACEHOLDER>，关闭语音时不使用，开启前私有填写 |
| VOICE_DAILY_BUDGET_USD | 默认 0；开启前由机主确认预算与计量规则 |

URL、枚举、数值范围、密钥强度与模式依赖必须严格检查。所有启用的凭据至少含 32 字节随机熵；禁用模块的占位凭据不得被消费。持久设备授权存储须限制权限、支持撤销；队列与去重表为内存态，重启换会话并清空面板。实现日志脱敏、限流、出站目标固定与 webhook 请求去重，按部署检查表验证。
