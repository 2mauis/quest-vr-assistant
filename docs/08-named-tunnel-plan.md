# 具名 Tunnel 计划

本页只是计划。写它的时候没有修改 DNS、WAF、账号、Tunnel 资源或连接器。当前公网调试仍用 Quick Tunnel，并且只转发 `/mcp`。已有记录见 [config/cloudflared/README.md](../config/cloudflared/README.md)。下面每一项在执行前都要机主单独批准。

## 计划中的名字

| 用途 | 占位 |
|---|---|
| 站点 | `example.com` |
| MCP 主机名 | `mcp.example.com` |
| 连接器地址 | `https://mcp.example.com/mcp` |
| Tunnel ID | `<PLACEHOLDER>` |
| 凭据文件 | `<PRIVATE_TUNNEL_CREDENTIALS_FILE>` |
| 中继端口 | 与本机 `TUNNEL_PORT` 相同，示例为 `8788` |

不要把真实主机名、账号标识、Tunnel ID、令牌或临时 Quick Tunnel 地址写进仓库。

## 需要机主授权后才能做的操作

1. 确认正式主机名就是 `mcp.example.com` 这一类名字，而不是临时 Quick Tunnel 主机名。
2. 在 Cloudflare 账号里选定或新建具名 Tunnel，并记下 Tunnel ID。
3. 为该主机名创建或修改指向该 Tunnel 的 DNS 记录。
4. 把 Tunnel 凭据放到仓库外的私有文件，权限不向其他用户开放。
5. 把 ingress 配成只把 `^/mcp$` 转到本机中继端口，其余返回 404。
6. 修改仓库外的 `named-tunnel.env`：`MCP_PUBLIC_URL=https://mcp.example.com/mcp`，`TUNNEL_TOKEN_FILE` 或凭据路径指向该私有文件。
7. 修改 `scripts/start-named-tunnel.mjs` 的启动参数，使 `cloudflared` 使用下面的本地 `config.yml`，而不是只靠远端 token 配置。这一步会改脚本，仍须先批准。
8. 把托管连接器的 MCP 地址改成 `https://mcp.example.com/mcp`，Bearer 仍用现有的 `MCP_BEARER_SECRET`，不放进 URL。
9. 用 `qvr up` 或 `qvr tunnel` 启动新进程，并确认无 Bearer 的 `/mcp` 返回 401、其他路径返回 404。
10. 连接器对三个工具联调通过之后，再停止旧的 Quick Tunnel 进程。
11. 任何 WAF、Access、账号成员或计费变更。

未列入上表的云端写操作也不要顺手做。

## 计划中的 cloudflared 配置

下面的文件放在仓库外。它还没有被任何脚本读取。

```yaml
tunnel: <PLACEHOLDER>
credentials-file: <PRIVATE_TUNNEL_CREDENTIALS_FILE>
ingress:
  - hostname: mcp.example.com
    path: ^/mcp$
    service: http://localhost:8788
  - service: http_status:404
```

`8788` 必须改成实际的 `TUNNEL_PORT`。配置里不要出现显示端口、`/ws`、配对路径或 Quick Tunnel 主机名。

## `qvr` 和连接器会怎样变

现在 `scripts/qvr.sh` 读取仓库外的 `named-tunnel.env`，`scripts/start-named-tunnel.mjs` 以 `cloudflared tunnel run --token-file` 启动，ingress 来自远端。`qvr url` 打印 `MCP_PUBLIC_URL`。

批准并改完脚本之后：

- `named-tunnel.env` 的 `MCP_PUBLIC_URL` 改为 `https://mcp.example.com/mcp`。
- 启动参数改为使用上面的 `config.yml`（`--config`），凭据文件仍在仓库外。
- `qvr status` 继续检查本机中继端口和 `MCP_PUBLIC_URL` 是否返回 401。
- 托管连接器里的 MCP URL 从当前 Quick Tunnel 或旧固定地址改为 `https://mcp.example.com/mcp`。工具名和 Bearer 方式不变。
- 显示配对和 WebSocket 仍走开发机的显示端口，不进这条 ingress。

这些脚本改动不属于本计划的落地范围。

## 回滚

1. 把托管连接器的 MCP URL 改回切换前正在使用的地址。
2. 停止这次启动的 cloudflared 进程。不要误停无关进程。
3. 把 `named-tunnel.env` 的 `MCP_PUBLIC_URL` 和凭据路径改回切换前的私有值。
4. 若已经改了 DNS 或 ingress，按批准时记录的前一版改回；没有记录就不要猜。
5. 用无 Bearer 的 `/mcp` 应返回 401、其他路径应返回 404，再视为入口恢复。不把这一步写成头显验收。

## 风险

- 主机名一切换，旧连接器会立刻打到错误地址，直到有人改连接器。
- DNS 记录生效前，新地址会失败；不要在这段时间删掉仍在使用的 Quick Tunnel。
- ingress 若宽于 `^/mcp$`，会把显示、配对或其他本地服务暴露出去。
- 凭据文件若进了仓库、日志或聊天，就要作废并换新，而不是继续使用。
- 两个 cloudflared 同时跑时，流量可能进错进程。
- 本地 `config.yml` 和远端 token 配置不一致时，以实际加载的那份为准；切换前要先确认加载的是哪一份。
- 本计划不产生头显 `delivered: true`，也不改 MCP 工具 schema。
