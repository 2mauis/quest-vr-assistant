# Quest 原生 MR App

这是已确认产品主线的实现入口。[Tunnel 诊断 APK](tunnel-probe/README.md)已构建并通过 Quest App UID、公网健康回环与基本停止验证；正式 MR 工程尚未实现。[完整方案](../../docs/01-native-spatial-plan.md)、[里程碑](../../docs/02-milestones.md)和[实机证据](../../docs/03-validation-baseline.md)定义范围与顺序。

自研 App 负责 Quest 本机 MCP、空间面板与布局、透视视觉联动、服务 / 隧道就绪，以及联动启动已安装的 Grok Bot App。语音、对话和账号复用 Grok Bot，不另接模型 API。

优先评估 Meta Spatial SDK + Compose。当前诊断 APK 使用普通 Android Activity / 前台 Service 和随包安装的原生子进程，未选择 MR 技术栈。用户明确继续验证 APK 内置路线；两款日常交互 App 不限定两个 APK，尚未选择或安装后台辅助组件。

现有 `apps/web-display` 仅保留协议及回执的桌面验证用途；它不再决定是否启动原生路线。原生多面板、真实空间锚点、视觉新帧、双 App 共存和生命周期均需实机验收。
