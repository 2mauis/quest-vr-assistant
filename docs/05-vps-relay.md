# VPS 中转部署

> 待 VPS 改版更新：尚未收到 VPS 详细调研；下述为未来可实施的部署契约，不表示已部署或验证。

## 前提与文件布局

待 VPS 改版更新：选择 Ubuntu LTS、内存至少 1GB、独立公网 IPv4、按月计费的 VPS。安装来源与版本以后核实，使用受支持的 Node LTS、Caddy v2 和 systemd。公网示例域名固定为 vr.example.com，实际部署必须由机主在私有配置中替换，公开仓库不记录真实值。DNS 指向部署主机；本仓库不列出任何地址。

| 路径 | 所有权与权限 | 用途 |
|---|---|---|
| /opt/vr-mcp-relay | root 所有，服务用户只读 | 经审核的 dist/index.js 和依赖；本仓库尚不提供 |
| /etc/vr-mcp-relay/relay.env | root 所有，0600 | 从 config/.env.example 填写的私有环境文件 |
| /var/lib/vr-mcp-relay | vr-relay 所有，0700 | 设备授权与持久数据 |
| /etc/caddy/Caddyfile | root 所有，Caddy 可读 | 由示例复制并复核的配置 |
| /etc/systemd/system/vr-mcp-relay.service | root 所有，0644 | 从 unit 示例复制 |

服务用户 vr-relay 无交互登录权限。Node 使用 HOST=localhost、PORT=8787；只绑定回环接口，Caddy 通过同名本机接口代理。主机自身解析必须保持 localhost 仅指向回环接口，禁止绑定所有接口。

## Caddy 与证书

待 VPS 改版更新：[Caddyfile 示例](../deploy/caddy/Caddyfile.example)采用 Caddy v2 独占路由；/mcp 与 /mcp/ 子路径传给 Node，不改写路径。/ws 自动代理 WebSocket Upgrade；/api/device/ 供配对与续期。flush_interval -1 防止 MCP SSE 被代理缓冲，不启用压缩干扰事件首包。

示例显式选择 Let's Encrypt ACME issuer；实际可控制域名解析正确且开放入站 HTTP/HTTPS 后，Caddy 自动签发和续期。example.com 是文档占位，不能用它取得本项目证书。持久保存 Caddy 默认服务数据目录，保护证书私钥；无需手工复制私钥或设续期定时任务。验证续期日志、到期监控与服务用户写入证书存储权限。

只开放 HTTP/HTTPS 和受控管理端口；不开放 Node 端口。SSH 仅密钥登录并限制管理入口，禁止把管理员配置或密钥放入仓库。不要照抄防火墙命令造成管理连接中断。

## 启动顺序与验收命令

待 VPS 改版更新：先有通过测试的服务构建产物，再创建用户与目录、注入环境、部署 unit。下列命令仅供将来在 VPS 执行，本次不执行：

```sh
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemd-analyze verify /etc/systemd/system/vr-mcp-relay.service
systemctl daemon-reload
systemctl enable --now vr-mcp-relay.service
systemctl reload caddy
systemctl status vr-mcp-relay.service --no-pager
curl --fail --silent --show-error https://vr.example.com/healthz
```

healthz 必须由 Node 返回脱敏就绪状态，不由 Caddy 固定返回成功；设备离线不算进程不健康。未加载配置、存储不可用或准备退出时返回 503。鉴权失败、SSE 首事件、WS 双向通信、撤销、重连和恢复均须按检查表测试。

## 运维与恢复

待 VPS 改版更新：systemd 管理 Node，失败 3 秒后重启且限制重启频率，持续失败需告警。日志只记录匿名请求 ID、状态码、耗时和队列计数；禁止正文、凭据、模板、配对码与个人信息。journald 配额建议 200MB，以整机日志策略复核。

每周加密备份持久授权数据、私有环境及必要证书存储；代码产物按版本归档。快照同样包含秘密，访问受控且不得公开。健康探测约每 60 秒一次；证书临期、错误率、队列溢出和磁盘不足告警。冷恢复目标 10 分钟，实测失败就调整目标；不承诺热备。

升级先记录产物版本和可恢复备份，先验证配置再重启；回滚还原兼容产物与存储版本。恢复后使旧设备会话失效、重新验证授权，按配对和工具闭环复验。systemd 加固不启用 MemoryDenyWriteExecute，避免阻断 Node JIT；内存上限需实测，不能因限制导致反复崩溃。
