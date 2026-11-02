import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedBearer, isOriginAllowed } from "../services/relay/src/auth.ts";
import { bearerToken, safeEqual } from "../services/relay/src/security.ts";
import { startTestApp } from "./helpers.ts";

const SECRET = "s".repeat(40);

test("isAuthorizedBearer accepts only the exact Bearer secret", () => {
  assert.equal(isAuthorizedBearer(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(isAuthorizedBearer(`bearer ${SECRET}`, SECRET), true);
  for (const header of [undefined, "", "Bearer", "Bearer ", `Basic ${SECRET}`, `Bearer ${SECRET}x`, `Bearer ${SECRET} x`, [`Bearer ${SECRET}`]]) {
    assert.equal(isAuthorizedBearer(header, SECRET), false, String(header));
  }
});

test("bearerToken and safeEqual handle malformed input", () => {
  assert.equal(bearerToken(42), "");
  assert.equal(bearerToken("Token abc"), "");
  assert.equal(safeEqual("alpha", "alpha"), true);
  assert.equal(safeEqual("alpha", "beta"), false);
  assert.equal(safeEqual("", "beta"), false);
});

test("isOriginAllowed lets server-to-server requests through and checks browser origins", () => {
  assert.equal(isOriginAllowed(undefined, []), true);
  assert.equal(isOriginAllowed("https://vr.example.com", ["https://vr.example.com"]), true);
  assert.equal(isOriginAllowed("https://other.example.com", ["https://vr.example.com"]), false);
  assert.equal(isOriginAllowed(["https://vr.example.com"], ["https://vr.example.com"]), false);
});

test("every MCP method returns the same 401 without a valid Bearer token", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const url = `http://localhost:${started.tunnelPort}/mcp`;
  const bodies = new Set<string>();
  for (const [method, authorization] of [
    ["POST", undefined],
    ["POST", "Bearer wrong"],
    ["GET", undefined],
    ["DELETE", "Bearer wrong"],
    ["POST", `Basic ${started.env.MCP_BEARER_SECRET}`],
  ] as const) {
    const response = await fetch(url, {
      method,
      headers: authorization ? { authorization, "content-type": "application/json" } : {},
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert.equal(response.status, 401, `${method} ${authorization}`);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="mcp"');
    bodies.add(await response.text());
  }
  assert.deepEqual([...bodies], ['{"error":"unauthorized"}']);
});

test("repeated Bearer failures are rate limited", async (t) => {
  const started = await startTestApp({ MCP_RATE_PER_MINUTE: "3" });
  t.after(() => started.app.close());
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`http://localhost:${started.tunnelPort}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    statuses.push(response.status);
    await response.body?.cancel();
  }
  assert.equal(statuses.slice(0, 3).every((status) => status === 401), true);
  assert.equal(statuses.at(-1), 429);
});
