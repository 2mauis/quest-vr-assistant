# 质量审计：`6986cb0` 双轨显示重构

审计对象是 `refactor/display-two-track-2026-11-01` 的 HEAD `6986cb0`。范围为 `apps/web-display`、`services/vr-mcp-server`、作为运行依赖的 `services/relay`、`apps/quest-app/spatial` 薄壳及其编进同一 APK 的诊断前台服务，以及测试、脚本和 CI。行号指该提交中的文件。

严重度：**高**＝会造成崩溃、泄漏、安全边界失效或虚报 `delivered`；**中**＝缺陷或结构问题会明显增加出错概率；**低**＝可读性、重复或小的一致性问题。

本次重写的外部约束不变：三个工具名及输入 / 输出 schema、`seq` / ACK / `delivered`、关闭码 `4410`、Bearer 401、`server/discover` 与 `-32022` 只列 `2026-07-28` 而 `2025-11-25` 走 `initialize`，`hub.js` 留在 Node，`DisplayEngine` 与预设 GLB 保持删除。

## 网页显示 `apps/web-display`

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| W1 | `src/*.js`、`src/*.jsx`、`index.html:10` | 全部为无类型 JS / JSX，没有类型检查、ESLint 或格式化 | 中 |
| W2 | `src/session.js:11-397` | 约 390 行的单个闭包同时负责 WebSocket 传输、心跳、重连、配对 HTTP、场景 / 面板状态、渲染门控和按钮状态，无法脱离浏览器做单元测试 | 高 |
| W3 | `src/session.js:40-42` | `/api/display/config` 只在构造时取一次，不检查 `response.ok`，错误被吞掉；失败后允许来源为空，之后每个模型都以 `model_origin` 失败且不重试 | 中 |
| W4 | `src/session.js:44-52`、`74-78` | `snapshot()` 与首次 `subscribe` 回调交出可变内部对象，后续 `emit` 才交副本；React 可能拿到被原地修改的状态 | 中 |
| W5 | `src/session.js:119-123` | `waitAsset` 没有超时；模型请求挂起时串行命令链永久阻塞，后续命令既不 ACK 也不报错 | 高 |
| W6 | `src/session.js:208-230` | 页面不检查 `seq` 连续性：重复消息被再次应用并再次 ACK，缺号消息被直接应用而不发送 `resume` | 中 |
| W7 | `src/session.js:182-185` | 面板 React key 含整段正文（最长 20000 字）和代际，每次更新都重建 uikit 树 | 低 |
| W8 | `src/session.js:344-347` | 配对响应未校验 `session_token` 类型与格式 | 低 |
| W9 | `src/session.js:232-248` | 断开时不清理挂起的帧等待者，Promise 永不结束 | 低 |
| W10 | `src/session.js:60-66` | 按钮禁用 / 隐藏标志由传输层命令式计算并存进会话状态 | 低 |
| W11 | `src/main.jsx:28-33`、`src/xr-entry.js:3-72` | React 组件里用 `document.querySelector` 绑定沉浸按钮，`<select>` 由 React 渲染又被外部代码直接改写 | 中 |
| W12 | `src/scene.jsx:71-77` | `useGLTF` 加载的场景在换模型或清除后既不 dispose 也不移出缓存，几何体、材质、纹理随每次 `show_scene` 累积 | 高 |
| W13 | `src/scene.jsx:79-93`、`124-138` | 面板文字放在 `Suspense` 内：字体 / 布局仍在挂起时帧门控已放行 ACK；`PanelError` 吞掉 uikit 异常后仍 ACK。两种情况都会在正文未画出时返回 `delivered: true` | 高 |
| W14 | `src/scene.jsx:144-165` | 手写 `Raycaster` 点击拾取与 R3F 事件系统重复，并在 `gl.xr.isPresenting` 时直接返回，沉浸模式下完全无法选择 | 中 |
| W15 | `src/scene.jsx:168-178` | `Backdrop` 用两段互相覆盖的条件给 `scene.background` 赋值 | 低 |
| W16 | `src/scene.jsx:180-184` | 每帧 `notePaint` 依赖“微任务在 `gl.render` 之后执行”的时序，代码和注释都没有说明 | 低 |
| W17 | `src/anchors.js:1-8` | 锚点表与服务端枚举各写一份；未知锚点静默落到 `world` | 低 |
| W18 | `src/xr-entry.js:9`、`26` | 对 XR store 使用 `onSessionEnd?.`、`getState?.` 可选调用，掩盖接口不匹配 | 低 |
| W19 | `src/main.jsx:82-85` | `window.__display` 无类型，生产构建同时暴露测试钩子与原生壳注入入口，未区分用途 | 低 |

## MCP 服务 `services/vr-mcp-server`

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| M1 | `src/handle.js`、`src/tools.js` | 无类型 JS，无 lint / 格式检查 | 中 |
| M2 | `src/handle.js:66-80`；`src/tools.js:51`、`69`、`84`、`88-101` | `advertise()` 构造的 Standard Schema `validate` 全部放行，却没有说明这是为了让中继返回结构化 `error_code`；三份 `outputSchema` 从未注册给 SDK，属于误导性死数据 | 低 |
| M3 | `src/handle.js:121-139` | `initialize` 失败或 `handleRequest` 抛错时，已 `connect` 的 `McpServer` / 传输不关闭，每次失败泄漏一组对象 | 中 |
| M4 | `src/handle.js:104`、`111-119` | 2025 会话表无上限，只在请求到来时按 TTL 清理；服务关闭时不关闭这些传输 | 中 |
| M5 | `src/handle.js:130`、`158` | 2025 MCP 会话 TTL 隐式复用显示会话的 `sessionTtlMs` | 低 |
| M6 | `src/handle.js:216-221` | 所有正文读取错误都报 `payload_too_large`，状态码取自错误对象或 400 | 低 |
| M7 | `src/handle.js:241-242` | 内部异常被吞掉，不记录日志 | 中 |
| M8 | `src/handle.js:4` | MCP 模块反向依赖中继的 `readBody`，两个模块互相引用 | 低 |
| M9 | `src/tools.js:1-3`、`relay/src/hub.js:7`、`relay/src/app.js:183`、`web-display/src/anchors.js:1-8`、`web-display/src/session.js:365` | 标识正则、预设、锚点和范围在 4～5 处重复定义 | 中 |
| M10 | `src/tools.js:251-253`；`relay/src/hub.js:455-460` | `wireMessage` / `wirePreview` / `markRenderedForTests` 无调用者 | 低 |
| M11 | `src/tools.js:148-151`；`relay/src/config.js:49-52` | `isIpHostname` 重复实现 | 低 |
| M12 | `src/tools.js:169-249` | `validateToolCall` 返回无类型联合；三个分支各自复制键白名单逻辑 | 低 |

## 中继 `services/relay`（语义保持）

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| R1 | `src/app.js:107` | `createReadStream(full).pipe(res)` 无错误处理；文件在 `stat` 后消失或读失败会抛出未处理的 `error` 事件，使进程崩溃 | 高 |
| R2 | `src/app.js:286-294` | `close()` 不终止未鉴权或已替换的 WebSocket（其心跳 / 鉴权定时器继续运行），不关闭 HTTP keep-alive 连接，也不关闭 2025 MCP 会话 | 中 |
| R3 | `src/app.js:126-132`；`src/hub.js:9-17` | 两份相同的滑动窗口限流器 | 低 |
| R4 | `src/app.js:118-296` | 一个 180 行函数混合 Bearer 鉴权、限流、静态文件、配对 API 与 WebSocket 升级；鉴权逻辑无法单独测试 | 中 |
| R5 | `src/app.js:159` | `/mcp` 失败日志丢掉错误类型 | 低 |
| R6 | `src/index.js:17-40` | `started` 仅为 `void started` 存在；关闭失败成为未处理拒绝；无未捕获异常兜底 | 低 |
| R7 | `src/security.js:28-52` | 客户端中途断开时若只触发 `close`，`readBody` 永不结束 | 中 |
| R8 | `src/*.js` | 无类型检查 | 中 |

## 测试、脚本与 CI

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| T1 | `package.json:8-16`；`.github/workflows/ci.yml:42-49` | 没有 lint、格式、类型检查脚本，CI 也不执行 | 中 |
| T2 | `.github/workflows/ci.yml:6-16` | 路径过滤未覆盖新增共享代码与 lint 配置 | 低 |
| T3 | `test/` | 没有显示状态归约、WebSocket 客户端重连 / 序号、工具参数边界、`tools/list` 线上格式的单元测试；Bearer 401 只在一条集成测试中出现 | 中 |
| T4 | `test/e2e/display.spec.js:9-38` | 重复实现 `test/helpers.js` 已有的 MCP 调用 | 低 |
| T5 | `scripts/mcp-delivered-check.mjs:44`、`47` | 无效的 `getAttribute` 调用、用嵌套三元表达式推导期望状态，结果不记录 `request_id` | 低 |
| T6 | `scripts/demo-tools.mjs:20-64` | 手拼 JSON-RPC 而非官方客户端；固定 `request_id` 在 5 分钟内重跑会命中幂等缓存，显示旧结果 | 中 |

## 原生薄壳 `apps/quest-app/spatial`

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| K1 | `core/.../RelayClient.kt:55-73`、`75-199`、`204-213`；`core/.../Protocol.kt:20-41` | 薄壳化后 WebSocket 客户端、资产来源获取、交互发送和信封编解码都无调用者，只有 `pair()` 在用；文档仍称其“保留 WebSocket” | 中 |
| K2 | `app/.../ModelStore.kt:1-113` | 未被引用的 glTF 下载器 | 中 |
| K3 | `app/.../WorkspaceActivity.kt:161-186`、`205-208` | WebView 在 `AndroidView` 工厂里创建；面板或组合重建时新实例覆盖 `webView`，旧实例不销毁 | 高 |
| K4 | `app/.../WorkspaceActivity.kt:171-175` | 未实现 `onRenderProcessGone`；WebView 渲染进程崩溃会带走整个 App 进程 | 高 |
| K5 | `app/.../WorkspaceActivity.kt:171-175`、`188-198` | 不限制 WebView 导航；注入会话令牌前不核对当前页面来源，页面跳到其他来源后令牌会交给外部页面 | 高 |
| K6 | `app/.../WorkspaceActivity.kt:188-198` | `postDelayed` 重试从不移除，`evaluateJavascript` 回调只检查 `isFinishing`，可在 `destroy()` 之后继续使用 WebView | 中 |
| K7 | `app/.../WorkspaceActivity.kt:147`、`157`、`190`、`242` | Keystore 解密、偏好读取与调试文件写入都在主线程 | 中 |
| K8 | `app/.../WorkspaceActivity.kt:155-159`、`190` | 原生 WebSocket 客户端删除后无人续期：过期短期会话被原样注入，页面显示“需要重新配对”，尽管恢复授权仍有效 | 高 |
| K9 | `app/.../WorkspaceActivity.kt:146-153`；`core/.../Protocol.kt:13-19` | 显示地址校验写了两份且规则不同（一份允许路径） | 低 |
| K10 | `app/.../WorkspaceActivity.kt:246-262` | WebView 仍挂在视图树上就 `destroy()`，未 `stopLoading` 或移出父视图 | 中 |
| K11 | `app/.../WorkspaceActivity.kt:57`、`235-244` | `AtomicLong` 只在主线程使用；调试状态写在主线程 | 低 |
| K12 | `app/.../DisplaySessionStore.kt:18-23` | `connectionAllowed`、`explicitReconnectRequired` 只写不读；`connecting` / `connected` 等阶段已无人产生 | 中 |
| K13 | `app/.../HomeActivity.kt:22-124` | 约 100 行组合函数写在 `onCreate` 内；组合与点击回调在主线程做 Keystore 解密；每次配对新建 `OkHttpClient` | 中 |
| K14 | `app/.../HomeActivity.kt:132-143` | `statusText` 保留不会出现的阶段分支 | 低 |
| K15 | `tunnel-probe/.../ProbeService.java:36-39` | 由 `startForegroundService` 启动后，“已有会话 / 旧会话仍在清理”分支不调用 `startForeground` 就返回或 `stopSelf`，Android 12+ 会抛 `ForegroundServiceDidNotStartInTimeException` 使进程崩溃 | 高 |
| K16 | `tunnel-probe/.../ProbeService.java:61`、`200` | 会话线程只捕获 `Exception`，`Error` 会绕过清理；`session` 字段从不清空 | 低 |
| K17 | `apps/quest-app/spatial/**/*.kt` | 无 ktlint / detekt；通配符导入、超长行和单行多语句普遍 | 中 |
| K18 | `core/.../RelayClient.kt:42`、`45`、`63` | 对响应体与字段使用 `!!`，协议错误表现为空指针 | 低 |
| K19 | `app/src/debug/.../DebugDisplayActivity.kt:26-33` | 调试配对文件在主线程读取 | 低 |

## 文档

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| D1 | `apps/quest-app/spatial/README.md:8-19`、`64` | 仍描述已删除的 Compose 场景、模型包围盒、Kotlin ACK 门控及“核心模块 12 项检查” | 中 |
| D2 | `docs/07-architecture-two-track.md:41`、`82` | 称 `RelayClient` 保留 WebSocket | 低 |
| D3 | `README.md:22` | “原生核心 12 项”等检查数已过时 | 低 |
