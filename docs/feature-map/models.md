# 模型加载

功能 ID：`models`。用户入口：显示连接页 / 空间工作区。

操作面：桌面无头验证页面和协议；WebView、沉浸、实体输入与语音焦点在头显实机复验。APK 编译单列。

驱动：show_scene 指定允许来源的 example.com 占位模型；实测时使用已授权模型资产，检查成功帧，以及加载失败时回执 `delivered: false`、后续命令不能把它标成已渲染。现有实现与测试入口：`test/web-display.test.ts`、`test/e2e/quest.spec.ts`。先读对应测试的启动方式（`relay` fixture / `startTestApp`）与 mcpCall 参数，不直接访问公开显示入口。

证据：桌面 Playwright 截图与 trace；头显 Cast 或 quest-capture 帧，加 build_id、seq、request_id、用户结论。全部原始证据留 `.debug-evidence/`，仅公开脱敏摘要。

已知坑：占位模型不可下载，先用预设测基础显示。头显状态：待实机验证。
