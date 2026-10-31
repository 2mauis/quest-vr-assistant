import { randomBytes } from "node:crypto";
import { readBody } from "../../relay/src/security.js";
import { toolDefinitions } from "./tools.js";

const MODERN = "2026-07-28";
const LEGACY = "2025-11-25";
const SERVER_INFO = { name: "vr-mcp-server", version: "0.1.0" };
const INSTRUCTIONS = "Tools show_scene, render_panel, and clear update one paired display. delivered is true only after that display acknowledges the sequence. A queued result has not been shown. This server is not a dialogue API.";

const PROTOCOL_META = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";

function isPlain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function headerValue(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) return null;
  if (typeof value !== "string" || value.includes(",")) return null;
  return value;
}

function decodeHeader(value) {
  if (value.startsWith("=?base64?") && value.endsWith("?=")) {
    const encoded = value.slice("=?base64?".length, -2);
    return Buffer.from(encoded, "base64").toString("utf8");
  }
  return value;
}

function acceptsStreamable(header) {
  if (typeof header !== "string") return false;
  const types = header.split(",").map((part) => part.split(";")[0].trim().toLowerCase());
  return types.includes("application/json") && types.includes("text/event-stream");
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  const body = { jsonrpc: "2.0", error };
  if (id !== undefined) body.id = id;
  return body;
}

function modernResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      ...result,
      _meta: { [SERVER_INFO_META]: SERVER_INFO },
    },
  };
}

function writeJson(res, status, body, extraHeaders = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": raw.length,
    ...extraHeaders,
  });
  res.end(raw);
}

function writeEmpty(res, status, extraHeaders = {}) {
  res.writeHead(status, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": 0,
    ...extraHeaders,
  });
  res.end();
}

function toolResultBody(payload, isError, modern) {
  const result = {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError,
  };
  if (modern) result.resultType = "complete";
  return result;
}

function eraOf(req, message) {
  const header = headerValue(req, "mcp-protocol-version");
  const metaVersion = message?.params?._meta?.[PROTOCOL_META];
  if (header === MODERN || metaVersion === MODERN) return "modern";
  if (typeof metaVersion === "string") return "modern";
  if (typeof header === "string" && header !== LEGACY) {
    if (message?.method === "initialize") return "legacy";
    return "modern";
  }
  return "legacy";
}

export function createMcpHandler(config, hub) {
  const sessions = new Map();

  function pruneSessions() {
    const at = Date.now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= at) sessions.delete(id);
    }
  }

  async function dispatchTool(message, modern) {
    const params = message.params;
    if (!isPlain(params) || typeof params.name !== "string") {
      return { status: modern ? 400 : 200, body: jsonRpcError(message.id, -32602, "Invalid params") };
    }
    if (!toolDefinitions.some((tool) => tool.name === params.name)) {
      return { status: modern ? 200 : 200, body: jsonRpcError(message.id, -32602, `Unknown tool: ${params.name}`) };
    }
    const outcome = await hub.call(params.name, params.arguments);
    const result = toolResultBody(outcome.payload, outcome.isError, modern);
    if (modern) {
      return { status: 200, body: modernResult(message.id, result) };
    }
    return { status: 200, body: { jsonrpc: "2.0", id: message.id, result } };
  }

  function handleModern(req, message) {
    const id = Object.hasOwn(message, "id") ? message.id : undefined;
    if (id === undefined) {
      return {
        status: 400,
        body: jsonRpcError(undefined, -32600, "Invalid Request"),
      };
    }
    const headerVersion = headerValue(req, "mcp-protocol-version");
    const meta = isPlain(message.params) ? message.params._meta : undefined;
    const metaVersion = isPlain(meta) ? meta[PROTOCOL_META] : undefined;
    if (typeof headerVersion !== "string" || headerVersion !== metaVersion) {
      return { status: 400, body: jsonRpcError(id, -32020, "Header mismatch: MCP-Protocol-Version") };
    }
    if (headerVersion !== MODERN) {
      return {
        status: 400,
        body: jsonRpcError(id, -32022, "Unsupported protocol version", {
          supported: [MODERN, LEGACY],
          requested: headerVersion,
        }),
      };
    }
    if (!isPlain(meta) || !isPlain(meta[CLIENT_CAPABILITIES]) || typeof metaVersion !== "string") {
      return { status: 400, body: jsonRpcError(id, -32602, "Invalid params") };
    }
    const methodHeader = headerValue(req, "mcp-method");
    if (methodHeader === null || decodeHeader(methodHeader) !== message.method) {
      return { status: 400, body: jsonRpcError(id, -32020, "Header mismatch: Mcp-Method") };
    }
    if (message.method === "tools/call") {
      const nameHeader = headerValue(req, "mcp-name");
      const bodyName = message.params?.name;
      if (nameHeader === null || decodeHeader(nameHeader) !== bodyName) {
        return { status: 400, body: jsonRpcError(id, -32020, "Header mismatch: Mcp-Name") };
      }
    }
    if (message.method === "server/discover") {
      return {
        status: 200,
        body: modernResult(id, {
          resultType: "complete",
          supportedVersions: [MODERN, LEGACY],
          capabilities: { tools: {} },
          instructions: INSTRUCTIONS,
        }),
      };
    }
    if (message.method === "tools/list") {
      if (message.params?.cursor) {
        return { status: 400, body: jsonRpcError(id, -32602, "Invalid params") };
      }
      return {
        status: 200,
        body: modernResult(id, { resultType: "complete", tools: toolDefinitions }),
      };
    }
    if (message.method === "tools/call") return "tool";
    return { status: 404, body: jsonRpcError(id, -32601, "Method not found") };
  }

  function handleLegacy(req, message) {
    pruneSessions();
    const method = message.method;
    if (method === "initialize") {
      if (!Object.hasOwn(message, "id")) {
        return { status: 400, body: jsonRpcError(undefined, -32600, "Invalid Request") };
      }
      const params = message.params;
      if (!isPlain(params) || typeof params.protocolVersion !== "string" || !isPlain(params.clientInfo)) {
        return { status: 400, body: jsonRpcError(message.id, -32602, "Invalid params") };
      }
      const sessionId = randomBytes(32).toString("hex");
      sessions.set(sessionId, {
        protocolVersion: LEGACY,
        initialized: false,
        expiresAt: Date.now() + config.sessionTtlMs,
      });
      return {
        status: 200,
        headers: { "mcp-session-id": sessionId },
        body: {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: LEGACY,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          },
        },
      };
    }
    const sessionId = headerValue(req, "mcp-session-id");
    if (sessionId === null) {
      return { status: 400, body: jsonRpcError(message.id, -32600, "Session required") };
    }
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return { status: 404, body: jsonRpcError(message.id, -32001, "Session not found") };
    }
    const versionHeader = headerValue(req, "mcp-protocol-version");
    if (versionHeader !== LEGACY) {
      return { status: 400, body: jsonRpcError(message.id, -32600, "Unsupported protocol version") };
    }
    if (!Object.hasOwn(message, "id")) {
      if (method === "notifications/initialized") {
        session.initialized = true;
        return { status: 202 };
      }
      if (method === "notifications/cancelled") return { status: 202 };
      return { status: 400, body: jsonRpcError(undefined, -32601, "Method not found") };
    }
    if (!session.initialized) {
      return { status: 400, body: jsonRpcError(message.id, -32600, "Not initialized") };
    }
    if (method === "tools/list") {
      return { status: 200, body: { jsonrpc: "2.0", id: message.id, result: { tools: toolDefinitions } } };
    }
    if (method === "ping") {
      return { status: 200, body: { jsonrpc: "2.0", id: message.id, result: {} } };
    }
    if (method === "tools/call") return "tool-legacy";
    return { status: 200, body: jsonRpcError(message.id, -32601, "Method not found") };
  }

  return async function handleMcp(req, res) {
    const started = Date.now();
    const url = new URL(req.url || "/", "http://localhost");
    if (url.search) {
      writeJson(res, 400, { error: "invalid_request" });
      return;
    }
    if (req.method === "GET") {
      writeEmpty(res, 405, { allow: "POST, DELETE" });
      return;
    }
    if (req.method === "DELETE") {
      pruneSessions();
      const sessionId = headerValue(req, "mcp-session-id");
      if (sessionId === null) {
        writeJson(res, 400, { error: "session_required" });
        return;
      }
      if (!sessions.delete(sessionId)) {
        writeJson(res, 404, { error: "not_found" });
        return;
      }
      writeEmpty(res, 204);
      return;
    }
    if (req.method !== "POST") {
      writeEmpty(res, 405, { allow: "POST, DELETE" });
      return;
    }
    const contentType = headerValue(req, "content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      writeJson(res, 400, jsonRpcError(null, -32600, "Invalid Request"));
      return;
    }
    if (!acceptsStreamable(req.headers.accept)) {
      writeJson(res, 400, jsonRpcError(null, -32600, "Invalid Request"));
      return;
    }
    const declared = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(declared) && declared > config.bodyLimit) {
      writeJson(res, 413, { error: "payload_too_large" });
      return;
    }
    let raw;
    try {
      raw = await readBody(req, config.bodyLimit);
    } catch (error) {
      writeJson(res, error.statusCode || 400, { error: "payload_too_large" });
      return;
    }
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      writeJson(res, 400, jsonRpcError(null, -32700, "Parse error"));
      return;
    }
    if (Array.isArray(message) || !isPlain(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      const id = isPlain(message) && Object.hasOwn(message, "id") ? message.id : null;
      writeJson(res, 400, jsonRpcError(id, -32600, "Invalid Request"));
      return;
    }
    const era = eraOf(req, message);
    let outcome;
    try {
      outcome = era === "modern" ? handleModern(req, message) : handleLegacy(req, message);
      if (outcome === "tool" || outcome === "tool-legacy") {
        outcome = await dispatchTool(message, outcome === "tool");
      }
    } catch {
      outcome = { status: 500, body: jsonRpcError(message.id, -32603, "Internal error") };
    }
    if (outcome.status === 202) {
      writeEmpty(res, 202);
    } else {
      writeJson(res, outcome.status, outcome.body, outcome.headers || {});
    }
    config.log?.("info", "mcp", {
      status: outcome.status,
      method: message.method,
      ms: Date.now() - started,
    });
  };
}

export { MODERN, LEGACY, INSTRUCTIONS };
