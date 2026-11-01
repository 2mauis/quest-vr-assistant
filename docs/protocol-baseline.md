# 已实现的 MCP 与显示协议基线

> 本页描述现有 Node / 桌面验证代码，供原生实现保留语义时参考；不是原生运行时、Quest 语音或隧道已通过的声明。历史证据见[验证记录](validation-baseline.md)。

## 传输

本地 MCP 地址是 `http://localhost:8788/mcp`。正式环境的示例是 `https://vr.example.com/mcp`。实现同时接受两种协议时期：

- `2026-07-28`：无初始化握手、无协议级会话。每个 POST 在 `_meta` 里带 `io.modelcontextprotocol/protocolVersion` 和 `io.modelcontextprotocol/clientCapabilities`，并在 `MCP-Protocol-Version` 头里重复同一版本。`Mcp-Method` 必须与正文方法一致；`tools/call` 还要带与 `params.name` 一致的 `Mcp-Name`。`server/discover` 返回支持的版本。不支持的版本返回 `-32022`，头和正文不一致返回 `-32020`。
- `2025-11-25`：`initialize` 协商版本，响应头 `MCP-Session-Id`，随后发送 `notifications/initialized`。之后的请求带会话头和 `MCP-Protocol-Version: 2025-11-25`。`DELETE /mcp` 结束会话。`GET /mcp` 返回 405，因为这条实现不开放独立的服务端事件流。

两种时期的工具调用都可以用 `application/json` 返回单个 JSON-RPC 对象。请求的 `Accept` 必须同时包含 `application/json` 和 `text/event-stream`。会话标识不是凭据。

浏览器带来的 `Origin` 必须在允许列表中，否则 403。没有 `Origin` 的托管端调用仍要通过 Bearer 校验。显示页自己的 `http://localhost:<显示端口>` 只在显示端口上自动允许，不因此放行 MCP。

## 鉴权

鉴权方式固定为静态 Bearer，不实现 OAuth。令牌只从环境变量 `MCP_BEARER_SECRET` 读取。变量缺失、短于 32 个字符或仍是占位符时，进程拒绝启动。`/mcp` 上缺少令牌或令牌错误都返回 401，响应体相同，比较经过固定长度摘要。配对口令是另一个环境变量 `DEVICE_PAIRING_TOKEN`。

规范中的 HTTP 授权资料描述的是可选的 OAuth 配置。本服务没有实现该配置，也不假装已经完成发现端点。若托管端强制要求 OAuth，需要另一次实现，不能用静态头冒充。

## 工具

schema 都是 object，列出 required，并且 `additionalProperties=false`。标识字段是 1–64 个 ASCII 字母、数字、下划线或短横线。

| 工具 | 输入 | 结果 |
|---|---|---|
| `show_scene` | `request_id`、`anchor` 必填。`preset` 与 `model_url` 恰好一个。`preset` 为 grid/orbit/crystal/pedestal。`model_url` 必须是允许来源上的 https glTF。可选 `pose` | 替换当前三维场景 |
| `render_panel` | `request_id`、`panel_id`、`text` 必填。`text` 最长 20000，`title` 最长 100。拒绝尖括号 | 显示或替换一块纯文本面板 |
| `clear` | `request_id`、`scope` 必填。`scope` 为 scene、panel 或 all。`panel` 还要 `panel_id` | 按 scope 清除 |

`pose.scale` 为 0.1–3，位置分量在 -10 到 10，旋转分量在 -360 到 360。服务端不下载 glTF，因此字节大小不在服务端测量；校验的是协议、主机允许列表、后缀、URL 长度和缩放。

## 结果与补发

工具结果放在 MCP 的 text content 中，并同时给出 `structuredContent`。字段为 `request_id`、`status`、`seq`、`delivered`、`error_code`。`status` 为 queued、rendered、offline、expired 或 rejected。参数错误使用 `isError`，协议错误使用 JSON-RPC 错误。

`request_id` 在 5 分钟内幂等。相同内容返回已有结果；相同标识但内容不同则拒绝。WebSocket 消息包含 `v`、`session_id`、`request_id`、`seq`、`type` 和 `body`。下行 type 为 `show_scene`、`render_panel`、`clear` 和 `snapshot`。页面上行 type 为 `ack`、`resume` 和 `interaction`。双方使用 `ping` 与 `pong`。

每个配对保留最近 100 条、最长 5 分钟。重连时页面提交最后连续序号；缺号时发送当前场景快照，而不是跳号。快照不含外部对话。队列只在内存中。

中继只保留一个已鉴权的活动显示连接。`auth` 通过后才接管，并以关闭码 `4410` 通知旧页面停止自动重连；用户可主动切回。`4401` 表示需要重新配对。旧连接的迟到 ACK 和交互不再处理。页面对下载、渲染和 ACK 串行处理，模型加载失败时暂停，避免后续累计 ACK 把失败命令误记成已显示。

正文上限 256 KiB。每个 Bearer 每分钟 60 次，配对失败每分钟另有上限。超过后返回 429 和 `Retry-After`。

## 交互与恢复边界

显示端 `interaction` 正文只含 `kind`（`select` 或 `activate`）及 `target_id`，校验后留在中继内存并回复 `interaction_ok`。当前选择命中面板使用 `panel_id`，预设使用预设名，自定义模型使用 `model`。它不调用外部地址，也不作为新对话；调试读取只在显示端口的 `/api/debug/interactions`，MCP 端口返回 404。

现有页面刷新时从零请求补发以重建内容，不复用已丢失画面的旧序号；快照允许对齐更低序号。断线重连、设备切换与资源加载失败均必须保留渲染确认边界。当前 `anchor` 只是固定坐标偏移，不是持久真实空间锚点，`head` 尚不随头部移动。

原生多面板布局修改、跨会话真实位置恢复、视觉输入、长期任务与向 Grok 投递交互仍需设计；不能用现有 5 分钟内存队列替代持久状态。

## 联调证据要求

先核对授权与入口隔离，再实际调用工具，将请求、序号、ACK 与画面对齐。`Connected`、工具列表、健康响应或 `queued` 均不能代替显示确认。重试使用正确的幂等语义，避免复用旧请求后误判本次成功。

历史 Grok 托管连接器采用静态 Bearer 的实际调用已通过，详见[验证记录](validation-baseline.md)。连接器配置中的秘密不得进入 URL、命令参数、截图或仓库；TLS 不能替代授权。Quest 语音与原生 App 联调按[新里程碑](07-milestones.md)单独验收。
