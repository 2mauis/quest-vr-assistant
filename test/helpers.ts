import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import { createApp } from "../services/relay/src/app.ts";
import { loadConfig, type Env } from "../services/relay/src/config.ts";

export const MODERN = "2026-07-28";

export function testEnv(overrides: Env = {}): Record<string, string | undefined> {
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

export interface StartedApp {
  app: ReturnType<typeof createApp>;
  env: { MCP_BEARER_SECRET: string; DEVICE_PAIRING_TOKEN: string } & Record<string, string | undefined>;
  config: ReturnType<typeof loadConfig>;
  port: number;
  tunnelPort: number;
}

export async function startTestApp(overrides: Env = {}): Promise<StartedApp> {
  const env = testEnv(overrides);
  const config = loadConfig(env);
  const app = createApp(config);
  const addresses = await app.start();
  return {
    app,
    env: { ...env, MCP_BEARER_SECRET: config.mcpBearerSecret, DEVICE_PAIRING_TOKEN: config.devicePairingToken },
    config,
    ...addresses,
  };
}

export function mcpHeaders(token: string, method: string, name?: string): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": MODERN,
    "mcp-method": method,
  };
  if (name) headers["mcp-name"] = name;
  return headers;
}

export function modernBody(id: number, method: string, params: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.1.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

/** Loosely typed JSON-RPC response; tests assert on the shape they expect. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ response: Response; json: Json; text: string }> {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null, text };
}

export async function mcpCall(port: number, token: string, name: string, args: Record<string, unknown>, id = 1) {
  const { response, json } = await postJson(
    `http://localhost:${port}/mcp`,
    mcpHeaders(token, "tools/call", name),
    modernBody(id, "tools/call", { name, arguments: args }),
  );
  return { response, body: json as Json };
}

export interface DisplayMessage {
  v: number;
  type: string;
  seq?: number;
  request_id?: string;
  body?: Json;
}

/** A WebSocket test display that records every downlink message. */
export class TestDisplay {
  readonly socket: WebSocket;
  readonly messages: DisplayMessage[] = [];
  readonly #waiters = new Set<{ predicate: (m: DisplayMessage) => boolean; resolve: (m: DisplayMessage) => void }>();

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as DisplayMessage;
      this.messages.push(message);
      for (const waiter of this.#waiters) {
        if (waiter.predicate(message)) {
          this.#waiters.delete(waiter);
          waiter.resolve(message);
        }
      }
    });
  }

  opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.once("open", () => resolve());
      this.socket.once("error", reject);
    });
  }

  closed(): Promise<number> {
    return new Promise((resolve) => this.socket.once("close", (code) => resolve(code)));
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ v: 1, ...message }));
  }

  waitFor(predicate: (m: DisplayMessage) => boolean, timeoutMs = 2000): Promise<DisplayMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: (message: DisplayMessage) => {
          clearTimeout(timer);
          resolve(message);
        },
      };
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        reject(new Error("timed out waiting for a display message"));
      }, timeoutMs);
      this.#waiters.add(waiter);
    });
  }

  close(): void {
    this.socket.close();
  }
}

export async function pairDisplay(started: StartedApp, remember = false): Promise<Json> {
  const response = await fetch(`http://localhost:${started.port}/api/device/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: started.env.DEVICE_PAIRING_TOKEN, ...(remember ? { remember } : {}) }),
  });
  if (response.status !== 200) throw new Error(`pairing failed with HTTP ${response.status}`);
  return response.json();
}

export async function connectDisplay(started: StartedApp, lastSeq: number): Promise<TestDisplay> {
  const credentials = await pairDisplay(started);
  const display = new TestDisplay(`ws://localhost:${started.port}/ws`);
  await display.opened();
  display.send({ type: "auth", body: { session_token: credentials.session_token, last_seq: lastSeq } });
  await display.waitFor((message) => message.type === "auth_ok");
  return display;
}
