# 验证基线与实机记录

当前结论（2026-11-01）：隔离适配构建已在实际 Quest 的 ADB shell 中通过外部 HTTPS 健康回环。下文保留首轮失败的历史，最新结果见末节；这不等于原始发布资产、正式 App UID、APK 内置或 Grok 语音已通过。

## 历史代码检查点

2026-11-01，检查点 `dca4f9e`，归档分支 `archive/webxr-mvp-2026-11-01`。这是已调通的协议 / 桌面显示验证基线，不能当作原生 MR、Quest 语音或本机 Tunnel 已完成。

| 验证 | 历史结果 | 证据范围 |
|---|---|---|
| `npm test` | 15 项通过 | 启动配置与不同秘密、Bearer 401、MCP 端口拒绝其他路径、两种协议、幂等 / 补发、鉴权后接管、旧连接处理和低序号快照 |
| `npm run test:e2e` | 6 项通过 | 桌面画面与回执、刷新恢复、显示端切换不抢回、取消重连、面板选择、慢模型 / 失败模型、模拟 XR 会话生命周期 |
| Grok Bot Apps 实际工具调用 | 三个工具通过 | 托管连接器 → HTTPS MCP → 本机中继 → 桌面显示；请求 / 序号、渲染 ACK 与截图相互对应 |
| Quest 页面准备 | 页面已打开 | USB 转发与投屏中看到新版界面 / VR 按钮；头显配对、真实沉浸画面、实机手柄和键鼠未验收 |

当时的命令式连接器使用 `mcp-remote@0.15.2`，`http-only` / `silent`，授权从安全变量在运行时读取。连接器显示 Connected 或列出工具不是通过依据；实际工具结果如下：

| 工具 | 结果 | 桌面证据 |
|---|---|---|
| `show_scene` | `rendered`、`delivered=true` | 同一请求 / 序号收到 ACK，显示预设场景 |
| `render_panel` | `rendered`、`delivered=true` | 同一请求 / 序号收到 ACK，出现文字面板 |
| `clear` | `rendered`、`delivered=true` | 同一请求 / 序号收到 ACK，场景与面板清空 |

随后在可见桌面浏览器复核场景及面板；服务更新并重新配对后，两次调用仍与可见画面一致。临时入口曾失效并恢复，因此不能用“进程仍在”代替入口验证。公网未经授权的 `/mcp` 返回 401，显示、WebSocket、配对等路径返回 404。这里不保存真实连接器标识、地址、秘密或日志正文。

上述结果没有覆盖 Quest Grok Bot 语音、原生多窗口 / 相机、自动启动、长时间运行或端到端 P50/P90。旧 VPS / Caddy / systemd 只有未部署示例，已从当前分支移除。

## 仓库清理后的本次复核

2026-11-01，移除旧路线 / 部署材料并迁移配置模板后，再次运行 `npm test`（15 项通过）和 `npm run test:e2e`（6 项通过）。检查了当前 10 份文档及 34 个相对链接、模板 shell 语法、隐私占位规则和 `git diff --check`。运行源码、测试、启动脚本、依赖与锁文件未修改；没有构建容器、部署服务或改变自托管 runner / 镜像配置。

这些复核证明保留的验证基线仍正常，不能增加对 Quest 原生或 Tunnel 的已通过声明。

## Quest Tunnel POC：提交前证据

2026-11-01，实际设备为 Quest 3，Android 14 / API 34，ARM64。未核对 Grok Bot 包版本或改变其设置。

| 项目 | 当前证据 |
|---|---|
| 官方二进制完整性 | cloudflared 2026.10.7 的 Linux ARM64 发布资产；下载大小与发布 API 的 SHA256 匹配，设备端再次匹配 |
| 实际执行 | ADB shell 身份运行 `--version` 和帮助成功，退出码为 0；不是正式 App UID |
| Quest 本地健康端点 | 仅 loopback、临时未占用端口；精确 `GET /healthz` 返回 200 和固定无敏感字符串，其他请求返回 404；本地请求已核对 |
| 出站 Tunnel | 做过一次短暂启动尝试；尚未依据连接或外部请求判定通过 |
| 外部 HTTPS 请求 | **未测试**，按用户顺序在仓库提交推送后继续 |
| 暂停清理 | 已停止本次拥有的健康进程；隧道已退出，没有继续运行的探针；隔离临时文件暂留供提交后复测，结束后删除 |
| 自动启动、恢复、APK 内置 | **均未验证**；没有安装 App、配置自启或创建稳定入口 |

临时探针没有使用真实凭据，没有连接现有 MCP / 显示 / 配对 / 私有服务，没有改变权限、睡眠、Wi-Fi、代理、DNS 或信任配置，也没有关闭 TLS 校验。执行成功不能推导 Android App 代码装载或后台生命周期可行，固定健康响应成功也不能推导 MCP 或语音已联通。

后续按[里程碑](02-milestones.md)补充外部响应、运行身份、失败原因和清理结果；不得发布临时公网地址、设备序列号或原始日志。

## Quest Tunnel POC：首轮 DNS 诊断与清理（历史）

仓库整理提交 `a63a725` 已推送并核对 GitHub 分支 HEAD 与本地一致后，才继续诊断。使用同一官方 Linux ARM64 发布二进制和隔离配置，没有导入真实凭据。

| 复核项 | 实际结果与边界 |
|---|---|
| 初次退出原因 | 申请 Quick Tunnel 时域名解析失败，还未获得临时入口或建立隧道 |
| 系统对照 | Quest 自带网络工具能解析同一 Cloudflare API 主机并收到一次响应；仅证明该系统路径，不代表 HTTPS 或 Tunnel 已通过 |
| 二进制复测 | 只启用 Go 解析器诊断，确认使用 Go DNS；再次在本地默认 DNS 端点遭连接拒绝，退出码 1 |
| 运行环境 | 设备没有该 Linux 二进制预期的 `/etc/resolv.conf`；结合系统对照，判断当前障碍在该发布资产的解析适配，不能推导所有 Android 构建或 Quest 均不支持 |
| 外部 HTTPS 健康请求 | **未执行 / 未通过**，因 Tunnel 未建立；本地固定 200 响应不能补足此证据 |
| 进程与文件清理 | 记录的两项探针进程均已退出；核对专属文件清单后删除设备和开发机的隔离临时目录，并验证不存在；健康端口连接被拒绝 |
| 影响范围 | 未安装 App、配置自启、修改 DNS / 代理 / 网络 / 权限 / 睡眠 / 信任或关闭 TLS 校验；未接入或重启现有服务 |

该轮结束时，下一项是独立的 Android 解析适配与公网回环验证；当时没有使用自定义 DNS、二进制补丁、Termux 或开发机网络转接，也没有把未执行的公网请求计为失败响应。后续经用户追加授权实施的适配和具名 Tunnel 结果单独记录如下。

本次证据补充仅修改文档，未重复运行已经通过的 15 项单元测试与 6 项 E2E；再次执行链接、隐私占位和差异格式检查。

## Quest Tunnel POC：适配构建与具名 Tunnel 回环通过

2026-11-01，用户明确追加授权隔离源码 / 构建适配、专用具名 Tunnel 与固定 DNS、三个月管理凭据，以及路由器针对 cloudflared 的 fake-IP 排除规则。实测设备仍为 Quest 3 / Android 14 / API 34 / ARM64，执行身份为 ADB shell。

| 验证项 | 实际结果 |
|---|---|
| 构建来源 | 上游 cloudflared `2026.10.7`，提交 `872b241f94871665c1c157adefcf90c11f0ead96`；增加仅在 `quest_probe` 构建标签下启用的进程解析适配 |
| 构建产物 | Go `1.27.3`，`linux/arm64`，`CGO_ENABLED=0`；版本 `2026.10.7-quest-probe`，大小 37,581,135 字节；主机与设备 SHA256 一致：`ab6e6ec0b4e77cdd685115d4be0dd3f5f106cc366ddc0c996ab8f9fa0f2e7414` |
| 进程 DNS | 从 Quest 当前活动网络读取已有 DNS，仅设置探针进程的 `net.DefaultResolver`；API 地址及边缘 SRV 均成功解析 |
| 系统 CA | 仅 DNS 适配时出现未知签发者；设置 `SSL_CERT_DIR` 指向 Android 现有系统 CA 目录后，HTTPS 探针返回预期 405，证书验证链存在；未新增信任或关闭校验 |
| 路由器 | 在原生效配置的既有过滤列表中仅追加两项 cloudflared 域名匹配；应用后两组边缘名称各有 10 个真实地址，API 有 2 个真实地址，SRV 有 2 条记录；对照域名仍返回 fake-IP；Quest 端再次验证 DNS / TLS 正常 |
| 内部 DNS 服务 | 默认动态探测使用独立解析器，最初仍报本地 DNS 初始化错误；补充 `TUNNEL_DNS_RESOLVER_ADDRS` 使用同一现有网络 DNS 后重启探针，最终启动日志 error / fatal 数为 0 |
| 凭据与路由 | 开发机私有管理令牌有到期时间，已轮换并验证 active；Wrangler 能读取为 `api_token`。Quest 只接收专用 Tunnel 连接令牌文件，未接收管理令牌或账号证书；令牌值不在启动参数或日志中 |
| 实际连接 | Quest 主动建立 4 条 QUIC 连接；Cloudflare API 同时显示 healthy 和 4 个连接 |
| 外部 HTTPS | 从开发机经固定公网域名请求 `/healthz` 返回 200，Cloudflare 响应标记存在；响应中的设备运行码和请求码匹配，ADB 读取的 Quest 本机回执也匹配。外部请求未经过 ADB 端口转发 |
| 客户端识别 | HTTP 库默认 User-Agent 被边缘以 1010 拒绝；按照官方建议发送真实应用标识后通过。未关闭或放宽站点安全检查 |
| 拒绝行为 | 公网 `/`、`/mcp`、`/ws`、`/api/device/pair` 及 `POST /healthz` 均为 404；缺少健康请求关联码为 400。设备端同类检查也通过 |
| 收尾 | 专用 Tunnel / DNS 与本机私有凭据保留；临时健康路由撤下，配置恢复为默认 404；停止本次拥有的两个进程，移除设备临时凭据、两端隔离目录及临时转发。未部署常驻头显组件 |

最终配置修正前后的两次完整健康请求分别约 1.093 秒、1.118 秒。它们只是短时健康探针样本，不是 MCP / 语音延迟或 P50 / P90，也不证明网络切换、长时运行、摘戴 / 休眠、系统重启或组件更新恢复。

管理令牌的作用范围满足本轮 Tunnel / DNS 操作；`wrangler whoami` 的账号枚举因权限不足返回错误，未为这项显示查询扩权。凭据导入以 Wrangler 读取结果和实际 Cloudflare API 操作为证，不把身份展示失败当成 Tunnel 认证失败。

### 最小适配的复现边界

在上述固定上游版本的 `cmd/cloudflared/quest_probe_dns.go` 中加入下列探针文件，以 `quest_probe` 标签编译；它不是 upstream 功能或正式 Android SDK。输入 DNS 来自设备当前网络，不能固定成开发时地址。正式 App 还必须实现网络变化后的解析器更新和生命周期管理。

```go
//go:build quest_probe

package main

import (
    "context"
    "fmt"
    "net"
    "net/netip"
    "os"
    "time"
)

func init() {
    endpoint, err := netip.ParseAddrPort(os.Getenv("QUEST_PROBE_DNS"))
    if err != nil || endpoint.Port() == 0 || endpoint.Addr().IsUnspecified() || endpoint.Addr().IsMulticast() {
        fmt.Fprintln(os.Stderr, "quest probe requires a valid explicit DNS endpoint")
        os.Exit(2)
    }
    address := endpoint.String()
    net.DefaultResolver = &net.Resolver{
        PreferGo: true,
        Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
            return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, address)
        },
    }
}
```

编译使用 `-tags quest_probe -trimpath` 和 `-ldflags '-X main.Version=2026.10.7-quest-probe -X main.BuildType=quest-probe'`，目标为 `./cmd/cloudflared`。运行时另设 `SSL_CERT_DIR=<ANDROID_SYSTEM_CA_DIR>`、`TUNNEL_DNS_RESOLVER_ADDRS=<EXISTING_NETWORK_DNS_HOST:PORT>`；连接令牌通过 `tunnel run --token-file <PRIVATE_TUNNEL_TOKEN_FILE>` 读取，日志格式选项为 `--output json`，禁用自动更新并将 metrics 限制在 loopback。

`--dns-resolver-addrs` 只配置 cloudflared 内部虚拟 DNS 服务，不能替代 API / 边缘发现使用的进程解析器适配。参考官方源码 `cmd/cloudflared/tunnel/configuration.go`、`ingress/origins/dns.go`，以及 Go `net.Resolver` 文档。Cloudflare 1010 的客户端建议见官方路径 `/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/`；Mihomo 过滤语义见官方路径 `/config/dns/`。

本轮仓库变更仅为文档；实际验证在隔离构建和真实 Quest 上执行。文档核对相对链接、隐私占位、状态一致性和差异格式，未重复运行未改动的 Node 单元测试或桌面 E2E。APK 内置、App UID、自动启动 / 恢复、Quest Grok Bot 语音、MR 显示与视觉新帧仍保持未验证。
