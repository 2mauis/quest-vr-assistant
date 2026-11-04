# 补发与重连

功能 ID：`reconnect`。用户入口：显示连接页 / 空间工作区。

操作面：桌面无头验证页面和协议；WebView、沉浸、实体输入与语音焦点在头显实机复验。APK 编译单列。

驱动：断开显示 socket 后发面板，检查 queued；恢复后核对连续 seq 与唯一面板。现有实现与测试入口：`test/replay.test.ts`、`test/e2e/display.spec.ts`。先读对应测试的启动方式（`startTestApp` / `global-setup.ts`）与 mcpCall 参数，不直接访问公开显示入口。

证据：桌面 Playwright 截图与 trace；头显 Cast 或 quest-capture 帧，加 build_id、seq、request_id、用户结论。全部原始证据留 `.debug-evidence/`，仅公开脱敏摘要。

已知坑：进程重启没有持久化旧命令。头显状态：待实机验证。
