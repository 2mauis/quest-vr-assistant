# clear

功能 ID：`clear`。用户入口：显示连接页 / 空间工作区。

操作面：桌面无头验证页面和协议；WebView、沉浸、实体输入与语音焦点在头显实机复验。APK 编译单列。

驱动：mcpCall clear，scope=all；核对 data-panels=0、data-scene 为空与截图；scope 可选 scene、panel、all，panel 范围另给 panel_id。现有实现与测试入口：`test/e2e/display.spec.ts`。先读 `test/e2e/global-setup.ts` 与 mcpCall 参数，不直接访问公开显示入口。

证据：桌面 Playwright 截图与 trace；头显 Cast 或 quest-capture 帧，加 build_id、seq、request_id、用户结论。全部原始证据留 `.debug-evidence/`，仅公开脱敏摘要。

已知坑：清除 ACK 也必须等待可见帧。头显状态：待实机验证。
