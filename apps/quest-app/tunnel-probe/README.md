# APK 内置 Tunnel 验证

最小 Android 诊断 APK，用于验证 Quest App UID 能否执行随包安装的 `cloudflared`，以及启动、停止和限时健康回环。它没有 MCP、MR、相机或 Grok 会话功能；结果见[实机记录](../../../docs/03-validation-baseline.md)。

## 构建

输入固定为 Android SDK Platform 34、Build Tools 35.0.0、JDK 21、Go 1.27.3，以及 cloudflared 2026.10.7 的独立源码 checkout（提交 `872b241f94871665c1c157adefcf90c11f0ead96`）。从官方发行渠道取得 SDK 后，执行：

```sh
export JAVA_HOME='<JDK_HOME>'
export ANDROID_HOME='<ANDROID_SDK>'
export QVR_CLOUDFLARED_SOURCE_DIR='<PINNED_CLOUDFLARED_CHECKOUT>'
python3 apps/quest-app/tunnel-probe/test.py
python3 apps/quest-app/tunnel-probe/build.py
```

脚本核对源码提交和无关修改，把 `native/` 下的两项探针适配复制到该独立 checkout，以 `-mod=readonly` 使用上游锁定依赖。它通过 SDK 自带 `aapt2`、`javac`、`d8`、`zipalign` 和 `apksigner` 构建，不需要 Gradle 或 Android Studio；这不决定后续 MR 工程的技术栈。

产物在忽略的 `build/`：`quest-tunnel-probe.apk`、构建哈希、临时调试签名及 Go 缓存。APK 包含实际依赖图的许可证 / 声明文件和构建输入摘要，不包含连接凭据。调试签名仅用于该探针，不作为发布密钥。

## 执行路径与边界

- ARM64 可执行文件以 `libcloudflared_probe.so` 随 APK 分发，由安装器提取到 `nativeLibraryDir`；`ProcessBuilder` 从该安装目录执行。它仍是 CLI 子进程，不是可供 JNI 调用的共享库。
- 普通 Android Activity 提供开始 / 停止按钮。Service 使用 `specialUse` 前台服务类型，`START_NOT_STICKY`，最长运行 600 秒；没有开机接收器、唤醒锁或自动重启。
- 仅申请网络、读取活动网络状态和前台服务权限；目标 API 34。没有通过旧 target SDK、可写目录执行或更改系统设置规避限制。
- 每次启动从活动网络读取已有 DNS；同时设置进程解析器和 cloudflared 内部 DNS。使用已有 Android 系统 CA；保留正常 TLS 校验。网络切换后的自动更新尚未实现。
- 健康服务只绑定 loopback 随机端口；仅精确 `GET /healthz` 配合 32 位小写十六进制 `X-QVR-Probe-Nonce` 返回运行码与请求码。其他路径 / 方法拒绝，头部上限 4096 字节，回执最多 64 条，私有日志最多保留 65536 字符。
- 子进程还有独立的时限和父进程监视。正常停止关闭连接、退出子进程并删除连接令牌；主进程被强杀时无法保证 Java 清理执行，剩余私有文件由验证程序收尾。状态文件本身不能代替活进程与公网回执证据。

## 实机验证步骤

包名为 `com.example.questvr.tunnelprobe`，只构建可由 `run-as` 检查的调试包。安装前确认没有同名其他应用。连接令牌从开发机的已有私有文件，经 stdin 写到 App 私有目录，不能放进 APK、Intent 或命令行参数；管理凭据始终留在开发机。

```sh
adb install -t apps/quest-app/tunnel-probe/build/quest-tunnel-probe.apk
adb shell -T "run-as com.example.questvr.tunnelprobe sh -c 'umask 077; mkdir -p files; cat > files/tunnel.token'" < '<LOCAL_TUNNEL_TOKEN_FILE>'
adb shell am start -W -n com.example.questvr.tunnelprobe/.ProbeActivity
adb shell am start -W -n com.example.questvr.tunnelprobe/.DebugControlActivity --es command start --ei seconds 180
```

`DebugControlActivity` 仅供测试，受 `android.permission.DUMP` 保护；Service 不导出。界面按钮无需这项调试权限。`seconds` 被限制在 15–600 秒，重复开始保留同一会话。正常停止会删除令牌，下次测试需要重新导入。

从私有 `status.json` 取得本次 loopback 端口和运行码，再核对实际子进程的 UID、父进程及已安装文件哈希。只为已授权的专用 Tunnel 临时配置健康路由；公网请求必须经过正常 TLS，并与本机 `receipts.json` 对应，不能用 ADB 转发替代公网证据。真实域名、网络信息、凭据及原始状态 / 日志不提交仓库。

分别验证重复启动、停止、重新启动、限时退出和主进程异常退出。停止后核对原端口拒绝连接、子进程消失和令牌删除。结束撤下临时 origin，恢复默认 404，卸载本次临时 APK；保留本地构建产物以便复现。

```sh
adb shell am start -W -n com.example.questvr.tunnelprobe/.DebugControlActivity --es command stop
adb uninstall com.example.questvr.tunnelprobe
```

正式 MCP 授权、凭据安全导入 / 轮换、应用更新、网络恢复、休眠、长时运行和 Grok 语音仍是后续工作。该调试包不用于常驻部署。

## 官方依据

Android Developers：`/tools/aapt2`、`/tools/d8`、`/tools/zipalign`、`/tools/apksigner`、`/guide/topics/manifest/application-element#extractNativeLibs`、`/develop/background-work/services/fgs/service-types#special-use`、`/about/versions/10/behavior-changes-10#execute-permission`。Cloudflare 固定版本源码及许可证由构建脚本核对并随 APK 保留。
