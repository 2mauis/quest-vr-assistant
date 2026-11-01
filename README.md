# Quest 原生 MR 空间助手

> 对照主线中继与六段里程碑的评审见 [原生空间评审与精炼计划](docs/06-native-spatial-review.md)。下文保留本分支已记录的拓扑，以及 `0.3-browser` 的网页登录 / 语音验收。

已确认的主线是 **Quest 本机 MCP + 自研原生 MR App + 同一 App 入口的 Grok 官方网页**。自研 App 管理空间面板、状态、透视视觉联动与连接就绪；网页作为独立页面，复用官方账号、Bot、对话和语音，不另接模型 API 或重做语音。

工具请求路径：Grok Bot 网页 → 既有托管 Bot / 连接器 → Cloudflare HTTPS 边缘 → Quest 主动建立的 Tunnel → Quest 本机 MCP。Cloudflare 负责通道，本机 MCP 负责授权和工具执行。

用户后续明确将网页放进 MCP App。当前默认通过浏览器 Custom Tabs 在同一 App 任务栈打开独立页面，复用浏览器已有登录；APK 内另保留独立登录的 WebView 备用页。隧道优先内置；若内置不可行但独立组件在 Quest 实测可行，可另行评估后台辅助组件，尚未选定其他载体。

## 当前状态与下一步

**主体开发更新：**`0.4-spatial` 原生显示端已完成首版实现和 APK 构建，包含配对重连、透视、多面板 / 三维预设、模型加载、抓取缩放与按序回执，见[构建与功能范围](apps/quest-app/spatial/README.md)。当前仍未覆盖安装；按用户安排，完整头显与 Grok 联调在主体开发后集中进行。固定具名 Tunnel 已改接现有中继，`qvr` 默认使用它；旧 Quick 通道暂留到连接器交接完成。

GitHub Actions 的 `quest-apk` 流程构建原生主体与诊断组件，并上传 APK、哈希清单和测试报告；`ci` 检查中继与桌面显示。下载方式、官网入口配置和 CI 临时签名边界见[自动构建说明](apps/quest-app/spatial/README.md#github-actions-构建)。

产品拓扑已经确认，原生工作区首版已构建、实机待验。**Quest App 内置 Tunnel 最小验证已通过**：自研诊断 APK 在 Quest 3 / Android 14 / API 34 / ARM64 的 App UID 下启动随包安装的组件，建立 4 条 Tunnel 连接；外部 HTTPS 健康响应的运行码、请求码与 App 私有回执一致。

适配基于 `cloudflared` 2026.10.7，使用当前网络已有 DNS 和 Android 系统 CA，保留正常 TLS 校验。重复启动、停止、重新启动、15 秒超时及主进程异常退出均有实机证据。该轮探针结束后撤下临时健康路由并卸载测试 APK，保留专用云端配置和本地构建产物；后续网页版本已重新安装并保留。阶段 1 的下一步是网页语音经现有中继触发三个工具，并在头显上取得 `delivered: true`。运行时为 Spatial SDK + Compose。把 MCP 迁入 APK 排在这次回执之后。详见[决策](docs/05-decisions.md)和[评审](docs/06-native-spatial-review.md)。

**网页登录与语音体验已通过用户实机验收：**当前版本 `0.3-browser` 从连接页打开官方网页，复用浏览器登录与麦克风授权。已有自动化证据覆盖 Bot 页面、音轨获取 / 释放、关闭后恢复连接页及重新打开；实际网页语音由用户确认通过。备用 WebView 的麦克风、本机 WebRTC 回环及退出释放另有验证，其登录存储仍独立。正式 Quest MCP 工具服务、MR / 视觉联动尚未接入。原版 Grok APK 的 Google Play 限制保留为历史问题，改包 / Root 路线已经停止。详情见[实机记录](docs/03-validation-baseline.md)。

1. [原生 MR 方案与责任边界](docs/01-native-spatial-plan.md)
2. [里程碑与验收顺序](docs/02-milestones.md)
3. [历史验证与当前实机证据](docs/03-validation-baseline.md)
4. [实现中的协议基线](docs/04-protocol-baseline.md)
5. [已确认决策及待验证项](docs/05-decisions.md)
6. [原生空间评审与精炼计划](docs/06-native-spatial-review.md)

正式 Cloudflare 入口的当前状态、env / 令牌分工及切换步骤见[具名 Tunnel 配置](config/cloudflared/README.md)。已验证固定入口的鉴权 / 工具发现与路径隔离；Grok 连接器与新原生显示的联合验收另行记录。

## 保留的验证代码

现有 Node 中继、MCP 模块和桌面显示代码保留为协议及回执验证基线。它们不代表原生产品运行时，也未证明能直接移入 Android。已调通检查点是 `dca4f9e`，现有归档分支 `archive/webxr-mvp-2026-11-01` 保持不动；原生方案工作在 `docs/native-spatial-options-2026-11-01`。

- [本地验证服务与环境变量](services/relay/README.md)：启动、端口隔离、配置与测试。
- [MCP 模块](services/vr-mcp-server/README.md)：三个显示工具及 ACK 契约。
- [原生 App 目录](apps/quest-app/README.md)：包含可构建的原生工作区与既有网页 / Tunnel 诊断组件；实机联合验收待完成。

旧 VPS / Caddy / systemd 部署示例、容器构建文件及旧路线文档已从当前分支移除；历史由 Git 保留。现有运行服务、脚本、代码和锁文件未因此改变。
