// One `/mcp` endpoint for two protocol eras. 2026-07-28 requests go to the
// SDK's stateless `createMcpHandler` with the 2025 fallback disabled; 2025-11-25
// requests use a sessionful NodeStreamableHTTPServerTransport so that
// initialize, Mcp-Session-Id and DELETE keep working. Authorization happens
// before this module is called.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpHandler as createSdkMcpHandler, isLegacyRequest } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import { BodyReadError, readBody, writeEmpty, writeJson } from "../../../shared/node/http.ts";
import { LegacySessionStore } from "./legacy-sessions.ts";
import { createToolServer, type ToolCaller } from "./mcp-server.ts";

export type McpLog = (level: "error" | "info" | "debug", event: string, fields?: Record<string, unknown>) => void;

export interface McpHandlerOptions {
  bodyLimit: number;
  legacySessionTtlMs: number;
  maxLegacySessions?: number;
  log?: McpLog;
}

export interface McpHandler {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  method: string;
  id?: unknown;
  [key: string]: unknown;
}

const ALLOW = { allow: "POST, DELETE" } as const;

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return isPlain(value) && value.jsonrpc === "2.0" && typeof value.method === "string";
}

/** Single-valued header; repeated or comma-joined values are treated as absent. */
function singleHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (typeof value !== "string" || value.includes(",")) return null;
  return value;
}

function acceptsStreamable(header: string | undefined): boolean {
  if (typeof header !== "string") return false;
  const types = header.split(",").map((part) => (part.split(";")[0] ?? "").trim().toLowerCase());
  return types.includes("application/json") && types.includes("text/event-stream");
}

function jsonRpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  const body: Record<string, unknown> = { jsonrpc: "2.0", error: { code, message } };
  if (id !== undefined) body.id = id;
  return body;
}

export function createMcpHandler(options: McpHandlerOptions, caller: ToolCaller): McpHandler {
  const sessions = new LegacySessionStore({
    ttlMs: options.legacySessionTtlMs,
    maxSessions: options.maxLegacySessions ?? 64,
  });
  const modern = toNodeHandler(
    createSdkMcpHandler(() => createToolServer(caller), {
      legacy: "reject",
      maxRequestBodySize: options.bodyLimit,
    }),
    { maxRequestBodySize: options.bodyLimit },
  );

  async function openLegacySession(req: IncomingMessage, res: ServerResponse, message: JsonRpcMessage) {
    const server = createToolServer(caller);
    let opened = false;
    const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        opened = true;
        sessions.add(sessionId, transport);
      },
      onsessionclosed: (sessionId) => sessions.forget(sessionId),
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, message);
    } finally {
      // A rejected initialize never gets a session id; nothing else can reach it.
      if (!opened) await server.close().catch(() => undefined);
    }
  }

  async function handleLegacy(req: IncomingMessage, res: ServerResponse, message: JsonRpcMessage) {
    const sessionId = singleHeader(req, "mcp-session-id");
    if (!sessionId) {
      if (message.method !== "initialize") {
        writeJson(res, 400, jsonRpcError(message.id, -32600, "Session required"));
        return;
      }
      await openLegacySession(req, res, message);
      return;
    }
    const transport = sessions.touch(sessionId);
    if (!transport) {
      writeJson(res, 404, jsonRpcError(message.id, -32001, "Session not found"));
      return;
    }
    await transport.handleRequest(req, res, message);
  }

  async function handleDelete(req: IncomingMessage, res: ServerResponse) {
    const sessionId = singleHeader(req, "mcp-session-id");
    if (sessionId === null) {
      writeJson(res, 400, { error: "session_required" });
      return;
    }
    sessions.prune();
    // The SDK transport answers DELETE with 200; clients rely on the empty 204.
    if (!(await sessions.remove(sessionId))) {
      writeJson(res, 404, { error: "not_found" });
      return;
    }
    writeEmpty(res, 204);
  }

  async function handlePost(req: IncomingMessage, res: ServerResponse, noteMethod: (method: string) => void) {
    const contentType = singleHeader(req, "content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json") || !acceptsStreamable(req.headers.accept)) {
      writeJson(res, 400, jsonRpcError(null, -32600, "Invalid Request"));
      return;
    }
    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > options.bodyLimit) {
      writeJson(res, 413, { error: "payload_too_large" });
      return;
    }
    let raw: Buffer;
    try {
      raw = await readBody(req, options.bodyLimit);
    } catch (error) {
      const code = error instanceof BodyReadError ? error.code : "request_aborted";
      writeJson(res, error instanceof BodyReadError ? error.statusCode : 400, { error: code });
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      writeJson(res, 400, jsonRpcError(null, -32700, "Parse error"));
      return;
    }
    if (!isJsonRpcMessage(message)) {
      const id = isPlain(message) && Object.hasOwn(message, "id") ? message.id : null;
      writeJson(res, 400, jsonRpcError(id, -32600, "Invalid Request"));
      return;
    }
    noteMethod(message.method);
    const webRequest = await toWebRequest(req, message);
    if (await isLegacyRequest(webRequest, message)) {
      await handleLegacy(req, res, message);
    } else {
      await modern(req, res, message);
    }
  }

  return {
    async handle(req, res) {
      const started = Date.now();
      let method = req.method ?? "";
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.search) {
          writeJson(res, 400, { error: "invalid_request" });
        } else if (req.method === "DELETE") {
          await handleDelete(req, res);
        } else if (req.method === "POST") {
          await handlePost(req, res, (value) => {
            method = value;
          });
        } else {
          writeEmpty(res, 405, ALLOW);
        }
      } catch (error) {
        options.log?.("error", "mcp_internal", { method, error: error instanceof Error ? error.name : "unknown" });
        if (!res.headersSent) writeJson(res, 500, jsonRpcError(null, -32603, "Internal error"));
      } finally {
        options.log?.("info", "mcp", { status: res.statusCode, method, ms: Date.now() - started });
      }
    },
    close: () => sessions.closeAll(),
  };
}
