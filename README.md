# Quest 原生 MR 空间助手

已确认的主线是 **Quest 本机 MCP + 自研原生 MR App + 已安装的 Grok Bot App**。自研 App 管理空间面板、状态、透视视觉联动与连接就绪，启动联动 Grok Bot，复用其语音、对话和账号；不另接模型 API 或重做语音。

工具请求路径：Grok Bot App → 既有托管 Bot / 连接器 → Cloudflare HTTPS 边缘 → Quest 主动建立的 Tunnel → Quest 本机 MCP。Cloudflare 负责通道，本机 MCP 负责授权和工具执行。

日常交互围绕两款 App。隧道优先内置自研 APK；若内置不可行但独立组件在 Quest 实测可行，可在部署阶段配置自动启动的后台隧道辅助组件，用户无需手动打开。安装包或系统进程数量不固定为两个，也未选定 Termux 等载体。

## 当前状态与下一步

产品拓扑已经确认，正式 MR 工作区尚未实现。**Quest App 内置 Tunnel 最小验证已通过**：自研诊断 APK 在 Quest 3 / Android 14 / API 34 / ARM64 的 App UID 下启动随包安装的组件，建立 4 条 Tunnel 连接；外部 HTTPS 健康响应的运行码、请求码与 App 私有回执一致。

适配基于 `cloudflared` 2026.10.7，使用当前网络已有 DNS 和 Android 系统 CA，保留正常 TLS 校验。重复启动、停止、重新启动、15 秒超时及主进程异常退出均有实机证据。验证结束撤下临时健康路由、卸载测试 APK，保留专用云端配置和本地构建产物。下一步是正式 MCP / 凭据管理、网络恢复、Grok 语音和双 App 共存；这些能力尚未完成。

**Grok 登录当前受阻：**已安装的 Android 版在启动时要求 Google Play，设备未安装相关组件，标准 Launcher 再次启动仍未进入登录页。需要先确认可在此环境运行的官方发行包；包已安装不等于可登录或能完成语音联动。详情见[实机记录](docs/03-validation-baseline.md)。

1. [原生 MR 方案与责任边界](docs/01-native-spatial-plan.md)
2. [里程碑与验收顺序](docs/02-milestones.md)
3. [历史验证与当前实机证据](docs/03-validation-baseline.md)
4. [实现中的协议基线](docs/04-protocol-baseline.md)
5. [已确认决策及待验证项](docs/05-decisions.md)

## 保留的验证代码

现有 Node 中继、MCP 模块和桌面显示代码保留为协议及回执验证基线。它们不代表原生产品运行时，也未证明能直接移入 Android。已调通检查点是 `dca4f9e`，现有归档分支 `archive/webxr-mvp-2026-11-01` 保持不动；原生方案工作在 `docs/native-spatial-options-2026-11-01`。

- [本地验证服务与环境变量](services/relay/README.md)：启动、端口隔离、配置与测试。
- [MCP 模块](services/vr-mcp-server/README.md)：三个显示工具及 ACK 契约。
- [原生 App 目录](apps/quest-app/README.md)：包含可构建的限时 Tunnel 诊断 APK；正式 MR 工作区待实现。

旧 VPS / Caddy / systemd 部署示例、容器构建文件及旧路线文档已从当前分支移除；历史由 Git 保留。现有运行服务、脚本、代码和锁文件未因此改变。
