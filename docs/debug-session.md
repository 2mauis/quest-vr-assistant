# 调试采集与阶段验收

运行 `npm run doctor`，失败项处理后重跑。脚本只读检查，不授予权限、不安装组件、不改网络、不输出设备标识或 gh 凭据。会前人工权限与环境变量见 [会前人工清单](session-checklist.md)。

采集：`npm run quest-capture -- 10`（秒数 1–180，可选 `--source adb|mqdh`、`--eye left|right|both`）；需要 PATH 上的 adb 与 ffmpeg 和唯一已授权设备。默认保留完整画面；显式选择单眼时假设双眼横排裁剪，再以 2 fps 输出逐帧和拼图。单眼/不同布局须先验证，不能盲信裁剪；`--source mqdh` 不支持显式 `--eye`，同用时报错。`--source mqdh` 导入最近五分钟的最新 mp4；可用 `QUEST_MQDH_CAPTURES` 指定目录。MQDH 先手动录制再导入，logcat 和可选 `QUEST_RELAY_LOG` 切片仅覆盖导入时段，不能冒充录制时段日志。每次运行在被忽略的 `.debug-evidence/<ISO 时间>/` 下生成 `capture.mp4`、`frame-*.jpg`、`contact-sheet.jpg`、`logcat.txt`、`manifest.json` 及可选 `relay.log`，采集可能含系统 UI，分享前必须裁剪与脱敏。

显示构建运行 `npm run build:display`，`?debug=1` 开水印，默认隐藏；水印依次显示 build_id、构建时间、seq 和最近一次状态更新时刻。body 的 `data-build-id`、`data-built-at` 总是可查，显示端 `/api/debug/build` 返回构建文件。同一 SHA 的未提交变更无法靠 SHA 区分，须结合构建时间。DOM 水印在沉浸 WebXR 中是否可见待验证。

阶段 0 验证方法（状态、日期与脱敏证据统一记在 [验证记录表](workflow-v2-validation.md)）：

| 项目 | 方法 |
|---|---|
| R2 语音审批 | 无害需审批操作，观察语音批准 |
| R3 强制合并审批 | 各权限模式验证，不能保证则手动合并；脚本不能强制平台审批 |
| R4 Cast 输入 | 点击并在头显确认响应 |
| R5 Appshot 水印 | 读取当前 build_id，与 API 比对 |
| R6 screenrecord | 十秒录制，核对分辨率、眼别、延迟、佩戴状态 |
| R7 任务目录 | 语音派发后核对仓库目录 |
| R8 归档读取 | 检查既有归档接入 |

阶段 1：脚本、功能地图与 CI 落库不代表语音闭环通过。需真实说出看画面 / 录十秒，返回正确帧与水印，记录同一 seq 的画面及用户结论。没有首包分位数样本。
