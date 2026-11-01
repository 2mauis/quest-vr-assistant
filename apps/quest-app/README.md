# Quest 原生 MR App

这是已确认产品主线的实现入口。[Android 容器](tunnel-probe/README.md)提供连接诊断页和 Grok 官方网页入口。Tunnel 的 App UID、公网健康回环与基本停止已通过历史验证；当前 `0.3-browser` 的网页登录 / 语音体验已获用户实机确认，页面、麦克风和本机 WebRTC 另有自动化证据。正式 MCP / MR 工程仍未完成。[完整方案](../../docs/01-native-spatial-plan.md)、[里程碑](../../docs/02-milestones.md)和[实机证据](../../docs/03-validation-baseline.md)定义范围与顺序。

自研 App 负责 Quest 本机 MCP、空间面板与布局、透视视觉联动及服务 / 隧道就绪。用户选择在此 App 内单独封装官方网页页，复用 Grok 的语音、对话和账号，不另接模型 API。为避免重复登录，默认入口使用浏览器 Custom Tabs，在同一 App 任务栈内复用浏览器会话及权限；真实设备已确认直接进入已有 Bot。备用 WebView 使用自己的登录存储，不导入浏览器 Cookie；原版第三方 APK 保持原样。

优先评估 Meta Spatial SDK + Compose。当前容器使用普通 Android Activity、浏览器 Custom Tabs、备用 WebView、诊断前台 Service 和随包安装的原生子进程，未选择 MR 技术栈。浏览器承载的页面不属于可任意嵌入原生布局的 View，同一任务栈导航不代表已经实现 MR 空间面板。

现有 `apps/web-display` 仅保留协议及回执的桌面验证用途；它不再决定是否启动原生路线。下一步是正式 Quest MCP 工具与凭据管理；原生多面板、真实空间锚点、视觉新帧、网页 / MR 共存和休眠恢复均需独立实机验收。
