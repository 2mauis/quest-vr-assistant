import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type WebSocket from "ws";
import { loadConfig } from "../services/relay/src/config.ts";
import { createHub } from "../services/relay/src/hub.js";
import { testEnv } from "./helpers.ts";

class FakeSocket extends EventEmitter {
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code: number): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closedWith = code;
    this.emit("close", code);
  }

  receive(message: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify({ v: 1, ...message })), false);
  }

  last(type: string): Record<string, unknown> | undefined {
    return this.sent.findLast((message) => message.type === type);
  }
}

function setup(overrides: Record<string, string> = {}) {
  const env = testEnv(overrides);
  const config = loadConfig(env);
  const clock = { now: 1_000 };
  const hub = createHub(config, () => clock.now);
  const connect = (lastSeq = 0) => {
    const outcome = hub.pair(env.DEVICE_PAIRING_TOKEN);
    assert.ok(outcome.ok);
    const socket = new FakeSocket();
    hub.attach(socket as unknown as WebSocket);
    socket.receive({ type: "auth", body: { session_token: outcome.body.session_token, last_seq: lastSeq } });
    assert.ok(socket.last("auth_ok"));
    return socket;
  };
  return { env, config, clock, hub, connect };
}

const IDENTITY_POSE = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };
const scene = (requestId: string, preset = "pedestal") => ({ request_id: requestId, preset, anchor: "front" });

test("a command without a display is queued with a monotonically increasing seq", async () => {
  const { hub } = setup();
  const first = await hub.call("show_scene", scene("a1"));
  const second = await hub.call("render_panel", { request_id: "a2", panel_id: "p", text: "hi" });
  assert.deepEqual(first, {
    isError: false,
    payload: { request_id: "a1", status: "queued", seq: 1, delivered: false, error_code: null },
  });
  assert.equal(second.payload.seq, 2);
  assert.deepEqual(
    hub.state().panels.map((panel) => panel.panel_id),
    ["p"],
  );
});

test("delivered becomes true only after the display acknowledges the seq", async (t) => {
  const { hub, connect } = setup({ ACK_WAIT_MS: "5000" });
  const socket = connect();
  t.after(() => socket.close(1000));
  const pending = hub.call("show_scene", scene("b1"));
  const command = socket.last("show_scene");
  assert.equal(command?.seq, 1);
  socket.receive({ type: "ack", seq: 0 });
  socket.receive({ type: "ack", seq: 7 });
  socket.receive({ type: "ack", seq: 1 });
  assert.deepEqual((await pending).payload, {
    request_id: "b1",
    status: "rendered",
    seq: 1,
    delivered: true,
    error_code: null,
  });
});

test("an unacknowledged command stays queued after the ACK wait", async (t) => {
  const { hub, connect } = setup({ ACK_WAIT_MS: "50" });
  const socket = connect();
  t.after(() => socket.close(1000));
  const outcome = await hub.call("clear", { request_id: "c1", scope: "all" });
  assert.equal(outcome.payload.status, "queued");
  assert.equal(outcome.payload.delivered, false);
  socket.receive({ type: "ack", seq: 1 });
  const repeated = await hub.call("clear", { request_id: "c1", scope: "all" });
  assert.equal(repeated.payload.delivered, true);
});

test("same request_id with different content is an idempotency conflict", async () => {
  const { hub } = setup();
  await hub.call("show_scene", scene("d1"));
  const conflict = await hub.call("show_scene", scene("d1", "grid"));
  assert.equal(conflict.isError, true);
  assert.equal(conflict.payload.error_code, "idempotency_conflict");
  const replay = await hub.call("show_scene", { anchor: "front", preset: "pedestal", request_id: "d1" });
  assert.equal(replay.isError, false);
  assert.equal(replay.payload.seq, 1);
});

test("a full queue rejects without consuming a seq", async () => {
  const { hub } = setup({ QUEUE_MAX_MESSAGES: "2" });
  await hub.call("show_scene", scene("e1"));
  await hub.call("show_scene", scene("e2"));
  const full = await hub.call("show_scene", scene("e3"));
  assert.equal(full.isError, true);
  assert.equal(full.payload.error_code, "queue_full");
  assert.equal(full.payload.seq, 0);
  assert.equal(hub.highWater(), 2);
});

test("a queued command expires after QUEUE_TTL and is not replayed", async (t) => {
  const { hub, clock, config, connect } = setup({ QUEUE_TTL_SECONDS: "10", IDEMPOTENCY_TTL_SECONDS: "60" });
  await hub.call("show_scene", scene("f1"));
  clock.now += config.queueTtlMs + 1;
  const expired = await hub.call("show_scene", scene("f1"));
  assert.equal(expired.payload.status, "expired");
  assert.equal(expired.payload.error_code, "expired");
  const socket = connect(0);
  t.after(() => socket.close(1000));
  assert.equal(socket.last("show_scene"), undefined);
  assert.equal(socket.last("snapshot")?.seq, 1);
});

test("invalid arguments and draining relays never claim delivery", async () => {
  const { hub } = setup();
  const invalid = await hub.call("render_panel", { request_id: "g1", panel_id: "bad id", text: "x" });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.payload.status, "rejected");
  assert.equal(invalid.payload.error_code, "invalid_panel_id");
  hub.drain();
  const draining = await hub.call("clear", { request_id: "g2", scope: "all" });
  assert.deepEqual(draining.payload, {
    request_id: "g2",
    status: "offline",
    seq: 0,
    delivered: false,
    error_code: "draining",
  });
});

test("resume replays from the requested cursor and a gap yields a snapshot", async (t) => {
  const { hub, connect } = setup();
  await hub.call("show_scene", scene("h1"));
  await hub.call("render_panel", { request_id: "h2", panel_id: "p", text: "x" });
  const socket = connect(2);
  t.after(() => socket.close(1000));
  assert.equal(socket.sent.filter((message) => message.seq === 1 || message.seq === 2).length, 1);
  socket.receive({ type: "resume", body: { last_seq: 1 } });
  assert.equal(socket.last("render_panel")?.seq, 2);
  socket.receive({ type: "resume", body: { last_seq: 50 } });
  assert.deepEqual(socket.last("snapshot")?.body, {
    scene: { preset: "pedestal", model_url: null, anchor: "front", pose: IDENTITY_POSE },
    panels: [{ panel_id: "p", title: "", text: "x", anchor: "front", pose: IDENTITY_POSE }],
    reason: "gap",
  });
});

test("a second authenticated display replaces the first with close code 4410", () => {
  const { hub, connect } = setup();
  const first = connect();
  const second = connect();
  assert.equal(first.closedWith, 4410);
  assert.equal(hub.displayConnected(), true);
  second.close(1000);
  assert.equal(hub.displayConnected(), false);
});

test("an unauthenticated message or bad session closes with 4401", () => {
  const { hub } = setup();
  const early = new FakeSocket();
  hub.attach(early as unknown as WebSocket);
  early.receive({ type: "ack", seq: 1 });
  assert.equal(early.closedWith, 4401);
  const forged = new FakeSocket();
  hub.attach(forged as unknown as WebSocket);
  forged.receive({ type: "auth", body: { session_token: "f".repeat(64), last_seq: 0 } });
  assert.equal(forged.closedWith, 4401);
});
