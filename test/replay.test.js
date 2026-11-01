import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { once } from "node:events";
import { mcpCall, startTestApp } from "./helpers.js";

function track(socket) {
  const messages = [];
  socket.on("message", (data) => {
    messages.push(JSON.parse(data.toString("utf8")));
  });
  return messages;
}

async function waitFor(messages, predicate) {
  const existing = messages.find(predicate);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 2000);
    const original = messages.push.bind(messages);
    messages.push = (message) => {
      const result = original(message);
      if (predicate(message)) {
        clearTimeout(timer);
        resolve(message);
      }
      return result;
    };
  });
}

async function pairAndConnect(started, lastSeq) {
  const paired = await fetch(`http://localhost:${started.port}/api/device/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: started.env.DEVICE_PAIRING_TOKEN }),
  });
  assert.equal(paired.status, 200);
  const credentials = await paired.json();
  const socket = new WebSocket(`ws://localhost:${started.port}/ws`);
  const messages = track(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({
    v: 1,
    type: "auth",
    body: { session_token: credentials.session_token, last_seq: lastSeq },
  }));
  await waitFor(messages, (message) => message.type === "auth_ok");
  return { socket, messages };
}

test("a reconnect receives messages missed while the socket was down", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const first = await pairAndConnect(started, 0);
  const callPromise = mcpCall(started.tunnelPort, started.env.MCP_BEARER_SECRET, "show_scene", {
    request_id: "replay-scene",
    preset: "crystal",
    anchor: "front",
  });
  const shown = await waitFor(first.messages, (message) => message.type === "show_scene");
  assert.equal(shown.seq, 1);
  first.socket.send(JSON.stringify({ v: 1, type: "ack", seq: 1, request_id: shown.request_id, body: {} }));
  const call = await callPromise;
  assert.equal(call.body.result.structuredContent.delivered, true);
  const repeated = await mcpCall(started.tunnelPort, started.env.MCP_BEARER_SECRET, "show_scene", {
    request_id: "replay-scene",
    preset: "crystal",
    anchor: "front",
  }, 2);
  assert.equal(repeated.body.result.structuredContent.seq, 1);
  assert.equal(repeated.body.result.structuredContent.delivered, true);

  first.socket.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const queued = await mcpCall(started.tunnelPort, started.env.MCP_BEARER_SECRET, "render_panel", {
    request_id: "replay-panel",
    panel_id: "info",
    text: "Missed while away",
  }, 3);
  assert.equal(queued.body.result.structuredContent.status, "queued");
  assert.equal(queued.body.result.structuredContent.delivered, false);
  assert.equal(queued.body.result.structuredContent.seq, 2);

  const second = await pairAndConnect(started, 1);
  const replayed = await waitFor(second.messages, (message) => message.type === "render_panel");
  assert.equal(replayed.seq, 2);
  assert.equal(replayed.body.text, "Missed while away");
  second.socket.send(JSON.stringify({ v: 1, type: "ack", seq: 2, request_id: replayed.request_id, body: {} }));
  second.socket.send(JSON.stringify({
    v: 1,
    type: "interaction",
    request_id: "tap1",
    body: { kind: "select", target_id: "crystal" },
  }));
  const accepted = await waitFor(second.messages, (message) => message.type === "interaction_ok");
  assert.equal(accepted.request_id, "tap1");
  const recorded = await fetch(`http://localhost:${started.port}/api/debug/interactions`);
  const events = await recorded.json();
  assert.equal(events.events.at(-1).target_id, "crystal");
  const hidden = await fetch(`http://localhost:${started.tunnelPort}/api/debug/interactions`);
  assert.equal(hidden.status, 404);
  second.socket.close();
});

test("pairing token failures stay unauthorized and then rate limited", async (t) => {
  const started = await startTestApp({ PAIRING_MAX_ATTEMPTS: "2", PAIRING_RATE_PER_MINUTE: "10" });
  t.after(() => started.app.close());
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`http://localhost:${started.port}/api/device/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "wrong-token" }),
    });
    assert.equal(response.status, 401);
    assert.equal(await response.text(), '{"error":"unauthorized"}');
  }
  const locked = await fetch(`http://localhost:${started.port}/api/device/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: started.env.DEVICE_PAIRING_TOKEN }),
  });
  assert.equal(locked.status, 429);
});

test("only an authenticated display can take over the active connection", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const first = await pairAndConnect(started, 0);
  const pending = new WebSocket(`ws://localhost:${started.port}/ws`);
  const pendingMessages = track(pending);
  await once(pending, "open");

  const callPromise = mcpCall(started.tunnelPort, started.env.MCP_BEARER_SECRET, "show_scene", {
    request_id: "active-before-takeover", preset: "pedestal", anchor: "front",
  });
  const shown = await waitFor(first.messages, (message) => message.type === "show_scene");
  first.socket.send(JSON.stringify({ v: 1, type: "ack", seq: shown.seq, body: {} }));
  assert.equal((await callPromise).body.result.structuredContent.delivered, true);
  assert.equal(pendingMessages.length, 0);

  const rejected = once(pending, "close");
  pending.send(JSON.stringify({ v: 1, type: "auth", body: { session_token: "invalid", last_seq: 0 } }));
  assert.equal((await rejected)[0], 4401);
  assert.equal(first.socket.readyState, WebSocket.OPEN);

  const replaced = once(first.socket, "close");
  const second = await pairAndConnect(started, 0);
  assert.equal((await replaced)[0], 4410);
  assert.equal((await waitFor(second.messages, (message) => message.type === "show_scene")).seq, shown.seq);
  assert.equal(started.app.hub.displayConnected(), true);
  second.socket.close();
});

test("a cursor ahead of a restarted relay receives the current snapshot", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const display = await pairAndConnect(started, 99);
  const snapshot = await waitFor(display.messages, (message) => message.type === "snapshot");
  assert.equal(snapshot.seq, 0);
  assert.deepEqual(snapshot.body, { scene: null, panels: [], reason: "gap" });
  display.socket.close();
});
