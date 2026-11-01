import assert from "node:assert/strict";
import test from "node:test";
import { EventDispatcher } from "three";
import { setupXR } from "../apps/web-display/xr.js";

function fixture({ modes = ["immersive-vr"], fail = false } = {}) {
  const button = new EventTarget();
  const mode = new EventTarget();
  mode.value = "immersive-vr";
  mode.options = ["immersive-vr", "immersive-ar"].map((value) => ({ value }));
  const status = {};
  const manager = new EventDispatcher();
  const controls = { enabled: true, saved: 0, restored: 0,
    saveState() { this.saved += 1; }, reset() { this.restored += 1; } };
  const scene = { background: "opaque" };
  const requests = [];
  manager.setReferenceSpaceType = (value) => { manager.referenceSpace = value; };
  manager.setSession = async () => { if (fail) throw new Error("no renderer"); };
  const session = { ended: 0, async end() {
    this.ended += 1;
    manager.dispatchEvent({ type: "sessionend" });
  } };
  const xr = {
    isSessionSupported: async (value) => modes.includes(value),
    requestSession: async (value, options) => { requests.push({ value, options }); return session; },
  };
  return { xr, renderer: { xr: manager }, controls, scene, button, mode, status, requests, session };
}

async function click(button) {
  button.dispatchEvent(new Event("click"));
  await new Promise((resolve) => setImmediate(resolve));
}

test("XR requests one supported mode with floor tracking and restores desktop controls on exit", async () => {
  const f = fixture({ modes: ["immersive-vr", "immersive-ar"] });
  await setupXR(f);
  assert.equal(f.mode.value, "immersive-vr");
  f.mode.value = "immersive-ar";
  f.button.dispatchEvent(new Event("click"));
  await click(f.button); // A second click while setup is pending must not start another session.
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].value, "immersive-ar");
  assert.deepEqual(f.requests[0].options.requiredFeatures, ["local-floor"]);
  assert.equal(f.renderer.xr.referenceSpace, "local-floor");
  assert.equal(f.scene.background, null);
  assert.equal(f.controls.enabled, false);
  assert.equal(f.mode.disabled, true);
  await click(f.button);
  assert.equal(f.session.ended, 1);
  assert.equal(f.scene.background, "opaque");
  assert.equal(f.controls.enabled, true);
  assert.equal(f.controls.restored, 1);
  assert.equal(f.button.disabled, false);
});

test("XR setup failure closes the acquired session and leaves a retryable desktop", async () => {
  const f = fixture({ fail: true });
  await setupXR(f);
  await click(f.button);
  assert.equal(f.session.ended, 1);
  assert.equal(f.controls.enabled, true);
  assert.equal(f.scene.background, "opaque");
  assert.equal(f.button.disabled, false);
  assert.match(f.status.textContent, /未能进入/);
});

test("a browser without immersive support cannot request a session", async () => {
  const f = fixture({ modes: [] });
  await setupXR(f);
  assert.equal(f.button.disabled, true);
  await click(f.button);
  assert.equal(f.requests.length, 0);
});
