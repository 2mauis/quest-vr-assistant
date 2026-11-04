# 会前人工清单

先运行 `npm run doctor`。缺工具、设备未授权、中继未就绪或空间不足时先处理；脚本不会安装、授予权限或改变设备设置。

- 打开正确项目，确认 Voice 登录、麦克风、Screen context。
- 人工授权屏幕录制、Screen & System Audio Recording、辅助功能及 Computer Use 各应用首次访问。
- 打开 MQDH Cast，确认清晰度、水印和输入；关闭含敏感信息的窗口与通知。
- 核对实际显示端口后设置 QUEST_RELAY_URL 为 localhost healthz URL；如需日志，设置 QUEST_RELAY_LOG 为本机中继日志文件。
- 确认合并操作使用平台人工审批，禁止自动允许 merge-gate confirm 或 gh pr merge。
- 只保留脱敏摘要；真实日志、视频、确认记录留在被忽略的 `.debug-evidence/`。

上述 GUI、设备和语音能力均待实机验证；doctor 进程检查不证明画面、权限或焦点已经通过。
