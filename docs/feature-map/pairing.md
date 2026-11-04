# 配对与切换

功能 ID：`pairing`。用户入口：显示连接页 / 空间工作区。

操作面：桌面无头验证页面和协议；WebView、沉浸、实体输入与语音焦点在头显实机复验。APK 编译单列。

驱动：连接页输入临时配对凭据，点击连接；第二显示端接管后检查旧端停止重连。现有实现与测试入口：`test/device-grants.test.ts、test/e2e/quest.spec.ts`。先读对应测试的 global-setup 与 mcpCall 参数，不直接访问公开显示入口。

证据：桌面 Playwright 截图与 trace；头显 Cast 或 quest-capture 帧，加 build_id、seq、request_id、用户结论。全部原始证据留 `.debug-evidence/`，仅公开脱敏摘要。

已知坑：不得公开凭据；4410 不自动抢回。头显状态：待实机验证。
