# Feature Map

以 [双轨架构](07-architecture-two-track.md) 和 [工作流](workflow-v2.md) 为准。运行 `npm run test:e2e -- test/e2e/display.spec.ts` 可由临时秘密、随机端口驱动 show_scene 并在 test-results 中产出截图；global-setup 自动启动中继。不要把生产凭据写入测试。

| ID | 功能 | 入口 |
|---|---|---|
| pairing | 配对与切换 | [pairing](feature-map/pairing.md) |
| show-scene | show_scene | [show-scene](feature-map/show-scene.md) |
| panels | render_panel 与选择 | [panels](feature-map/panels.md) |
| clear | clear | [clear](feature-map/clear.md) |
| reconnect | 补发与重连 | [reconnect](feature-map/reconnect.md) |
| models | 模型加载 | [models](feature-map/models.md) |
| immersive | 沉浸模式 | [immersive](feature-map/immersive.md) |

成功截图由 display.spec.ts 写到 test-results；失败截图与 trace 自动保留。需要长期本地证据时复制到 `.debug-evidence/`，不得上传原始日志。
