# Quest 原生 MR App

**最新开发状态：**[Spatial SDK + Compose 主体](spatial/README.md) `0.4-spatial` 已用原签名覆盖安装，并经现有中继取得三个工具的原生回执。真实 VR 投屏已拍到宽屏网页、面板和模型共存；自动化抓取、配对恢复及实体面板命中 / 缩放已有部分证据。实体模型抓取、持续窗口共存、位置自动纠偏和网页语音工具联动仍未完成，见[已完成与待测试清单](../../README.md)。下文 `0.3-browser` 和 Tunnel 探针是历史证据，不能直接覆盖新主体。

这是已确认产品主线的实现入口。[Android 容器](tunnel-probe/README.md)提供连接诊断页和 Grok 官方网页入口。Tunnel 的 App UID、公网健康回环与基本停止已通过历史验证；当前 `0.3-browser` 的网页登录 / 语音体验已获用户实机确认，页面、麦克风和本机 WebRTC 另有自动化证据。正式 MCP / MR 工程仍未完成。[完整方案](../../docs/01-native-spatial-plan.md)、[里程碑](../../docs/02-milestones.md)、[实机证据](../../docs/03-validation-baseline.md)和[原生空间评审](../../docs/06-native-spatial-review.md)定义范围与顺序。

自研 App 负责 Quest 本机 MCP、空间面板与布局、透视视觉联动及服务 / 隧道就绪。用户选择在此 App 内单独封装官方网页页，复用 Grok 的语音、对话和账号，不另接模型 API。为避免重复登录，默认入口使用浏览器 Custom Tabs，在同一 App 任务栈内复用浏览器会话及权限；真实设备已确认直接进入已有 Bot。备用 WebView 使用自己的登录存储，不导入浏览器 Cookie；原版第三方 APK 保持原样。

显示运行时仍使用 Meta Spatial SDK。双轨重构之后，Grok 继续由浏览器 Custom Tabs 承载，不把官方网页嵌进场景；三维内容改为中继提供的网页显示，放在空间 WebView 面板里。连接页、备用 WebView 和可选诊断组件仍然保留。

`apps/web-display` 是这条网页显示，不再只是对照页。阶段 1 仍先让网页语音经现有中继触发三个工具，并在头显上取得 `delivered: true`；把 MCP 迁入本 APK 排在这次回执之后。原生多面板、真实空间锚点、视觉新帧和休眠恢复仍需独立实机验收。详见[双轨架构](../../docs/07-architecture-two-track.md)。
