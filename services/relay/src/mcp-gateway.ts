// Public listener behind the Tunnel. Only the exact `/mcp` path exists; every
// other path, and every WebSocket upgrade, is a 404.
import { createServer, type Server } from "node:http";
import { rejectUpgrade, writeJson } from "../../../shared/node/http.ts";
import { createRateLimiter } from "../../../shared/node/rate-limit.ts";
import type { McpHandler } from "../../vr-mcp-server/src/index.ts";
import { isAuthorizedBearer, isOriginAllowed, writeRateLimited, writeUnauthorized } from "./auth.ts";
import type { RelayConfig } from "./config.ts";
import type { Logger } from "./logger.ts";

export function createMcpGateway(
  config: Pick<RelayConfig, "mcpBearerSecret" | "mcpRatePerMinute" | "allowedOrigins">,
  mcp: McpHandler,
  log: Logger,
): Server {
  const allowCall = createRateLimiter(config.mcpRatePerMinute, 60_000);
  const allowFailure = createRateLimiter(config.mcpRatePerMinute, 60_000);

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/mcp") {
        writeJson(res, 404, { error: "not_found" });
        return;
      }
      if (!isAuthorizedBearer(req.headers.authorization, config.mcpBearerSecret)) {
        if (!allowFailure(Date.now())) writeRateLimited(res);
        else writeUnauthorized(res);
        return;
      }
      if (!allowCall(Date.now())) {
        writeRateLimited(res);
        return;
      }
      if (!isOriginAllowed(req.headers.origin, config.allowedOrigins)) {
        writeJson(res, 403, { error: "forbidden" });
        return;
      }
      await mcp.handle(req, res);
    })().catch((error: unknown) => {
      log("error", "mcp_failure", { status: 500, error: error instanceof Error ? error.name : "unknown" });
      if (!res.headersSent) writeJson(res, 500, { error: "internal" });
      else res.destroy();
    });
  });

  server.on("upgrade", (_req, socket) => rejectUpgrade(socket, 404));
  return server;
}
