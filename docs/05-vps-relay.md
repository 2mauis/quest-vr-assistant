# VPS 中转部署

> 待 VPS 改版更新：尚未收到 VPS 详细调研。下述是以后的部署契约，不表示已经部署或验证。当前调试在本机完成，见 [README](../README.md)。

## 前提与文件布局

待 VPS 改版更新：选择 Ubuntu LTS、内存至少 1GB、独立公网地址、按月计费的 VPS。安装来源与版本以后核实。公网示例域名固定为 vr.example.com。本仓库不记录真实地址。

| 路径 | 所有权与权限 | 用途 |
|---|---|---|
| /opt/vr-mcp-relay | root 所有，服务用户只读 | 服务源码、显示页和依赖 |
| /etc/vr-mcp-relay/relay.env | root 所有，0600 | 从 config/.env.example 填写的私有环境文件 |
| /var/lib/vr-mcp-relay | vr-relay 所有，0700 | 预留的状态目录；队列本身在内存中 |
| /etc/caddy/Caddyfile | root 所有，Caddy 可读 | 由示例复制并复核的配置 |
| /etc/systemd/system/vr-mcp-relay.service | root 所有，0644 | 从 unit 示例复制 |

服务用户 vr-relay 无交互登录权限。`HOST` 和 `TUNNEL_HOST` 都是 localhost。显示端口示例为 8787，MCP 端口示例为 8788。Caddy 只反代 MCP 端口。

## Caddy 与证书

待 VPS 改版更新：[Caddyfile 示例](../deploy/caddy/Caddyfile.example)只把 `/mcp` 交给 MCP 端口。显示页和 WebSocket 不出现在这个站点里。`flush_interval -1` 避免以后若返回事件流时被代理缓冲。

示例选择 Let's Encrypt ACME issuer。example.com 是文档占位，不能用它取得本项目证书。

## 启动与验收

待 VPS 改版更新：下列命令只供以后在 VPS 上执行，本次不执行。

```sh
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemd-analyze verify /etc/systemd/system/vr-mcp-relay.service
systemctl daemon-reload
systemctl enable --now vr-mcp-relay.service
systemctl reload caddy
systemctl status vr-mcp-relay.service --no-pager
```

健康检查在显示端口的 `/healthz`，不经过 Caddy。未加载配置或正在退出时，应用逻辑返回未就绪。本次没有在公网上验证这些命令。

## 运维

待 VPS 改版更新：systemd 在失败 3 秒后重启，并限制重启频率。日志只记录事件名、状态码、耗时和序号，不记录正文、令牌、配对口令或配对会话。journald 配额建议 200MB，以整机策略复核。

镜像构建见仓库根目录的 Dockerfile。容器内进程仍绑定 localhost，所以代理必须与它共享网络命名空间。本次没有构建或推送镜像。
