import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { DisplaySession, STATUS } from "../apps/web-display/src/session/display-session.ts";
import { RelaySocket, type SocketLike } from "../apps/web-display/src/session/relay-socket.ts";
import { RenderError, RenderTracker } from "../apps/web-display/src/session/render-tracker.ts";
import { applyCommand, applySnapshot, EMPTY_STATE, sceneName } from "../apps/web-display/src/state/display-state.ts";
import type { CommandMessage, Pose } from "../shared/protocol/index.ts";

const POSE: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };
const TOKEN = "a".repeat(64);

const scene = (seq: number, preset: "grid" | "pedestal" = "grid"): CommandMessage => ({
  v: 1,
  request_id: `s${seq}`,
  seq,
  type: "show_scene",
  body: { preset, model_url: null, anchor: "front", pose: POSE },
});
const panel = (seq: number, id: string, text = "x"): CommandMessage => ({
  v: 1,
  request_id: `p${seq}`,
  seq,
  type: "render_panel",
  body: { panel_id: id, title: "", text, anchor: "front", pose: POSE },
});

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  readonly #listeners = new Map<string, ((event: never) => void)[]>();
  closedWith: number | undefined;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1005): void {
    if (this.readyState === 3) return;
    this.closedWith = code;
    this.serverClose(code);
  }

  open(): void {
    this.readyState = 1;
    this.#emit("open", {});
  }

  receive(message: object): void {
    this.#emit("message", {
      data: JSON.stringify({ v: 1, session_id: "d", request_id: "", seq: 0, body: {}, ...message }),
    });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.#emit("close", { code });
  }

  sentOfType(type: string): Record<string, unknown>[] {
    return this.sent.filter((message) => message.type === type);
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event as never);
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const fetchImpl = async (input: string) => {
    if (input === "/api/display/config") return Response.json({ asset_origins: ["https://assets.example.com"] });
    return Response.json({ session_token: TOKEN });
  };
  const session = new DisplaySession({
    socketUrl: "ws://localhost/ws",
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    fetch: fetchImpl,
    renderTimeoutMs: 1000,
  });
  /** Plays the renderer: commit the revision, mark awaited items ready and draw frames. */
  const render = async (keys: "all" | "none" = "all") => {
    await new Promise((resolve) => setImmediate(resolve));
    const { state } = session.getView();
    session.reporter.committed(state.revision);
    if (keys === "all") {
      if (state.scene) session.reporter.ready(state.scene.key);
      for (const item of state.panels) session.reporter.ready(item.key);
    }
    session.reporter.frame();
    session.reporter.frame();
    await new Promise((resolve) => setImmediate(resolve));
  };
  const live = async () => {
    await session.connect("pairing-token");
    const socket = sockets.at(-1);
    assert.ok(socket);
    socket.open();
    socket.receive({ type: "auth_ok" });
    return socket;
  };
  return { session, sockets, render, live };
}

test("reducer: show_scene, render_panel and clear produce new render keys", () => {
  const shown = applyCommand(EMPTY_STATE, scene(1));
  assert.equal(shown.state.scene?.kind, "preset");
  assert.deepEqual(shown.awaiting, [shown.state.scene.key]);
  const first = applyCommand(shown.state, panel(2, "a"));
  const replaced = applyCommand(first.state, panel(3, "a", "y"));
  assert.equal(replaced.state.panels.length, 1);
  assert.notEqual(replaced.state.panels[0]?.key, first.state.panels[0]?.key);
  assert.equal(replaced.state.panels[0]?.text, "y");
  const two = applyCommand(replaced.state, panel(4, "b"));
  const onePanel = applyCommand(two.state, {
    v: 1,
    request_id: "c",
    seq: 5,
    type: "clear",
    body: { scope: "panel", panel_id: "a" },
  });
  assert.deepEqual(
    onePanel.state.panels.map((item) => item.panelId),
    ["b"],
  );
  assert.ok(onePanel.state.scene);
  assert.deepEqual(onePanel.awaiting, []);
  const sceneOnly = applyCommand(onePanel.state, {
    v: 1,
    request_id: "c",
    seq: 6,
    type: "clear",
    body: { scope: "scene", panel_id: null },
  });
  assert.equal(sceneOnly.state.scene, null);
  assert.equal(sceneOnly.state.panels.length, 1);
  const all = applyCommand(two.state, {
    v: 1,
    request_id: "c",
    seq: 7,
    type: "clear",
    body: { scope: "all", panel_id: null },
  });
  assert.equal(all.state.scene, null);
  assert.equal(all.state.panels.length, 0);
});

test("reducer: a snapshot replaces everything and awaits every item", () => {
  const before = applyCommand(EMPTY_STATE, panel(1, "old")).state;
  const snapshot = applySnapshot(before, {
    scene: { preset: null, model_url: "https://assets.example.com/a.glb", anchor: "left", pose: POSE },
    panels: [
      { panel_id: "a", title: "", text: "1", anchor: "front", pose: POSE },
      { panel_id: "b", title: "", text: "2", anchor: "front", pose: POSE },
    ],
    reason: "gap",
  });
  assert.equal(snapshot.state.scene?.kind, "model");
  assert.deepEqual(
    snapshot.state.panels.map((item) => item.panelId),
    ["a", "b"],
  );
  assert.equal(snapshot.awaiting.length, 3);
  assert.equal(sceneName(snapshot.state.scene, false), "");
  assert.equal(sceneName(snapshot.state.scene, true), "model");
});

test("render tracker waits for commit, readiness and frames, and reports failures", async () => {
  const tracker = new RenderTracker();
  let done = false;
  const wait = tracker.waitForRender(2, ["k"], 1000).then(() => {
    done = true;
  });
  tracker.markReady("k");
  tracker.noteFrame();
  tracker.noteFrame();
  await Promise.resolve();
  assert.equal(done, false, "revision not committed yet");
  tracker.noteCommitted(2);
  tracker.noteFrame();
  await Promise.resolve();
  assert.equal(done, false, "needs two frames after readiness");
  tracker.noteFrame();
  await wait;
  assert.equal(done, true);

  const failing = tracker.waitForRender(3, ["bad"], 1000);
  tracker.markFailed("bad");
  await assert.rejects(failing, (error: unknown) => error instanceof RenderError && error.reason === "item_failed");
  await assert.rejects(tracker.waitForRender(4, ["slow"], 10), /timeout/);
  const aborted = tracker.waitForRender(5, ["x"], 1000);
  tracker.abortAll();
  await assert.rejects(aborted, /aborted/);
});

test("session ACKs a command only after it was rendered", async (t) => {
  const { session, render, live } = harness();
  t.after(() => session.dispose());
  const socket = await live();
  assert.equal(session.getView().status, STATUS.live);
  assert.deepEqual(socket.sentOfType("auth")[0]?.body, { session_token: TOKEN, last_seq: 0 });
  socket.receive(scene(1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.sentOfType("ack").length, 0);
  await render();
  assert.deepEqual(socket.sentOfType("ack"), [{ v: 1, type: "ack", request_id: "s1", seq: 1, body: {} }]);
  assert.equal(session.getView().seq, 1);
  assert.equal(session.getView().sceneName, "grid");
});

test("session re-ACKs duplicates and asks to resume once on a gap", async (t) => {
  const { session, render, live } = harness();
  t.after(() => session.dispose());
  const socket = await live();
  socket.receive(scene(1));
  await render();
  socket.receive(scene(1));
  await render();
  assert.equal(socket.sentOfType("ack").length, 2);
  assert.equal(session.getView().state.revision, 2, "duplicate is not applied twice");
  socket.receive(panel(3, "a"));
  socket.receive(panel(4, "a"));
  await render();
  assert.deepEqual(
    socket.sentOfType("resume").map((message) => message.body),
    [{ last_seq: 1 }],
  );
  assert.equal(session.getView().seq, 1);
  socket.receive(panel(2, "a"));
  await render();
  socket.receive(panel(3, "a"));
  await render();
  assert.equal(session.getView().seq, 3);
});

test("a snapshot resets the cursor without an ACK", async (t) => {
  const { session, render, live } = harness();
  t.after(() => session.dispose());
  const socket = await live();
  socket.receive({ type: "snapshot", seq: 7, body: { scene: null, panels: [], reason: "gap" } });
  await render();
  assert.equal(session.getView().seq, 7);
  assert.equal(socket.sentOfType("ack").length, 0);
});

test("a failed item stops the display without an ACK and offers a retry", async (t) => {
  const { session, sockets, live } = harness();
  t.after(() => session.dispose());
  const socket = await live();
  socket.receive(panel(1, "a"));
  await new Promise((resolve) => setImmediate(resolve));
  const key = session.getView().state.panels[0]?.key;
  assert.ok(key);
  session.reporter.failed(key);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.sentOfType("ack").length, 0);
  assert.equal(session.getView().status, STATUS.renderFailed);
  assert.equal(session.getView().takeover, "重试显示");
  assert.equal(socket.closedWith, 1000);
  session.takeover();
  assert.equal(sockets.length, 2);
});

test("a model outside the display allow-list fails before rendering", async (t) => {
  const { session, live } = harness();
  t.after(() => session.dispose());
  const socket = await live();
  socket.receive({
    ...scene(1),
    body: { preset: null, model_url: "https://other.example.com/a.glb", anchor: "front", pose: POSE },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(session.getView().status, STATUS.renderFailed);
  assert.equal(socket.sentOfType("ack").length, 0);
});

test("close codes: 4410 offers takeover, 4401 forgets the session, others reconnect", async (t) => {
  const { session, sockets, live } = harness();
  t.after(() => session.dispose());
  const first = await live();
  first.serverClose(4410);
  assert.equal(session.getView().status, STATUS.replaced);
  assert.equal(session.getView().takeover, "切回此设备");
  session.takeover();
  const second = sockets.at(-1);
  assert.ok(second && second !== first);
  second.open();
  second.receive({ type: "auth_ok" });
  second.serverClose(4401);
  assert.equal(session.getView().status, STATUS.unauthorized);
  assert.equal(session.getView().takeover, null);
  assert.equal(session.adoptSession("not-a-token"), false);
  assert.equal(session.adoptSession(TOKEN), true);
  assert.equal(session.adoptSession(TOKEN), true);
  assert.equal(sockets.length, 3);
});

test("relay socket reconnects with bounded jittered backoff and sends heartbeats", (t) => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  t.after(() => mock.timers.reset());
  const sockets: FakeSocket[] = [];
  const phases: string[] = [];
  const relay = new RelaySocket(
    {
      url: "ws://localhost/ws",
      sessionToken: TOKEN,
      lastSeq: () => 5,
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      random: () => 0.5,
    },
    { onPhase: (phase) => phases.push(phase), onMessage: () => {}, onStop: () => {} },
  );
  relay.start();
  const first = sockets[0];
  assert.ok(first);
  first.open();
  assert.deepEqual(first.sentOfType("auth")[0]?.body, { session_token: TOKEN, last_seq: 5 });
  mock.timers.tick(25_000);
  assert.equal(first.sentOfType("ping").length, 1);
  first.receive({ type: "ping" });
  assert.equal(first.sentOfType("pong").length, 1);
  mock.timers.tick(60_000);
  assert.equal(first.closedWith, 4408, "watchdog closes a silent socket");
  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
  for (const [index, delay] of delays.entries()) {
    mock.timers.tick(delay - 1);
    assert.equal(sockets.length, index + 1, `attempt ${index} waits ${delay} ms`);
    mock.timers.tick(1);
    assert.equal(sockets.length, index + 2);
    sockets.at(-1)?.serverClose(1006);
  }
  relay.dispose();
  mock.timers.tick(60_000);
  assert.equal(sockets.length, delays.length + 1, "no reconnect after dispose");
  assert.ok(phases.includes("reconnecting"));
});
