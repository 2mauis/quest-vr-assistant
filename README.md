# Quest 原生 MR 空间助手

已确认的主线是 **Quest 本机 MCP + 自研原生 MR App + 已安装的 Grok Bot App**。自研 App 管理空间面板、状态、透视视觉联动与连接就绪，启动联动 Grok Bot，复用其语音、对话和账号；不另接模型 API 或重做语音。

工具请求路径：Grok Bot App → 既有托管 Bot / 连接器 → Cloudflare HTTPS 边缘 → Quest 主动建立的 Tunnel → Quest 本机 MCP。Cloudflare 负责通道，本机 MCP 负责授权和工具执行。

日常交互围绕两款 App。隧道优先内置自研 APK；若内置不可行但独立组件在 Quest 实测可行，可在部署阶段配置自动启动的后台隧道辅助组件，用户无需手动打开。安装包或系统进程数量不固定为两个，也未选定 Termux 等载体。

## 当前状态与下一步

产品拓扑已经确认，原生 App 尚未实现。当前已授权仓库整理和隔离的 Quest Tunnel 健康探针；先提交仓库，再继续实机连通验证。探针仅返回固定无敏感响应，不连接现有 MCP、显示、配对或私有服务，不配置永久入口或开机自启。

Quest 3 已识别为 Android 14 / API 34 / ARM64。官方 `cloudflared` 2026.10.7 在 ADB shell 下可执行，设备本地健康端点可响应；公网 HTTPS 回环仍待实测。这不能证明 App UID 下的运行、自动启动、APK 内置或休眠恢复可行。

1. [原生 MR 方案与责任边界](docs/08-native-spatial-options.md)
2. [里程碑与验收顺序](docs/07-milestones.md)
3. [已确认决策及待验证项](docs/decisions.md)
4. [实现中的协议基线](docs/protocol-baseline.md)
5. [历史验证与当前实机证据](docs/validation-baseline.md)

## 保留的验证代码

现有 Node 中继、MCP 模块和桌面显示代码保留为协议及回执验证基线。它们不代表原生产品运行时，也未证明能直接移入 Android。已调通检查点是 `dca4f9e`，现有归档分支 `archive/webxr-mvp-2026-11-01` 保持不动；原生方案工作在 `docs/native-spatial-options-2026-11-01`。

- [本地验证服务与环境变量](services/relay/README.md)：启动、端口隔离、配置与测试。
- [MCP 模块](services/vr-mcp-server/README.md)：三个显示工具及 ACK 契约。
- [原生 App 目录](apps/quest-app/README.md)：后续实现入口，目前没有可安装 APK。

旧 VPS / Caddy / systemd 部署示例、容器构建文件及旧路线文档已从当前分支移除；历史由 Git 保留。现有运行服务、脚本、代码和锁文件未因此改变。
