import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { namedTunnelPlan } from "../scripts/start-named-tunnel.mjs";

function fixture(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), "qvr-named-tunnel-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const tokenFile = join(folder, "connector.token");
  writeFileSync(tokenFile, "test-only-connector-token\n", { mode: 0o600 });
  return { folder, tokenFile, env: { MCP_PUBLIC_URL: "https://mcp.example.com/mcp", TUNNEL_TOKEN_FILE: tokenFile } };
}

test("named tunnel passes a token file and excludes unrelated secrets and conflicting relay settings", (t) => {
  const { env, tokenFile } = fixture(t);
  const plan = namedTunnelPlan({
    ...env,
    TUNNEL_HOST: "localhost",
    TUNNEL_PORT: "8788",
    TUNNEL_TOKEN: "test-only-raw-token",
    MCP_BEARER_SECRET: "test-only-mcp-secret",
    DEVICE_PAIRING_TOKEN: "test-only-pairing-secret",
    CLOUDFLARE_API_TOKEN: "test-only-management-secret",
    HTTPS_PROXY: "http://localhost:8080",
    PATH: process.env.PATH,
  });
  assert.deepEqual(plan.args, ["tunnel", "--protocol", "http2", "--no-autoupdate", "run", "--token-file", tokenFile]);
  for (const key of [
    "TUNNEL_HOST",
    "TUNNEL_PORT",
    "TUNNEL_TOKEN",
    "MCP_BEARER_SECRET",
    "DEVICE_PAIRING_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "MCP_PUBLIC_URL",
  ])
    assert.equal(plan.env[key], undefined);
  assert.equal(plan.env.HTTPS_PROXY, "http://localhost:8080");
  assert.equal(plan.env.PATH, process.env.PATH);
  assert.ok(!plan.args.some((arg) => arg.includes("test-only-")));
});

test("named tunnel rejects temporary or ambiguous public endpoints before starting", (t) => {
  const { env } = fixture(t);
  for (const value of [
    undefined,
    "http://mcp.example.com/mcp",
    "https://temporary.trycloudflare.com/mcp",
    "https://mcp.example.com/",
    "https://mcp.example.com/mcp/",
    "https://mcp.example.com/mcp?token=sample",
    "https://mcp.example.com/mcp#fragment",
    "https://user@mcp.example.com/mcp",
    "https://mcp.example.com:444/mcp",
    "https://localhost/mcp",
    "https://mcp.example.com./mcp",
    "https://mcp.example.com/ws",
  ]) {
    assert.throws(() => namedTunnelPlan({ ...env, MCP_PUBLIC_URL: value }), /MCP_PUBLIC_URL/);
  }
});

test("named tunnel rejects missing, shared, empty, non-file and symlink token paths", (t) => {
  const { folder, env, tokenFile } = fixture(t);
  for (const value of [undefined, "relative.token", join(folder, "missing"), folder]) {
    assert.throws(() => namedTunnelPlan({ ...env, TUNNEL_TOKEN_FILE: value }), /TOKEN_FILE|令牌文件/);
  }
  chmodSync(tokenFile, 0o644);
  assert.throws(() => namedTunnelPlan(env), /令牌文件/);
  chmodSync(tokenFile, 0o600);
  const linked = join(folder, "linked.token");
  symlinkSync(tokenFile, linked);
  assert.throws(() => namedTunnelPlan({ ...env, TUNNEL_TOKEN_FILE: linked }), /令牌文件/);
  writeFileSync(tokenFile, "");
  assert.throws(() => namedTunnelPlan(env), /令牌文件/);
});

test("named tunnel accepts explicit transport options and rejects unknown values", (t) => {
  const { env } = fixture(t);
  for (const protocol of ["auto", "http2", "quic"]) {
    assert.equal(namedTunnelPlan({ ...env, TUNNEL_TRANSPORT_PROTOCOL: protocol }).args[2], protocol);
  }
  assert.throws(() => namedTunnelPlan({ ...env, TUNNEL_TRANSPORT_PROTOCOL: "udp" }), /TUNNEL_TRANSPORT_PROTOCOL/);
});
