# MCP 定义、鉴权与传输

> 待 VPS 改版更新：公网传输及运行参数待部署复核。

## 传输契约

公网入口为 `https://vr.example.com/mcp`，设备入口为 `wss://vr.example.com/ws`。MCP 采用 Streamable HTTP：实现初始化、版本协商、tools/list 与 tools/call；POST 支持 JSON 和协商后的 SSE 响应。GET 事件流与 DELETE 会话行为按锁定的协议版本实现；不支持时返回规范允许的状态，不伪装成功。SSE 是该传输的流式响应形式，不把旧版双端点 SSE 当作同一协议。Grok Bot 支持版本、请求头鉴权和事件流能力须在 M0 验证。

检查 Accept、Content-Type、协议版本与会话标识；会话 ID 不作为凭据。检查 Origin：拒绝非白名单浏览器来源，无 Origin 的云端调用仍须鉴权。传输断线重连不等于自动重试有副作用的工具。

## 最小工具草案

以下均为待实现契约。所有 schema 使用 object、明确 required、additionalProperties=false；不开放任意工具名或动态代码。

| 工具 | 输入字段与约束 | 结果 |
|---|---|---|
| render_panel | request_id、panel_id、markdown 必填；title 可选 ≤100 字；markdown ≤20000 字；position 为 front/left/right；width_m 为 0.3–2 | 渲染或替换指定面板 |
| update_panel | request_id、panel_id、markdown 必填；append 布尔默认 false；更新后总长 ≤20000 字 | 更新现有面板；不存在时报错 |
| clear_panel | request_id、panel_id 必填 | 幂等删除指定面板，不提供隐式全部删除 |
| show_3d_model | request_id、panel_id、url 必填；仅受控 HTTPS 资产；scale 为 0.1–3 | 待 M5 实现；MVP 不宣告支持 |
| show_chart | request_id、panel_id、kind、data 必填；kind 为 line/bar/pie；data ≤1000 个有限数值点 | 待 M5 实现；不接收可执行图表表达式 |
| get_device_status | 空对象 | 在线、会话可用、最后确认时间与 app 版本；不含身份和生物特征 |

标识字段限 1–64 个 ASCII 字母、数字、下划线或短横线。每个 MCP 身份在服务端绑定唯一授权设备；不允许由 tool 参数自行选择其它设备。MVP 只在 tools/list 注册四个已实现基础工具。

示例 schema（数据契约，不是业务代码）：

```json
{
  "name": "render_panel",
  "description": "在已授权头显上显示受限 Markdown 面板",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["request_id", "panel_id", "markdown"],
    "properties": {
      "request_id": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,64}$"},
      "panel_id": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,64}$"},
      "markdown": {"type": "string", "maxLength": 20000},
      "title": {"type": "string", "maxLength": 100},
      "position": {"type": "string", "enum": ["front", "left", "right"]},
      "width_m": {"type": "number", "minimum": 0.3, "maximum": 2}
    }
  }
}
```

## 返回值与确认语义

工具结果通过 MCP content 文本携带 JSON；若协商版本支持，再同时提供 structuredContent。约定字段为 request_id、status、seq、delivered、error_code。status 为 queued/rendered/offline/expired/rejected；只有 app 完成渲染且 ack 后，delivered 才为 true。等待 ack 最长 2 秒，超时返回 queued 和 delivered=false，不能把进入队列当作已显示。设备离线默认不排队、返回 offline；MCP 工具业务失败设置 isError，协议错误使用 JSON-RPC 错误。

request_id 在每设备 5 分钟内幂等；重复请求返回已有结果，重复 ID 携带不同内容则拒绝。工具不得等待设备无限期上线。

## WSS 协议与上行

消息包含 v、session_id、request_id、seq、type、body。服务端下行 type 为 render/update/clear/model/chart；app 上行为 ack/resume/utterance；双方支持 ping/pong。seq 在设备会话内递增，ack 只代表已经应用的最大连续序号。最多保留最近 100 条、最长 5 分钟；溢出或重启后提供受限面板快照并切换会话，不盲目跳过序号。快照不含对话历史或声纹。

重连退避 1、2、4、8、16、30 秒并加 ±20% 抖动；25 秒心跳，60 秒无响应判定断线。app 用 request_id/seq 去重；本地授权会话过期后不重放敏感内容。队列与幂等记录仅在内存，进程重启后新建会话并清空面板。

utterance 只包含验证后的文本、会话标记与请求 ID，不传原始音频或声纹分数。Node 仅向运维预置 webhook 发起请求，文本不是目标 URL。以请求 ID 去重；webhook 运行不确定时不得自动反复重试。routine 必须携带关联 ID 调用显示工具。云端会话连续性与触发授权待 M0 验证。

## 鉴权

待 VPS 改版更新：优先按远程 MCP 客户端实际支持能力选择标准授权；若仅支持预配置 Bearer 头，先验证兼容性再启用。示例值只写 `<PLACEHOLDER>`；不在 URL 查询参数或访问日志里携带凭据。MCP 凭据、设备凭据、会话签名密钥、webhook 凭据必须分离。授权缺失返回 401，无设备权限返回 403。若客户端要求 OAuth，必须先实现其要求的发现与授权流程，不能以静态头假装满足规范。

机主在受控管理入口创建一次性配对码，最长 10 分钟有效、最多 5 次尝试；app 换取可撤销设备凭据，持久凭据以本地加密存储保护。连接前换取最长 15 分钟的设备会话凭据，通过请求头发送。限流、撤销与过期检查覆盖配对、续期、WS 握手和每次 MCP 调用；撤销后主动关闭连接。公网不开放创建配对码或撤销设备的管理接口。

正文上限 256 KiB，WS 每条上限 256 KiB，基础限流每凭据每分钟 60 次、配对入口每分钟 5 次并限制并发；返回 429 和退避提示。资产限制下载体积、重定向和解析资源；禁用 HTML、脚本及跨连接器隐式执行。
