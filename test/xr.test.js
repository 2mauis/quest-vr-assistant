import assert from "node:assert/strict";
import test from "node:test";
import { bindImmersiveControls } from "../apps/web-display/src/xr-entry.js";

function fixture({ modes = ["immersive-vr"], fail = false } = {}) {
  const button = new EventTarget();
  button.disabled = false;
  button.textContent = "";
  const mode = new EventTarget();
  mode.value = "immersive-vr";
  mode.disabled = false;
  mode.options = ["immersive-vr", "immersive-ar"].map((value) => ({ value, disabled: false }));
  const status = { textContent: "" };
  const requests = [];
  let session = null;
  const store = {
    getState: () => ({ session }),
    onSessionEnd(callback) {
      store.endListener = callback;
      return () => { store.endListener = null; };
    },
    async enterVR() { return enter("immersive-vr"); },
    async enterAR() { return enter("immersive-ar"); },
  };
  async function enter(value) {
    requests.push(value);
    if (fail) throw new Error("no renderer");
    session = { ended: 0, async end() { this.ended += 1; session = null; store.endListener?.(); } };
    return session;
  }
  const xr = {
    isSessionSupported: async (value) => modes.includes(value),
    requestSession() { throw new Error("the page must not request a session itself"); },
  };
  return { xr, store, button, mode, status, requests, get session() { return session; } };
}

async function click(button) {
  button.dispatchEvent(new Event("click"));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("immersive controls enter one selected mode through the XR store", async () => {
  const f = fixture({ modes: ["immersive-vr", "immersive-ar"] });
  bindImmersiveControls({ store: f.store, xr: f.xr, button: f.button, mode: f.mode, status: f.status });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.mode.value, "immersive-vr");
  f.mode.value = "immersive-ar";
  const first = click(f.button);
  await click(f.button);
  await first;
  assert.deepEqual(f.requests, ["immersive-ar"]);
  assert.equal(f.mode.disabled, true);
  assert.equal(f.button.disabled, false);
  await click(f.button);
  assert.equal(f.session, null);
  assert.equal(f.status.textContent, "已返回桌面视图");
  assert.equal(f.button.disabled, false);
});

test("a failed XR store entry stays on the desktop and can be retried", async () => {
  const f = fixture({ fail: true });
  bindImmersiveControls({ store: f.store, xr: f.xr, button: f.button, mode: f.mode, status: f.status });
  await new Promise((resolve) => setImmediate(resolve));
  await click(f.button);
  assert.equal(f.requests.length, 1);
  assert.equal(f.session, null);
  assert.equal(f.button.disabled, false);
  assert.match(f.status.textContent, /未能进入/);
});

test("a browser without immersive support cannot request a session", async () => {
  const f = fixture({ modes: [] });
  bindImmersiveControls({ store: f.store, xr: f.xr, button: f.button, mode: f.mode, status: f.status });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.button.disabled, true);
  await click(f.button);
  assert.equal(f.requests.length, 0);
});
