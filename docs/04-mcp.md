# MCP 定义、鉴权与传输

> 待 VPS 改版更新：公网传输及运行参数待部署复核。

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

## 连接器联调与故障定位

Apps 显示 Connected、列出三个工具，只能证明连接器已登记过；不能代替一次实际调用。按以下顺序核对：

1. 本地显示页可打开，显示页完成配对后出现「显示中」。中继重启会丢失内存里的配对会话，需要重新配对。
2. 本地与公网 `/mcp` 在不带凭据时均返回 401；公网 `/`、`/ws`、`/api/device/pair` 返回 404。
3. 携带现有 Bearer 请求工具列表成功，再从 Grok Bot 实际调用 `show_scene`、`render_panel`、`clear`。每轮使用新的 `request_id`，避免五分钟幂等窗口复用之前的结果。
4. 将工具结果的序号与显示页收到的命令、发出的 ACK 和画面对应起来。`queued`、`delivered=false` 只说明等待显示确认，不能当作已经显示。

连接器出现 `fetch failed`、中继没有收到新请求时，先检查隧道。进程仍在并不代表隧道可用；边缘注册失败或隧道失效时，须恢复隧道并重新验证公网入口。快速隧道使用临时地址，恢复后要核对连接器里的 URL 是否仍一致。

若 Apps 管理入口不能修改已有 URL，也不能复用旧鉴权，先保留旧连接器，给替代连接器配置同一服务的 Bearer；完成实测后再处理旧项。安全输入表单能保存秘密，不代表远程连接器配置工具能引用该秘密。不要把秘密放在聊天、URL、截图或仓库里。正式 VPS 的稳定地址仍待改版更新。

### Grok Bot 命令式连接器

2026-11-01 已验证的接入方式是：Grok Bot Apps → 托管端 stdio 适配器 → HTTPS `/mcp` → 本机中继 → 桌面显示页。它仍然调用相同的三个工具，服务端继续验证 Bearer。

适配器固定为 `mcp-remote@0.15.2`，使用 `--transport http-only --silent`，不启用 `--debug`。启动器在进程内读取安全环境变量，构造 `AUTH_HEADER`；参数仅携带字面的 `Authorization:${AUTH_HEADER}`，由适配器展开。不要让 shell 提前把真实秘密展开到命令参数。若托管端命令服务没有继承安全变量，启动器可读取同一用户的私有配置文件，权限为 0600，且不得纳入仓库。

注册后的新工具需要在下一条对话中使用。验收必须从 Apps 调用工具，并交叉核对浏览器 ACK 和画面；单独运行 HTTP 请求只用于诊断。临时地址变化后，更新托管端启动器中的目标 URL，重启该连接器，再执行一次显示确认。该适配方式不改变正式 VPS 的部署目标。
