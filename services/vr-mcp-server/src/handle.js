import { randomUUID } from "node:crypto";
import { createMcpHandler as createSdkMcpHandler, isLegacyRequest, McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import { readBody } from "../../relay/src/security.js";
import { toolDefinitions } from "./tools.js";

const MODERN = "2026-07-28";
const LEGACY = "2025-11-25";
const SERVER_INFO = { name: "vr-mcp-server", version: "0.1.0" };
const INSTRUCTIONS = "Tools show_scene, render_panel, and clear update one paired display. delivered is true only after that display acknowledges the sequence. A queued result has not been shown. This server is not a dialogue API.";

// @modelcontextprotocol/sdk has no 2.x release. SDK v2 is the split
// @modelcontextprotocol/server + @modelcontextprotocol/node line. createMcpHandler
// serves 2026-07-28 and, by default, a stateless 2025 fallback that answers
// GET and DELETE with 405. This module keeps the sessionful 2025-11-25
// handshake on NodeStreamableHTTPServerTransport and routes it beside a
// strict modern handler. Bearer checks stay in the relay.

function isPlain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function headerValue(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) return null;
  if (typeof value !== "string" || value.includes(",")) return null;
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

function advertise(jsonSchema) {
  return {
    "~standard": {
      version: 1,
      vendor: "quest-vr-assistant",
      validate(value) {
        return { value };
      },
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  };
}

function buildServer(hub) {
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    supportedProtocolVersions: [MODERN, LEGACY],
  });
  for (const tool of toolDefinitions) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: advertise(tool.inputSchema),
    }, async (args) => {
      const outcome = await hub.call(tool.name, args);
      return {
        content: [{ type: "text", text: JSON.stringify(outcome.payload) }],
        structuredContent: outcome.payload,
        isError: outcome.isError,
      };
    });
  }
  return server;
}

export function createMcpHandler(config, hub) {
  const sessions = new Map();
  const modern = createSdkMcpHandler(() => buildServer(hub), {
    legacy: "reject",
    maxRequestBodySize: config.bodyLimit,
  });
  const modernNode = toNodeHandler(modern, { maxRequestBodySize: config.bodyLimit });

  function pruneSessions() {
    const at = Date.now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= at) {
        sessions.delete(id);
        session.transport.close().catch(() => {});
      }
    }
  }

  async function openLegacySession(req, res, message) {
    let transport;
    const server = buildServer(hub);
    transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, {
          transport,
          expiresAt: Date.now() + config.sessionTtlMs,
        });
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, message);
  }

  async function handleLegacy(req, res, message) {
    pruneSessions();
    const sessionId = headerValue(req, "mcp-session-id");
    if (!sessionId) {
      if (message.method !== "initialize") {
        writeJson(res, 400, jsonRpcError(message.id, -32600, "Session required"));
        return;
      }
      await openLegacySession(req, res, message);
      return;
    }
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      writeJson(res, 404, jsonRpcError(message.id, -32001, "Session not found"));
      return;
    }
    session.expiresAt = Date.now() + config.sessionTtlMs;
    await session.transport.handleRequest(req, res, message);
  }

  async function handleDelete(req, res) {
    pruneSessions();
    const sessionId = headerValue(req, "mcp-session-id");
    if (sessionId === null) {
      writeJson(res, 400, { error: "session_required" });
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      writeJson(res, 404, { error: "not_found" });
      return;
    }
    // The SDK transport answers DELETE with 200. Keep the existing empty 204.
    sessions.delete(sessionId);
    await session.transport.close();
    writeEmpty(res, 204);
  }

  return async function handleMcp(req, res) {
    const started = Date.now();
    const url = new URL(req.url || "/", "http://localhost");
    let method = req.method || "";
    try {
      if (url.search) {
        writeJson(res, 400, { error: "invalid_request" });
        return;
      }
      if (req.method === "GET") {
        writeEmpty(res, 405, { allow: "POST, DELETE" });
        return;
      }
      if (req.method === "DELETE") {
        await handleDelete(req, res);
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
      method = message.method;
      const webRequest = await toWebRequest(req, message);
      if (await isLegacyRequest(webRequest, message)) {
        await handleLegacy(req, res, message);
      } else {
        await modernNode(req, res, message);
      }
    } catch {
      if (!res.headersSent) writeJson(res, 500, jsonRpcError(null, -32603, "Internal error"));
    } finally {
      config.log?.("info", "mcp", {
        status: res.statusCode,
        method,
        ms: Date.now() - started,
      });
    }
  };
}

export { MODERN, LEGACY, INSTRUCTIONS };
