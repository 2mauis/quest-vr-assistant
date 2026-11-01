# Quest APK：连接诊断与网页页

同一个 Android APK 提供连接诊断页和独立的官方网页入口，默认由浏览器 Custom Tabs 复用已有登录，另保留 WebView 备用页。连接部分仍验证 Quest App UID 执行随包 `cloudflared`、停止与限时健康回环；正式 MCP 工具服务和 MR 尚未实现。共享登录、现有 Bot 页面及麦克风获取 / 释放已有自动化实机证据；当前 `0.3-browser` 的实际网页登录 / 语音体验已由用户确认通过，正式 Quest 工具调用仍待接入验收。结果见[实机记录](../../../docs/03-validation-baseline.md)。

## 构建

输入固定为 Android SDK Platform 34、Build Tools 35.0.0、JDK 21、Go 1.27.3，以及 cloudflared 2026.10.7 的独立源码 checkout（提交 `872b241f94871665c1c157adefcf90c11f0ead96`）。从官方发行渠道取得 SDK 后，执行：

```sh
export JAVA_HOME='<JDK_HOME>'
export ANDROID_HOME='<ANDROID_SDK>'
export QVR_CLOUDFLARED_SOURCE_DIR='<PINNED_CLOUDFLARED_CHECKOUT>'
export QVR_WEB_START_URL='https://app.example.com/'
python3 apps/quest-app/tunnel-probe/test.py
python3 apps/quest-app/tunnel-probe/build.py
```

脚本核对源码提交和无关修改，把 `native/` 下的两项探针适配复制到该独立 checkout，以 `-mod=readonly` 使用上游锁定依赖。它通过 SDK 自带 `aapt2`、`javac`、`d8`、`zipalign` 和 `apksigner` 构建，不需要 Gradle 或 Android Studio；这不决定后续 MR 工程的技术栈。

产物在忽略的 `build/`：`quest-tunnel-probe.apk`（保留原文件名，应用显示名为 Quest Assistant）、构建哈希、临时调试签名及 Go 缓存。将示例网页地址替换成经核实的官方入口；真实站点只进入本地生成代码和 APK，不写进公开源文件。APK 包含原生组件的许可证 / 声明文件，不包含连接凭据。调试签名不是发布密钥，WebView 调试仅随 App 的 debuggable 标记开启。

## 默认网页入口：复用浏览器登录

选择“打开 Grok · 复用浏览器登录”。App 通过公开 Custom Tabs Intent 协议调用默认 HTTPS 浏览器；Quest 实测打开浏览器的 `CustomTabActivity`，位于 Quest Assistant 的同一个任务栈。关闭该页签后连接页恢复，浏览器已有普通页签保持不动。它由浏览器进程提供页面，不是可自由嵌入任意原生布局的 WebView。

- Cookie、登录、网站权限及网页音频由浏览器管理；App 不导出、拷贝或注入 Cookie，不读取浏览器私有数据库。浏览器正常会话失效时，仍需按站点要求登录。
- 只选择默认浏览器且确认其提供 Custom Tabs Service，不自动选择另一个可能尚未登录的浏览器。设备不支持时提示用户使用备用内嵌页；不会静默跳到新的登录存储。
- 浏览器的麦克风授权与 App 的 WebView 授权独立。默认入口已验证继承既有网站授权，并获得 / 释放真实音轨；备用页的本机 WebRTC 回环结果不能替代实际远端 Bot 通话。
- 清除浏览器站点数据会影响共享登录；同签名 `adb install -r` 更新本 APK 可保留 App 私有数据。日常使用无需导入 Tunnel 令牌或执行后文的探针卸载流程。

## 备用内嵌网页

选择“内嵌网页（独立登录）”；网页顶部“连接”回到连接页，“返回”浏览历史或关闭登录弹窗，“更多”提供刷新、本机麦克风检查及外部浏览器入口。该页与默认入口的登录存储分离。

- 使用系统 WebView，保留原始 WebView User-Agent、正常 TLS 验证、站点自身登录和 Cookie。没有 JavaScript 原生桥，不向网页暴露 Tunnel 令牌、MCP 凭据或 App 私有文件。
- 麦克风只有在 Android 正常授权后才可使用，且请求来源必须与当前可见页面及构建配置的 HTTPS 主站严格同源。本机检查页是唯一额外来源；其他来源、摄像头及未知网页权限不自动放行。
- Cookie / DOM 存储供官网正常登录使用，与 Quest 浏览器的会话隔离。只记住主站首页或 Bot 页面路径，不持久化 OAuth 回调参数。第三方登录若限制 WebView，应使用服务方支持的登录方式；外部浏览器入口不表示能把其会话搬回 WebView。
- 上传文件经过系统选择器，不申请全盘文件权限。麦克风检查页不上传或保存声音，显示真实采集音量和设备内 WebRTC 收发计数，可单独播放短提示音。
- 关闭网页页销毁 WebView 并释放录音。Activity 完全退到后台时卸载文档，返回时重载；系统权限 / 文件选择器暂时覆盖页面时保留相应回调。持续后台通话、摘戴休眠、蓝牙和 MR 焦点尚未验收。
- 网页页的安装、麦克风权限和正常账号登录已获本轮授权；打开网页不自动启动 Tunnel，也不安装 Google 组件或修改第三方 APK。

## 执行路径与边界

- ARM64 可执行文件以 `libcloudflared_probe.so` 随 APK 分发，由安装器提取到 `nativeLibraryDir`；`ProcessBuilder` 从该安装目录执行。它仍是 CLI 子进程，不是可供 JNI 调用的共享库。
- 普通 Android Activity 提供开始 / 停止按钮。Service 使用 `specialUse` 前台服务类型，`START_NOT_STICKY`，最长运行 600 秒；没有开机接收器、唤醒锁或自动重启。
- 连接部分使用网络、读取活动网络状态和前台服务权限；网页额外声明麦克风和音频设置权限，麦克风在实际请求时授权；目标 API 34。
- 每次启动从活动网络读取已有 DNS；同时设置进程解析器和 cloudflared 内部 DNS。使用已有 Android 系统 CA；保留正常 TLS 校验。网络切换后的自动更新尚未实现。
- 健康服务只绑定 loopback 随机端口；仅精确 `GET /healthz` 配合 32 位小写十六进制 `X-QVR-Probe-Nonce` 返回运行码与请求码。其他路径 / 方法拒绝，头部上限 4096 字节，回执最多 64 条，私有日志最多保留 65536 字符。
- 子进程还有独立的时限和父进程监视。正常停止关闭连接、退出子进程并删除连接令牌；主进程被强杀时无法保证 Java 清理执行，剩余私有文件由验证程序收尾。状态文件本身不能代替活进程与公网回执证据。

## 隔离 Tunnel 实机验证步骤

以下仅供专门的隔离 Tunnel 验收，日常网页使用不需要执行。包名为 `com.example.questvr.tunnelprobe`，只构建可由 `run-as` 检查的调试包。安装前确认没有同名其他应用；保留现有安装数据时使用同签名 `adb install -r`。连接令牌从开发机的已有私有文件，经 stdin 写到 App 私有目录，不能放进 APK、Intent 或命令行参数；管理凭据始终留在开发机。

```sh
adb install -t apps/quest-app/tunnel-probe/build/quest-tunnel-probe.apk
adb shell -T "run-as com.example.questvr.tunnelprobe sh -c 'umask 077; mkdir -p files; cat > files/tunnel.token'" < '<LOCAL_TUNNEL_TOKEN_FILE>'
adb shell am start -W -n com.example.questvr.tunnelprobe/.ProbeActivity
adb shell am start -W -n com.example.questvr.tunnelprobe/.DebugControlActivity --es command start --ei seconds 180
```

`DebugControlActivity` 仅供测试，受 `android.permission.DUMP` 保护；Service 不导出。界面按钮无需这项调试权限。`seconds` 被限制在 15–600 秒，重复开始保留同一会话。正常停止会删除令牌，下次测试需要重新导入。

从私有 `status.json` 取得本次 loopback 端口和运行码，再核对实际子进程的 UID、父进程及已安装文件哈希。只为已授权的专用 Tunnel 临时配置健康路由；公网请求必须经过正常 TLS，并与本机 `receipts.json` 对应，不能用 ADB 转发替代公网证据。真实域名、网络信息、凭据及原始状态 / 日志不提交仓库。

分别验证重复启动、停止、重新启动、限时退出和主进程异常退出。停止后核对原端口拒绝连接、子进程消失和令牌删除。结束撤下临时 origin，恢复默认 404。仅在该 APK 属于本次临时探针且已获清理授权时卸载；日常网页版本应保留，卸载会删除其 WebView 登录数据。保留本地构建产物以便复现。

```sh
adb shell am start -W -n com.example.questvr.tunnelprobe/.DebugControlActivity --es command stop
adb uninstall com.example.questvr.tunnelprobe
```

正式 MCP 授权、凭据安全导入 / 轮换、语音触发 Quest 工具、发布更新、网络恢复、休眠及长时运行仍是后续工作。基础网页语音已获用户验收；该调试包不用于常驻部署。

## 官方依据

Android Developers：`/tools/aapt2`、`/tools/d8`、`/tools/zipalign`、`/tools/apksigner`、`/guide/topics/manifest/application-element#extractNativeLibs`、`/develop/background-work/services/fgs/service-types#special-use`、`/about/versions/10/behavior-changes-10#execute-permission`。Cloudflare 固定版本源码及许可证由构建脚本核对并随 APK 保留。
