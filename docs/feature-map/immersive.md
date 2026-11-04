# 沉浸模式

功能 ID：`immersive`。用户入口：显示连接页 / 空间工作区。

操作面：桌面无头验证页面和协议；WebView、沉浸、实体输入与语音焦点在头显实机复验。APK 编译单列。

驱动：打开页面后进入沉浸；Cast 检查真实画面、实体输入、焦点和网页共存。现有实现与测试入口：`apps/web-display/src/xr/immersive-controller.ts`、`test/xr.test.ts`（用 XR store 替身做单测，不连接中继，桌面 E2E 尚无沉浸用例）。不直接访问公开显示入口。

证据：桌面 Playwright 截图与 trace；头显 Cast 或 quest-capture 帧，加 build_id、seq、request_id、用户结论。全部原始证据留 `.debug-evidence/`，仅公开脱敏摘要。

已知坑：模拟 XR 不算头显通过，DOM 水印在 XR 内待验证。头显状态：待实机验证。
