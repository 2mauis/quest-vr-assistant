# Quest Assistant 原生主体

> 双轨重构后，`WorkspaceActivity` 是薄壳：Spatial SDK 放置 Grok Custom Tab 窗口和加载网页显示的 WebView 面板。三维内容由网页显示绘制。`DisplayEngine` 仍参与 `:core:test`，工作区不再调用它。详见 [双轨架构](../../../docs/07-architecture-two-track.md)。

`0.4-spatial` 仍使用 Meta Spatial SDK 0.14.0 + Compose。此前 Kotlin 自绘路径的实机回执不能自动转成这条 WebView 路径的头显验收。历史画面证据见[实机记录](../../../docs/03-validation-baseline.md#原生工作区联调与宽屏共存)。

## 已实现

- 连接页：显示地址、一次性输入配对口令、错误 / 限流提示、重新配对和移除连接。短期会话与独立设备恢复授权经 Android Keystore AES-GCM 加密保存在 App 私有存储；不保存配对口令，不接收 MCP Bearer 或 Cloudflare 管理凭据。
- 默认 Grok Custom Tab 和备用 WebView 复用上一版源码。Grok 使用独立二维任务，默认 `1280×720 dp` 横屏；明确选择网页入口时打开；直接进入工作区保留原生输入焦点。已实现复用存活浏览器任务，连续三次打开未增加页面；历史隐藏旧页、重启 / 更新全流程仍需回归。浏览器持有登录、网站权限与麦克风，App 不读取 Cookie。网页地址通过构建环境输入。
- `/api/device/pair` 与 `/ws` 显示协议：鉴权、心跳超时、带抖动的有界退避、快照、连续序号、重复消息、单连接接管。短期会话到期和 `4401` 先使用恢复授权自动续期，原签名更新与重开无需重复输入。启动配置和连接遇到临时网络故障自动退避重试。授权失效才要求重新配对；`4410` 接管及主动移除连接停止重连。
- 透视工作区：`show_scene` 的四种内置预设、允许来源的 glTF / GLB；`render_panel` 多块 Compose 纯文本面板、同 ID 更新；`clear` 的 scene / panel / all。当前资源保护上限为 32 块面板。
- 面板已配置抓取边缘与等比缩放，并有逐块“缩小 / 放大”按钮；对象按包围盒缩小，配置触碰碰撞体、双手缩放和控制页大小按钮。选择 / 激活上报现有 `interaction`；XR 自动化已在设备上验证控制器放大、面板侧键 / 手部射线拖动和模型手势抓取，见实机记录。移动不回写中继 `pose`，也不会触发新对话或模型调用。
- 串行呈现：先等待模型加载、对应 Compose 内容绘制、有效空间帧推进，再提交连续序号和 ACK。快照替换状态但不 ACK；失败和取消不越过未呈现命令。
- OpenXR `VISIBLE` 和 `FOCUSED` 均允许继续呈现，因此网页获得焦点时不会仅因焦点变化断开显示。只有获得输入焦点才上报场景选择；摘下头显、Activity 暂停或空间会话不可见时取消在途呈现并断开。恢复时重建已提交画面、按最后序号补发；设备接管和内容失败要求明确重试。

按最新实机反馈，默认采用紧凑右侧布局：在活动帧开始后采样佩戴者位置和水平朝向，控制页 `42×38 cm`，文字面板 `48×32 cm`，模型最长边默认 `25 cm`（再应用工具的 `scale`）。Compose quad 的局部负 Z 正面朝向初始佩戴位置，给正前方网页和系统操作留出空间。协议位置 / 锚点转换为此布局内的缩小偏移，旋转继续应用；这不再与桌面端的固定世界坐标逐点等同。`head` 不连续跟随；“收回右侧”按当前朝向重新排列。文字更新保留已拖动的位置和尺寸，明确的放置变化才重置。尚无房间锚点或跨进程场景恢复。

四个内置 GLB 预设显式生成三角形索引，并在打包时校验 accessor、缓冲边界和顶点范围，避免当前 SDK 加载非索引预设时触发原生断言。此校验针对内置预设，不代表任意外部模型都已通过实机兼容验证。

模型下载仅使用显示配置返回的 HTTPS 来源，不跟随重定向。外部 buffer / PNG / JPEG 纹理先检查来源并转为内嵌资源，再交给 SDK；每次模型及依赖总下载量最多 25 MiB、最多 32 个外部资源。要求未实现的 glTF 扩展、不可用模型或不允许的资源会停止回执，不用替代物冒充成功。

## 构建

复用本机 JDK 21、Android Platform 34 / Build Tools 35.0.0 / Platform Tools，Gradle 固定为 8.14.3。AGP 8.11.1、Kotlin 2.1.0、Spatial SDK 0.14.0 与依赖在工程中显式固定；预设由 `generate-presets.py` 生成，不需要 Spatial Editor。

```sh
export JAVA_HOME='<JDK_HOME>'
export ANDROID_HOME='<ANDROID_SDK>'
export GRADLE_HOME='<GRADLE_8_14_3_HOME>'
export QVR_WEB_START_URL='https://app.example.com/'
sh apps/quest-app/spatial/build.sh
```

真实网页地址只进入忽略的生成代码和 APK。默认签名优先复用 `../tunnel-probe/build/debug.keystore`；也可用 `QVR_DEBUG_KEYSTORE` 指定同一个已有调试密钥。缺少它时 Gradle 使用普通调试密钥，**不能据此覆盖已安装版本**；安装前比较证书，不卸载登录中的 App 来迁就不同签名。

若已有诊断 APK，构建会从中复用 `libcloudflared_probe.so` 及许可证目录；不存在时不显示诊断入口。它仍是限时健康探针，不在原生工作区中自动启动 Tunnel。阶段 1 的正式入口仍由现有中继宿主运行。

输出：`app/build/outputs/apk/debug/app-debug.apk`。所有缓存、生成代码、模型、APK 和测试报告位于忽略的 `build/` 下；命令不自动安装。

## GitHub Actions 构建

[quest-apk 工作流](../../../.github/workflows/apk-probe.yml)从源码构建 ARM64 诊断组件和原生工作区，执行健康 / 网页策略检查及原生核心协议检查，再核对 APK 签名、16 KiB ZIP 对齐、组件哈希、四个预设和实际网页入口。相关源码推送、PR 和手动触发均支持；手动入口需要工作流已存在于默认分支。

该公开仓库没有可用自建 runner，沿用已有的 GitHub 托管路线并固定为 `ubuntu-24.04`。Action 使用核对过的完整提交哈希，权限为 `contents: read`，不推送镜像、不部署服务或安装头显。

构建成功后下载 `quest-assistant-arm64-<COMMIT>`，内含：

- `quest-assistant-debug.apk`：包含原生主体及限时诊断组件。
- `build-result.json`：源码提交、版本、APK / 签名证书 / 原生组件哈希、网页入口是否配置；不记录真实 URL 或秘密。
- `SHA256SUMS`：APK 校验和。

另外保留探针 APK 和原生测试报告，产物保存 7 天。[中继 CI](../../../.github/workflows/ci.yml)执行单元与桌面浏览器检查，输出浏览器报告；这些结果仍不替代 Quest 实机验收。

仓库的 Actions Secret `QVR_WEB_START_URL` 仅配置已验收的官网入口（允许 `product` 路由参数），不含账号或令牌。它只供原生构建和产物检查使用；没有这个配置的 fork / PR 使用 `https://app.example.com/` 占位入口，产物中明确标记为 `placeholder`。

**CI 使用每次构建生成的临时调试签名**，与本机已安装版本的签名不同；探针与主体在同次 CI 中共用该签名。没有上传本机 keystore，也没有上传任何 MCP / 配对 / Tunnel 凭据。不要直接用 CI 包覆盖已登录版本或卸载原 App；设备更新继续使用本机原签名构建。发布签名管理不包含在本次 CI 构建中。

## 开发连接与后续联合验收

```sh
adb reverse tcp:8787 tcp:8787
```

调试包只对 `localhost` 放行明文，连接页填写 `http://localhost:8787` 及现有显示配对口令。其他来源和发布包要求正常 HTTPS；不要填写公网 `/mcp` 地址，它不是显示端口。不要把私有配对口令放进 adb Intent、源码或聊天。

本轮最小检查为 APK 编译与签名 / 打包校验，以及核心模块 12 项检查：呈现前不提交、失败不越序、取消、同 ID 更新 / 清除 / 去重、快照 / 代际、输入限制、接管停止、实际 WebSocket ACK、会话续期、授权失效和启动配置重试。后续集中完成：

1. 实体手柄直接控制模型：文字面板已捕获真实 `Hover` / `Select` 与缩放记录，模型直接抓取仍未通过，不能用合成输入结果代替。
2. 持续宽屏并排、返回后的布局纠偏、单网页生命周期、输入 / 音频焦点和真实网页语音。已有共存截图，但切回原生工作区时曾隐藏网页；自动越界恢复尚未实现。
3. 三个工具各自的头显画面与 `request_id` / `seq` / `delivered` 对齐；单块小面板与模型已完成投屏和自动化抓取，继续多面板、双手 / 角落缩放及外部模型成功和失败。
4. 中断补发、第二设备接管、摘戴 / 休眠 / 网络切换和内容失败后的恢复。
5. 既有 Grok 连接器改为固定入口后实际调用；成功后撤下旧 Quick Tunnel 进程。
6. 满足至少 100 个有效样本后才统计首包分位数。

ACK 的软件门槛是资产就绪、Compose 绘制及活动 Spatial SDK 帧；它不是物理显示器的呈现证明，最终由上述实机验收确认。MCP 迁入 APK、相机新帧、真实空间锚点、跨进程恢复和自启属于后续阶段，本工程没有把它们标为完成。

接口依据：Meta 官方 `Meta-Spatial-SDK-Samples` 提交 `f233e2327b95f9871b75bdba867d6fdd726f07cc` 的 Starter / Hybrid / Object3D 示例，以及 0.14.0 SDK 实际依赖接口。没有引入上游样例中的遥测或热重载功能。

## 自动化实机检查

真实画面使用 MQDH 随附 `metavr capture screenshot --method metacam`；普通 ADB 截图只覆盖二维显示，黑屏不能判断沉浸场景。截图仅留在机器本地，禁止提交房间、对话或登录信息。

可选将 Meta 官方 XR Operator 安装目录传入 `QVR_XR_OPERATOR_DIR`，构建会把该目录的 Android API layer 只打入 debug 变体；未设置时不携带，release 不包含该层。仅在受控调试时开放本地 MCP 转发，结束释放输入覆盖并还原临时设备设置；实体手柄检查使用不带该层的构建。自动化必须读取新鲜头部位姿，并以实际实体位姿、抓取状态、尺寸和 VR 截图共同判定结果。

Debug 变体另提供受系统 `DUMP` 权限保护的诊断入口，可检查私有缓存状态、收回布局及模拟短期会话过期。首次引导口令只接受 App 私有目录的一次性输入文件并立即删除；恢复检查使用已有加密授权，不重新配对。发布变体不导出这些诊断组件。
