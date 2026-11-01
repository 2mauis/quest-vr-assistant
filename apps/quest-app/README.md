# Quest 原生 MR App

这是已确认产品主线的后续实现入口，目前没有 Android 工程或可安装 APK。[完整方案](../../docs/08-native-spatial-options.md)、[里程碑](../../docs/07-milestones.md)和[实机证据](../../docs/validation-baseline.md)定义范围与顺序。

自研 App 负责 Quest 本机 MCP、空间面板与布局、透视视觉联动、服务 / 隧道就绪，以及联动启动已安装的 Grok Bot App。语音、对话和账号复用 Grok Bot，不另接模型 API。

优先评估 Meta Spatial SDK + Compose。Tunnel 先通过独立实机健康探针，再验证 APK 内管理；若内置受限，可评估自动启动的后台辅助组件。两款日常交互 App 不限定两个 APK，尚未选择或安装辅助组件。

现有 `apps/web-display` 仅保留协议及回执的桌面验证用途；它不再决定是否启动原生路线。原生多面板、真实空间锚点、视觉新帧、双 App 共存和生命周期均需实机验收。
