import assert from "node:assert/strict";
import test from "node:test";
import { mcpHeaders, modernBody, startTestApp } from "./helpers.ts";

test("tunnel listener serves only /mcp and requires the bearer token", async (t) => {
  const started = await startTestApp({ ALLOWED_ORIGINS: "https://vr.example.com" });
  t.after(() => started.app.close());
  const { tunnelPort, port, env } = started;
  const base = `http://localhost:${tunnelPort}`;

  const paths = ["/", "/ws", "/healthz", "/api/device/pair", "/mcp/", "/mcp/extra", "/vendor/three/build/three.module.js"];
  for (const pathname of paths) {
    const response = await fetch(`${base}${pathname}`, {
      headers: { authorization: `Bearer ${env.MCP_BEARER_SECRET}` },
    });
    assert.equal(response.status, 404, pathname);
    const body = await response.text();
    assert.equal(body.includes("<canvas"), false, pathname);
    assert.equal(body.includes(env.MCP_BEARER_SECRET), false);
  }

  const missing = await fetch(`${base}/mcp`, { method: "POST" });
  const wrong = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer not-the-token" },
  });
  const missingBody = await missing.text();
  const wrongBody = await wrong.text();
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(missingBody, wrongBody);
  assert.equal(missing.headers.get("www-authenticate"), 'Bearer realm="mcp"');
  assert.equal(missingBody.includes(env.MCP_BEARER_SECRET), false);

  const denied = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      ...mcpHeaders(env.MCP_BEARER_SECRET, "server/discover"),
      origin: "https://other.example.com",
    },
    body: JSON.stringify(modernBody(1, "server/discover", {})),
  });
  assert.equal(denied.status, 403);

  const allowed = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      ...mcpHeaders(env.MCP_BEARER_SECRET, "server/discover"),
      origin: "https://vr.example.com",
    },
    body: JSON.stringify(modernBody(1, "server/discover", {})),
  });
  const discovered = (await allowed.json()) as { result: { supportedVersions: string[] } };
  assert.equal(allowed.status, 200);
  assert.deepEqual(discovered.result.supportedVersions, ["2026-07-28"]);

  const localPage = await fetch(`http://localhost:${port}/`);
  assert.equal(localPage.status, 200);
  const page = await localPage.text();
  assert.match(page, /id="root"/);
  assert.match(page, /type="module"/);
  const localMcp = await fetch(`http://localhost:${port}/mcp`);
  assert.equal(localMcp.status, 404);
});
