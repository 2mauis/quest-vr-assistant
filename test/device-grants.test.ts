import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../services/relay/src/config.ts";
import { createHub } from "../services/relay/src/hub.js";
import { type Json, startTestApp, testEnv } from "./helpers.ts";

function body(outcome: ReturnType<ReturnType<typeof createHub>["pair"]>): Json {
  assert.ok(outcome.ok);
  return outcome.body;
}

test("device authorization restores expired sessions across a relay restart", () => {
  const env = testEnv();
  const config = loadConfig(env);
  let now = 1_000;
  const first = createHub(config, () => now);
  const paired = body(first.pair(env.DEVICE_PAIRING_TOKEN, now, true));
  now += config.sessionTtlMs + 1;
  assert.equal(first.authorizeSocket(paired.session_token), null);
  const restarted = createHub(config, () => now);
  const renewed = body(restarted.refresh(paired.refresh_token));
  assert.notEqual(renewed.session_token, paired.session_token);
  assert.ok(restarted.authorizeSocket(renewed.session_token));
  assert.notEqual(renewed.refresh_token, paired.refresh_token);
  assert.equal(body(first.pair(env.DEVICE_PAIRING_TOKEN)).refresh_token, undefined);
});

test("expired, tampered and revoked device grants cannot create a session", () => {
  const env = testEnv();
  const config = loadConfig(env);
  const hub = createHub(config, () => 1_000);
  const credentials = body(hub.pair(env.DEVICE_PAIRING_TOKEN, 1_000, true));
  assert.equal(hub.refresh(credentials.session_token).status, 401);
  assert.equal(hub.refresh(`${String(credentials.refresh_token)}x`).status, 401);
  assert.equal(hub.refresh(credentials.refresh_token, 1_000 + config.deviceGrantTtlMs).status, 401);
  const rotated = createHub(loadConfig(testEnv()), () => 1_000);
  assert.equal(rotated.refresh(credentials.refresh_token).status, 401);
});

test("refresh stays on the private display port, checks origin and validates input", async (t) => {
  const app = await startTestApp();
  t.after(() => app.app.close());
  const call = (port: number, route: string, payload: unknown, extra: Record<string, string> = {}) =>
    fetch(`http://localhost:${port}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...extra },
      body: JSON.stringify(payload),
    });
  const pair = await call(app.port, "/api/device/pair", { token: app.env.DEVICE_PAIRING_TOKEN, remember: true });
  assert.equal(pair.status, 200);
  const paired = (await pair.json()) as Json;
  const refresh = { refresh_token: paired.refresh_token };
  assert.equal((await call(app.tunnelPort, "/api/device/refresh", refresh)).status, 404);
  assert.equal(
    (await call(app.port, "/api/device/refresh", refresh, { origin: "https://untrusted.example.com" })).status,
    403,
  );
  assert.equal((await call(app.port, "/api/device/refresh", { ...refresh, token: "unexpected" })).status, 400);
  const renewed = await call(app.port, "/api/device/refresh", refresh);
  assert.equal(renewed.status, 200);
  assert.equal(renewed.headers.get("cache-control"), "no-store");
  const grant = (await renewed.json()) as Json;
  assert.ok(app.app.hub.authorizeSocket(grant.session_token));
  assert.equal(
    (await call(app.port, "/api/device/pair", { token: app.env.DEVICE_PAIRING_TOKEN, remember: "true" })).status,
    400,
  );
  const wrongMethod = await fetch(`http://localhost:${app.port}/api/device/refresh`);
  assert.equal(wrongMethod.status, 405);
});
