# Quest 3 VR 钢铁侠助手

施工方案文档仓库：独立原生 VR app，以语音交互，在 3D 浮空面板显示回复。只有机主本人通过本地「Hey Friday」唤醒与声纹验证后才能开启会话。本仓库只有文档与配置示例，没有业务代码。

**待 VPS 改版更新**：公网中转唯一方案为 VPS 上的 Caddy + Node，Node 由 systemd 管理。路线 M 将 VR 显示层作为 Grok Bot 的远程 MCP 服务，Git、X 等复用现有连接器。

## 阅读顺序

1. [架构与链路边界](docs/01-architecture.md)
2. [原生 VR app 选型与界面](docs/02-vr-app.md)
3. [本地唤醒与声纹](docs/03-wake-voiceprint.md)
4. [MCP 工具、鉴权与传输](docs/04-mcp.md)
5. [VPS 部署](docs/05-vps-relay.md)与[部署检查表](deploy/vps-checklist.md)
6. [费用](docs/06-cost.md)、[M0–M5 验收](docs/07-milestones.md)、[待拍板决策](docs/decisions.md)

## 施工入口

- [Quest app](apps/quest-app/README.md)
- [VR MCP 服务](services/vr-mcp-server/README.md)
- [中转运行宿主](services/relay/README.md)
- [Caddy 示例](deploy/caddy/Caddyfile.example)、[systemd 示例](deploy/systemd/vr-mcp-relay.service.example)、[环境变量模板](config/.env.example)
- [后续施工约束](AGENTS.md)

## 当前结论与边界

推荐先用 Meta Spatial SDK 制作原生空间面板；Unity 为复杂交互备选，Unreal 暂不优先，WebXR 仅为浏览器备选。不做网页或第三方客户端 APK 套壳；原生应用采用 Android 安装包交付并不等于套壳。

没有 Quest 版 Grok Bot，远程 MCP 又必须由云端访问，因此纯本地方案不成立。MCP 是云端调用显示工具的通路，不能据此假定头显拥有 Bot 对话 API。语音输入暂拟经 routine webhook 触发，支持性、延迟及上下文连续性必须在 M0 验证；失败则记录阻塞并由机主选择取舍。

本次只离线整理两份只读参考资料，不复刻资料，不联网核实版本、价格、平台能力或授权。文中「待核实」不能作为已验证事实。配置仅是未来部署契约，当前尚无可启动的服务产物。所有域名均为示例域名，所有密钥均为占位值。
