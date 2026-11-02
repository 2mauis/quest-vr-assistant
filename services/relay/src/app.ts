import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "../../vr-mcp-server/src/index.ts";
import type { RelayConfig } from "./config.ts";
import { createDisplayServer } from "./display-server.ts";
import { createHub } from "./hub.js";
import { createLogger } from "./logger.ts";
import { createMcpGateway } from "./mcp-gateway.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DISPLAY_ROOT = path.join(ROOT, "apps", "web-display", "dist");

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      resolve(address && typeof address === "object" ? address.port : port);
    });
  });
}

function shutdown(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export function createApp(config: RelayConfig) {
  const log = createLogger(config.logLevel);
  const hub = createHub(config);
  const mcp = createMcpHandler({ bodyLimit: config.bodyLimit, legacySessionTtlMs: config.sessionTtlMs, log }, hub);
  const display = createDisplayServer(config, hub, DISPLAY_ROOT, log);
  const gateway = createMcpGateway(config, mcp, log);

  return {
    hub,
    async start(): Promise<{ port: number; tunnelPort: number }> {
      const port = await listen(display.server, config.host, config.port);
      const tunnelPort = await listen(gateway, config.tunnelHost, config.tunnelPort);
      log("info", "listening", { port, tunnel_port: tunnelPort });
      return { port, tunnelPort };
    },
    async close(): Promise<void> {
      hub.drain();
      // Pending and replaced sockets would otherwise keep their auth / heartbeat timers alive.
      for (const client of display.sockets.clients) client.terminate();
      await new Promise<void>((resolve) => display.sockets.close(() => resolve()));
      await mcp.close();
      await Promise.all([shutdown(display.server), shutdown(gateway)]);
    },
  };
}

export type App = ReturnType<typeof createApp>;
