import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { loadConfig, ConfigError } from "../services/relay/src/config.js";
import { safeEqual } from "../services/relay/src/security.js";
import { testEnv } from "./helpers.js";

function runStart(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["services/relay/src/index.js"], {
      env,
      cwd: process.cwd(),
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

test("safeEqual matches identical strings and rejects others", () => {
  assert.equal(safeEqual("alpha", "alpha"), true);
  assert.equal(safeEqual("alpha", "beta"), false);
  assert.equal(safeEqual("", "beta"), false);
});

test("loadConfig accepts the local listener contract", () => {
  const env = testEnv();
  const config = loadConfig(env);
  assert.equal(config.host, "localhost");
  assert.equal(config.tunnelHost, "localhost");
  assert.equal(config.mcpBearerSecret, env.MCP_BEARER_SECRET);
});

test("startup fails when a required secret is unset", async () => {
  const env = testEnv();
  delete env.MCP_BEARER_SECRET;
  const result = await runStart(env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /MCP_BEARER_SECRET/);
  assert.equal(result.stderr.includes(env.DEVICE_PAIRING_TOKEN), false);
});

test("startup rejects placeholder and duplicated secrets", () => {
  assert.throws(() => loadConfig(testEnv({ MCP_BEARER_SECRET: "<PLACEHOLDER>" })), ConfigError);
  const shared = "a".repeat(40);
  assert.throws(() => loadConfig(testEnv({
    MCP_BEARER_SECRET: shared,
    DEVICE_PAIRING_TOKEN: shared,
  })), /必须不同/);
});

test("startup rejects a non-local listen host", () => {
  assert.throws(() => loadConfig(testEnv({ HOST: "example.com" })), ConfigError);
});
