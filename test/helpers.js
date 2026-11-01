import { randomBytes } from "node:crypto";
import { createApp } from "../services/relay/src/app.js";
import { loadConfig } from "../services/relay/src/config.js";

export function testEnv(overrides = {}) {
  return {
    HOST: "localhost",
    PORT: "0",
    TUNNEL_HOST: "localhost",
    TUNNEL_PORT: "0",
    PUBLIC_BASE_URL: "http://localhost:8787",
    MCP_BEARER_SECRET: randomBytes(32).toString("hex"),
    DEVICE_PAIRING_TOKEN: randomBytes(32).toString("hex"),
    ASSET_ALLOWED_ORIGINS: "https://assets.example.com",
    ALLOWED_ORIGINS: "",
    ACK_WAIT_MS: "300",
    LOG_LEVEL: "error",
    ...overrides,
  };
}

export async function startTestApp(overrides = {}) {
  const env = testEnv(overrides);
  const config = loadConfig(env);
  const app = createApp(config);
  const addresses = await app.start();
  return { app, env, config, ...addresses };
}

export function mcpHeaders(token, method, name) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  };
  if (name) headers["mcp-name"] = name;
  return headers;
}

export function modernBody(id, method, params) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.1.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

export async function mcpCall(port, token, name, args, id = 1) {
  const response = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token, "tools/call", name),
    body: JSON.stringify(modernBody(id, "tools/call", { name, arguments: args })),
  });
  const body = await response.json();
  return { response, body };
}
