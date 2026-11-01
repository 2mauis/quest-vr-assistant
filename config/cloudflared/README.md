# 具名 Tunnel：从本地配置切换固定 MCP 入口

双轨显示重构不修改 DNS、WAF、账号或 Tunnel 资源，也不新建具名 Tunnel。下面保留此前已授权切换的记录。下一步具名 Tunnel 只写在 [计划](../../docs/08-named-tunnel-plan.md)，尚未执行。当前重构路径继续可以使用 Quick Tunnel，只转发 `/mcp`。

阶段 1 仍使用现有 Node 中继，显示端通过开发路径连接。用户已明确授权将专用具名 Tunnel 改接现有 `/mcp`，本机固定入口已切换；这不迁移 MCP 到 Quest，也不代表常驻部署或头显工具闭环已经完成。最新决定见[阶段决策](../../docs/05-decisions.md)。

## 当前已核对状态

2026-11-01，分支先从 `f3fc808` 快进到 `c002e97`，核对后按用户确认完成入口切换。真实地址、账号及秘密只在仓库外的私有配置中。

| 层次 | 当前状态 | 意味着什么 |
|---|---|---|
| 本机中继 | 进程运行，本机 `/mcp` 无 Bearer 返回 401 | 本机鉴权入口存在，不代表公网或头显工具闭环通过 |
| 现有 `qvr` | 本机入口委托仓库内 `scripts/qvr.sh`，读取私有 `named-tunnel.env` | 默认启动具名 Tunnel；重复 `up` 已验证不更换现有中继 / 连接进程 |
| 中继 `local.env` | 仅包含中继监听、显示基址与两项应用凭据；显示基址仍是 localhost | `PUBLIC_BASE_URL` 不创建 Tunnel / DNS，也不会变成 cloudflared 的连接令牌 |
| 管理凭据 | `cloudflare-management.env` 中的 API token 有效，到期日为 2027-02-01 | 用于管理指定云端资源；不是运行 Tunnel 的令牌，也不是 MCP Bearer |
| 专用具名 Tunnel | 云端已有活动连接，固定公网 MCP 请求已验证 | 原隔离健康资源已按本次授权改接中继 |
| 固定域名 | 代理 CNAME 指向上述具名 Tunnel | DNS 配置已存在，但不能单独证明服务可用 |
| 云端 ingress | 固定 hostname + `^/mcp$` → 中继专用端口，其他默认 404 | 无 Bearer 401；有效 Bearer 的工具列表和旧协议初始化通过；六个其他路径均 404 |
| 连接令牌 | 私有 `quest-tunnel.token`，权限为 0600，经 `--token-file` 使用 | 管理凭据及中继秘密不进入连接子进程 |
| Grok 连接器交接 | 纳入原生主体之后的集中联合验收 | 旧 Quick 进程暂留在单独的 `quick-cloudflared.pid` 记录；尚未宣称 Bot 已改用固定入口 |

切换前的状态确实只有资源 / 本地凭据：没有连接，ingress 仅默认 404。当前已完成路由、进程和本机 helper 的切换，连接器联合验收仍待做。`quest-tunnel.json` 保存资源标识与域名元数据，`quest-tunnel.token` 保存连接令牌，`named-tunnel.env` 指定固定 MCP 地址及令牌文件路径。不要把 API token 的到期时间套用到连接令牌或 MCP Bearer。

## 仓库中的可复现配置

- [环境模板](.env.example)：只定义正式 `MCP_PUBLIC_URL`、`TUNNEL_TOKEN_FILE` 和出站传输协议，真实值保存在仓库外。`MCP_PUBLIC_URL` 必须是固定域名的精确 HTTPS `/mcp` 地址，与中继的 `PUBLIC_BASE_URL` 分开。
- [云端路由模板](ingress.example.json)：匹配固定 hostname 和 `^/mcp$`，指向中继专用的 `http://localhost:8788`；最后一项默认 404。实际使用时端口必须与中继 `TUNNEL_PORT` 一致。
- [启动器](../../scripts/start-named-tunnel.mjs)：前台运行现有 cloudflared，使用 `run --token-file`，不读取管理凭据、不创建资源，也不停止现有服务。它校验固定入口、令牌文件权限和传输协议，并移除对子进程无用的管理 / 应用秘密及冲突的中继 `TUNNEL_HOST` / `TUNNEL_PORT`。
- [本机 helper](../../scripts/qvr.sh)：`up` / `tunnel` / `down` / `status` / `url`。启动前核对配置，记录受控 PID，状态同时检查进程与入口 401；不自动创建云端资源、不自动回落到临时域名。`QVR_CONFIG_DIR` 可覆盖私有配置目录，`QVR_REPO` 可指定工作目录。

cloudflared 的远程管理模式从云端取得 ingress；这个 JSON 模板需在确认目标资源后通过管理 API 应用，启动器不会自动上传它。本机 `--check` 只核对配置，不证明 token 有效、云端路由正确或公网连接成功。

```sh
# 在仓库根目录执行；文件由操作者在仓库外准备并设为 0600。
set -a
. '<PRIVATE_NAMED_TUNNEL_ENV>'
set +a
node scripts/start-named-tunnel.mjs --check

# 只有目标路由确认并准备好切换后才运行；前台退出即停止此连接进程。
node scripts/start-named-tunnel.mjs
```

默认协议为 `http2`，沿用当前本机 helper 的出站选择；可显式设为 `auto` 或 `quic`。启动器保留现有代理环境，不修改系统网络、路由器或信任设置。标准参数依据 Cloudflare 官方 `/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/`，连接令牌依据 `/tunnel/reference/tunnel-tokens/`。

## 正式切换顺序

1. 确认使用现有专用具名 Tunnel 接阶段 1 中继的范围；核对资源 ID、固定 hostname、DNS 目标和现有 ingress，避免改到其他服务。现有诊断入口改接中继是用途变更，不由本地 env 自动触发。
2. 验证本机中继鉴权和 MCP `initialize` / `tools/list`，保持中继、配对口令和已有显示会话；无需为切入口重启中继。
3. 向已核对资源配置精确 `/mcp` 规则和默认 404，启动具名连接进程。令牌通过文件读取，管理令牌不传给 cloudflared 或 Grok。
4. 分别验证云端连接、外部无 Bearer 的 401、有效 Bearer 的初始化 / 工具列表，以及 `/`、`/ws`、配对、显示与健康路径均拒绝。工具列表成功不替代实际工具调用和头显 ACK。
5. 更新既有 Grok 连接器为固定 `MCP_PUBLIC_URL`，沿用 MCP Bearer；核对实际调用。只有新路径验证通过后才退出本次拥有的旧 Quick Tunnel，不能按进程名批量停止其他隧道。
6. 将本机 `qvr` 的默认启动和状态检查接到具名配置。本机已完成这一步；其他机器使用仓库内 helper，并在仓库外准备自己的 `local.env` 和 `named-tunnel.env`。运行宿主、自启和长期恢复另行验收。

任一步失败都保留原中继和配对状态；若已修改云端规则，恢复切换前实际读取的配置。旧 Quick Tunnel 只有经当时公网检查仍可用时才能作为回退，不把存活 PID 或过期 URL 当作可用回退证据。

固定域名切换与正式 Quest MCP / MR 实现是不同交付项。本目录不公开 `/ws` 或配对路径，不增加模型 API 客户端，也不把短时公网连通标成全天候运行。
