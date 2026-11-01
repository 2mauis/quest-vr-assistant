import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createHub } from "./hub.js";
import { createLogger } from "./logger.js";
import { jsonBytes, readBody, safeEqualBearer } from "./security.js";
import { createMcpHandler } from "../../vr-mcp-server/src/handle.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DISPLAY_ROOT = path.join(ROOT, "apps", "web-display");
const THREE_ROOT = path.join(ROOT, "node_modules", "three");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function securityHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  };
}

function send(res, status, body, headers = {}) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    ...securityHeaders(headers),
    "content-length": raw.length,
  });
  res.end(raw);
}

function sendJson(res, status, value, headers = {}) {
  send(res, status, jsonBytes(value), {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
}

function unauthorized(res) {
  sendJson(res, 401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="mcp"' });
}

function originAllowed(config, req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (Array.isArray(origin)) return false;
  return config.allowedOrigins.includes(origin);
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function within(root, candidate) {
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

async function serveFile(res, root, relativePath) {
  const full = path.resolve(root, relativePath);
  if (!within(root, full)) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  const extension = path.extname(full).toLowerCase();
  const type = TYPES[extension];
  if (!type) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  let info;
  try {
    info = await stat(full);
  } catch {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  if (!info.isFile()) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  const headers = securityHeaders({ "content-type": type, "content-length": info.size });
  if (extension === ".html") {
    headers["content-security-policy"] = "default-src 'self'; script-src 'self' 'sha256-TXQtlLv9hkrPD55l4tCZbV94hPBYXzUd42IGR1ZWUjY='; style-src 'self'; img-src 'self' data:; connect-src 'self' https:; worker-src 'none'";
  }
  res.writeHead(200, headers);
  createReadStream(full).pipe(res);
}

function displayPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") return { root: DISPLAY_ROOT, file: "index.html" };
  if (["/main.js", "/xr.js", "/styles.css"].includes(pathname)) {
    return { root: DISPLAY_ROOT, file: pathname.slice(1) };
  }
  if (pathname.startsWith("/vendor/three/")) {
    return { root: THREE_ROOT, file: pathname.slice("/vendor/three/".length) };
  }
  return null;
}

export function createApp(config) {
  const log = createLogger(config.logLevel);
  const hub = createHub(config);
  const runtime = { ...config, log };
  const handleMcp = createMcpHandler(runtime, hub);
  const mcpHits = [];
  const mcpFailures = [];

  function allowRate(bucket, limit) {
    const at = Date.now();
    while (bucket.length > 0 && at - bucket[0] >= 60_000) bucket.shift();
    if (bucket.length >= limit) return false;
    bucket.push(at);
    return true;
  }

  const tunnel = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const authorized = safeEqualBearer(req.headers.authorization, config.mcpBearerSecret);
    if (!authorized) {
      if (!allowRate(mcpFailures, config.mcpRatePerMinute)) {
        sendJson(res, 429, { error: "rate_limited" }, { "retry-after": "60" });
        return;
      }
      unauthorized(res);
      return;
    }
    if (!allowRate(mcpHits, config.mcpRatePerMinute)) {
      sendJson(res, 429, { error: "rate_limited" }, { "retry-after": "60" });
      return;
    }
    if (!originAllowed(config, req)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }
    try {
      await handleMcp(req, res);
    } catch (error) {
      log("error", "mcp_failure", { status: 500 });
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
    }
  });

  tunnel.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
    socket.destroy();
  });

  const local = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    if (url.pathname === "/healthz" && req.method === "GET") {
      const ready = !hub.draining();
      sendJson(res, ready ? 200 : 503, { ready, display_connected: hub.displayConnected() });
      return;
    }
    if (url.pathname === "/api/display/config" && req.method === "GET") {
      sendJson(res, 200, {
        asset_origins: config.assetAllowedOrigins,
        presets: ["grid", "orbit", "crystal", "pedestal"],
      });
      return;
    }
    if (url.pathname === "/api/debug/interactions" && req.method === "GET") {
      sendJson(res, 200, { events: hub.interactions() });
      return;
    }
    if (url.pathname === "/api/device/pair") {
      if (!localOriginAllowed(req)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      if (req.method !== "POST") {
        send(res, 405, "", { allow: "POST", "content-type": "text/plain; charset=utf-8" });
        return;
      }
      let raw;
      try {
        raw = await readBody(req, 4096);
      } catch {
        sendJson(res, 413, { error: "payload_too_large" });
        return;
      }
      let body;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "token")) {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }
      const outcome = hub.pair(body.token);
      if (!outcome.ok) {
        if (outcome.status === 429) {
          sendJson(res, 429, { error: "rate_limited" }, { "retry-after": "60" });
          return;
        }
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      sendJson(res, 200, outcome.body);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const mapped = displayPath(url.pathname);
    if (!mapped) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    await serveFile(res, mapped.root, mapped.file);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.bodyLimit });
  function localOriginAllowed(req) {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    if (Array.isArray(origin)) return false;
    const address = local.address();
    if (address && origin === `http://localhost:${address.port}`) return true;
    return config.allowedOrigins.includes(origin);
  }

  local.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/ws" || url.search) {
      socket.write("HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!localOriginAllowed(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.attach(ws);
    });
  });

  return {
    hub,
    async start() {
      const port = await listen(local, config.host, config.port);
      const tunnelPort = await listen(tunnel, config.tunnelHost, config.tunnelPort);
      log("info", "listening", { port, tunnel_port: tunnelPort });
      return { port, tunnelPort };
    },
    async close() {
      hub.drain();
      await new Promise((resolve) => wss.close(resolve));
      await Promise.all([
        new Promise((resolve) => local.close(resolve)),
        new Promise((resolve) => tunnel.close(resolve)),
      ]);
    },
  };
}
