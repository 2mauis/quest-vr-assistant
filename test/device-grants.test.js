import assert from "node:assert/strict";
import test from "node:test";
import { createHub } from "../services/relay/src/hub.js";
import { loadConfig } from "../services/relay/src/config.js";
import { startTestApp, testEnv } from "./helpers.js";

test("device authorization restores expired sessions across a relay restart", () => {
  const env = testEnv();
  const config = loadConfig(env);
  let now = 1_000;
  const first = createHub(config, () => now);
  const paired = first.pair(env.DEVICE_PAIRING_TOKEN, now, true).body;
  now += config.sessionTtlMs + 1;
  assert.equal(first.authorizeSocket(paired.session_token), null);
  const restarted = createHub(config, () => now);
  const renewed = restarted.refresh(paired.refresh_token);
  assert.equal(renewed.status, 200);
  assert.notEqual(renewed.body.session_token, paired.session_token);
  assert.ok(restarted.authorizeSocket(renewed.body.session_token));
  assert.notEqual(renewed.body.refresh_token, paired.refresh_token);
  assert.equal(first.pair(env.DEVICE_PAIRING_TOKEN).body.refresh_token, undefined);
});

test("expired, tampered and revoked device grants cannot create a session", () => {
  const env = testEnv();
  const config = loadConfig(env);
  const hub = createHub(config, () => 1_000);
  const credentials = hub.pair(env.DEVICE_PAIRING_TOKEN, 1_000, true).body;
  assert.equal(hub.refresh(credentials.session_token).status, 401);
  assert.equal(hub.refresh(credentials.refresh_token + "x").status, 401);
  assert.equal(hub.refresh(credentials.refresh_token, 1_000 + config.deviceGrantTtlMs).status, 401);
  const rotated = createHub(loadConfig(testEnv()), () => 1_000);
  assert.equal(rotated.refresh(credentials.refresh_token).status, 401);
});

test("refresh stays on the private display port, checks origin and validates input", async (t) => {
  const app = await startTestApp();
  t.after(() => app.app.close());
  const call = (port, route, body, extra = {}) => fetch(`http://localhost:${port}${route}`, {
    method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body),
  });
  const pair = await call(app.port, "/api/device/pair", { token: app.env.DEVICE_PAIRING_TOKEN, remember: true });
  assert.equal(pair.status, 200);
  const paired = await pair.json();
  const body = { refresh_token: paired.refresh_token };
  assert.equal((await call(app.tunnelPort, "/api/device/refresh", body)).status, 404);
  assert.equal((await call(app.port, "/api/device/refresh", body, { origin: "https://untrusted.example.com" })).status, 403);
  assert.equal((await call(app.port, "/api/device/refresh", { ...body, token: "unexpected" })).status, 400);
  const renewed = await call(app.port, "/api/device/refresh", body);
  assert.equal(renewed.status, 200);
  assert.equal(renewed.headers.get("cache-control"), "no-store");
  const grant = await renewed.json();
  assert.ok(app.app.hub.authorizeSocket(grant.session_token));
  assert.equal((await call(app.port, "/api/device/pair", { token: app.env.DEVICE_PAIRING_TOKEN, remember: "true" })).status, 400);
});
