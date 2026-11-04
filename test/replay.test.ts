import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectDisplay, mcpCall, startTestApp, TestDisplay } from "./helpers.ts";

test("a reconnect receives messages missed while the socket was down", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const token = started.env.MCP_BEARER_SECRET;
  const first = await connectDisplay(started, 0);
  const callPromise = mcpCall(started.tunnelPort, token, "show_scene", {
    request_id: "replay-scene",
    preset: "crystal",
    anchor: "front",
  });
  const shown = await first.waitFor((message) => message.type === "show_scene");
  assert.equal(shown.seq, 1);
  first.send({ type: "ack", seq: 1, request_id: shown.request_id, body: {} });
  const call = await callPromise;
  assert.equal(call.body.result.structuredContent.delivered, true);
  const repeated = await mcpCall(
    started.tunnelPort,
    token,
    "show_scene",
    { request_id: "replay-scene", preset: "crystal", anchor: "front" },
    2,
  );
  assert.equal(repeated.body.result.structuredContent.seq, 1);
  assert.equal(repeated.body.result.structuredContent.delivered, true);

  first.close();
  await delay(50);
  const queued = await mcpCall(
    started.tunnelPort,
    token,
    "render_panel",
    { request_id: "replay-panel", panel_id: "info", text: "Missed while away" },
    3,
  );
  assert.equal(queued.body.result.structuredContent.status, "queued");
  assert.equal(queued.body.result.structuredContent.delivered, false);
  assert.equal(queued.body.result.structuredContent.seq, 2);

  const second = await connectDisplay(started, 1);
  const replayed = await second.waitFor((message) => message.type === "render_panel");
  assert.equal(replayed.seq, 2);
  assert.equal(replayed.body.text, "Missed while away");
  second.send({ type: "ack", seq: 2, request_id: replayed.request_id, body: {} });
  second.send({ type: "interaction", request_id: "tap1", body: { kind: "select", target_id: "crystal" } });
  const accepted = await second.waitFor((message) => message.type === "interaction_ok");
  assert.equal(accepted.request_id, "tap1");
  const recorded = (await (await fetch(`http://localhost:${started.port}/api/debug/interactions`)).json()) as {
    events: { target_id: string }[];
  };
  assert.equal(recorded.events.at(-1)?.target_id, "crystal");
  const hidden = await fetch(`http://localhost:${started.tunnelPort}/api/debug/interactions`);
  assert.equal(hidden.status, 404);
  second.close();
});

test("pairing token failures stay unauthorized and then rate limited", async (t) => {
  const started = await startTestApp({ PAIRING_MAX_ATTEMPTS: "2", PAIRING_RATE_PER_MINUTE: "10" });
  t.after(() => started.app.close());
  const pair = (token: string) =>
    fetch(`http://localhost:${started.port}/api/device/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await pair("wrong-token");
    assert.equal(response.status, 401);
    assert.equal(await response.text(), '{"error":"unauthorized"}');
  }
  assert.equal((await pair(started.env.DEVICE_PAIRING_TOKEN)).status, 429);
});

test("only an authenticated display can take over the active connection", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const first = await connectDisplay(started, 0);
  const pending = new TestDisplay(`ws://localhost:${started.port}/ws`);
  await pending.opened();

  const callPromise = mcpCall(started.tunnelPort, started.env.MCP_BEARER_SECRET, "show_scene", {
    request_id: "active-before-takeover",
    preset: "pedestal",
    anchor: "front",
  });
  const shown = await first.waitFor((message) => message.type === "show_scene");
  first.send({ type: "ack", seq: shown.seq, body: {} });
  assert.equal((await callPromise).body.result.structuredContent.delivered, true);
  assert.equal(pending.messages.length, 0);

  const rejected = pending.closed();
  pending.send({ type: "auth", body: { session_token: "invalid", last_seq: 0 } });
  assert.equal(await rejected, 4401);
  assert.equal(first.socket.readyState, first.socket.OPEN);

  const replaced = first.closed();
  const second = await connectDisplay(started, 0);
  assert.equal(await replaced, 4410);
  assert.equal((await second.waitFor((message) => message.type === "show_scene")).seq, shown.seq);
  assert.equal(started.app.hub.displayConnected(), true);
  second.close();
});

test("a cursor ahead of a restarted relay receives the current snapshot", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const display = await connectDisplay(started, 99);
  const snapshot = await display.waitFor((message) => message.type === "snapshot");
  assert.equal(snapshot.seq, 0);
  assert.deepEqual(snapshot.body, { scene: null, panels: [], reason: "gap" });
  display.close();
});

test("a display that never authenticates is closed with 4401", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const display = new TestDisplay(`ws://localhost:${started.port}/ws`);
  await display.opened();
  const closed = display.closed();
  display.socket.send("not json");
  assert.equal(await closed, 1003);
});
