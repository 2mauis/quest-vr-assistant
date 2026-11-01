# 交互事件

显示页上的鼠标点击和 WebXR 控制器 `select` 通过 WebSocket 发给中继，类型为 `interaction`。正文只含 `kind`（`select` 或 `activate`）和 `target_id`。当前页面发送 `select`：命中面板时使用 `panel_id`，命中预设时使用预设名，自定义模型使用 `model`。服务校验格式后记在内存里，并回复 `interaction_ok`。

这是接口占位。进程不根据事件调用外部地址，也不把事件当作新的对话。本机调试可以查看 `GET /api/debug/interactions`；该路径只在显示端口上，隧道端口返回 404。
