# render_panel 与选择

功能 ID：`panels`。用户入口：显示连接页 / 空间工作区。

操作面：桌面无头验证页面和协议；WebView、沉浸、实体输入与语音焦点在头显实机复验。APK 编译单列。

驱动：调用 render_panel，设置 panel_id/title/text；同 ID 更新、不同 ID 并存；选择后核对私有 interactions。现有实现与测试入口：`test/e2e/display.spec.ts、test/e2e/quest.spec.ts`。先读对应测试的 global-setup 与 mcpCall 参数，不直接访问公开显示入口。

证据：桌面 Playwright 截图与 trace；头显 Cast 或 quest-capture 帧，加 build_id、seq、request_id、用户结论。全部原始证据留 `.debug-evidence/`，仅公开脱敏摘要。

已知坑：纯文本；interaction 不上传 Bot。头显状态：待实机验证。
