// Private listener (localhost / USB forward): display page, pairing API,
// health and the display WebSocket. It never serves `/mcp`.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { readBody, rejectUpgrade, writeEmpty, writeJson } from "../../../shared/node/http.ts";
import { PRESETS } from "../../../shared/protocol/index.ts";
import { isOriginAllowed, writeRateLimited } from "./auth.ts";
import type { RelayConfig } from "./config.ts";
import type { Hub } from "./hub.js";
import type { Logger } from "./logger.ts";
import { resolveDisplayFile, serveFile } from "./static-files.ts";

const PAIR_BODY_LIMIT = 4096;

type DisplayConfig = Pick<RelayConfig, "allowedOrigins" | "assetAllowedOrigins" | "bodyLimit">;

export interface DisplayServer {
  server: Server;
  sockets: WebSocketServer;
}

function parseDeviceRequest(raw: Buffer, refreshing: boolean): Record<string, unknown> | null {
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const allowedKeys = refreshing ? ["refresh_token"] : ["token", "remember"];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) return null;
  if (!refreshing && record.remember !== undefined && typeof record.remember !== "boolean") return null;
  return record;
}

export function createDisplayServer(config: DisplayConfig, hub: Hub, root: string, log: Logger): DisplayServer {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: config.bodyLimit });

  // The page's own origin is allowed here only; it never unlocks the MCP listener.
  function localOriginAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    const address = server.address();
    if (typeof origin === "string" && address && typeof address === "object") {
      if (origin === `http://localhost:${address.port}`) return true;
    }
    return isOriginAllowed(origin, config.allowedOrigins);
  }

  async function deviceSession(req: IncomingMessage, res: ServerResponse, refreshing: boolean) {
    if (!localOriginAllowed(req)) {
      writeJson(res, 403, { error: "forbidden" });
      return;
    }
    if (req.method !== "POST") {
      writeEmpty(res, 405, { allow: "POST", "content-type": "text/plain; charset=utf-8" });
      return;
    }
    let raw: Buffer;
    try {
      raw = await readBody(req, PAIR_BODY_LIMIT);
    } catch {
      writeJson(res, 413, { error: "payload_too_large" });
      return;
    }
    const body = parseDeviceRequest(raw, refreshing);
    if (!body) {
      writeJson(res, 400, { error: "invalid_request" });
      return;
    }
    const outcome = refreshing ? hub.refresh(body.refresh_token) : hub.pair(body.token, undefined, body.remember === true);
    if (outcome.ok) writeJson(res, 200, outcome.body);
    else if (outcome.status === 429) writeRateLimited(res);
    else writeJson(res, 401, { error: "unauthorized" });
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;
    if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      writeJson(res, 404, { error: "not_found" });
    } else if (pathname === "/healthz" && req.method === "GET") {
      const ready = !hub.draining();
      writeJson(res, ready ? 200 : 503, { ready, display_connected: hub.displayConnected() });
    } else if (pathname === "/api/display/config" && req.method === "GET") {
      writeJson(res, 200, { asset_origins: config.assetAllowedOrigins, presets: [...PRESETS] });
    } else if (pathname === "/api/debug/interactions" && req.method === "GET") {
      writeJson(res, 200, { events: hub.interactions() });
    } else if (pathname === "/api/device/pair" || pathname === "/api/device/refresh") {
      await deviceSession(req, res, pathname === "/api/device/refresh");
    } else if (req.method !== "GET" && req.method !== "HEAD") {
      writeJson(res, 404, { error: "not_found" });
    } else {
      const file = resolveDisplayFile(root, pathname);
      if (file) await serveFile(res, file, req.method);
      else writeJson(res, 404, { error: "not_found" });
    }
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      log("error", "display_failure", { error: error instanceof Error ? error.name : "unknown" });
      if (!res.headersSent) writeJson(res, 500, { error: "internal" });
      else res.destroy();
    });
  });

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/ws" || url.search) {
      rejectUpgrade(socket, 404);
      return;
    }
    if (!localOriginAllowed(req)) {
      rejectUpgrade(socket, 403);
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => hub.attach(ws));
  });

  return { server, sockets };
}
