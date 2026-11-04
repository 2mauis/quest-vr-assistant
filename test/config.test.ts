import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { ConfigError, loadConfig } from "../services/relay/src/config.ts";
import { testEnv } from "./helpers.ts";

function runStart(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["services/relay/src/index.ts"], { env, cwd: process.cwd() });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

test("loadConfig accepts the local listener contract", () => {
  const env = testEnv();
  const config = loadConfig(env);
  assert.equal(config.host, "localhost");
  assert.equal(config.tunnelHost, "localhost");
  assert.equal(config.mcpBearerSecret, env.MCP_BEARER_SECRET);
  assert.equal(config.ackWaitMs, 300);
});

test("startup fails when a required secret is unset and never echoes secrets", async () => {
  const env = testEnv();
  delete env.MCP_BEARER_SECRET;
  const result = await runStart(env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /MCP_BEARER_SECRET/);
  assert.equal(result.stderr.includes(env.DEVICE_PAIRING_TOKEN ?? "unset"), false);
});

test("startup rejects placeholder and duplicated secrets", () => {
  assert.throws(() => loadConfig(testEnv({ MCP_BEARER_SECRET: "<PLACEHOLDER>" })), ConfigError);
  assert.throws(() => loadConfig(testEnv({ MCP_BEARER_SECRET: "short" })), ConfigError);
  const shared = "a".repeat(40);
  assert.throws(() => loadConfig(testEnv({ MCP_BEARER_SECRET: shared, DEVICE_PAIRING_TOKEN: shared })), /必须不同/);
});

test("startup rejects non-local hosts, bad numbers and bad origins", () => {
  assert.throws(() => loadConfig(testEnv({ HOST: "example.com" })), ConfigError);
  assert.throws(() => loadConfig(testEnv({ TUNNEL_HOST: "tunnel.example.com" })), ConfigError);
  assert.throws(() => loadConfig(testEnv({ ACK_WAIT_MS: "1.5" })), /ACK_WAIT_MS/);
  assert.throws(() => loadConfig(testEnv({ QUEUE_MAX_MESSAGES: "1000" })), /QUEUE_MAX_MESSAGES/);
  assert.throws(() => loadConfig(testEnv({ LOG_LEVEL: "trace" })), /LOG_LEVEL/);
  assert.throws(() => loadConfig(testEnv({ ASSET_ALLOWED_ORIGINS: "http://assets.example.com" })), ConfigError);
  assert.throws(() => loadConfig(testEnv({ PORT: "8787", TUNNEL_PORT: "8787" })), /必须不同/);
});
