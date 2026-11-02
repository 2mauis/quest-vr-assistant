import assert from "node:assert/strict";
import test from "node:test";
import {
  ImmersiveController,
  type ImmersiveMode,
  type XrStoreLike,
} from "../apps/web-display/src/xr/immersive-controller.ts";

function fixture({ modes = ["immersive-vr"] as ImmersiveMode[], fail = false } = {}) {
  const requests: ImmersiveMode[] = [];
  let session: { end(): Promise<void> } | null = null;
  let endListener: (() => void) | null = null;
  const enter = async (mode: ImmersiveMode) => {
    requests.push(mode);
    if (fail) throw new Error("no renderer");
    session = {
      async end() {
        session = null;
        endListener?.();
      },
    };
    return session;
  };
  const store: XrStoreLike = {
    getState: () => ({ session }),
    enterVR: () => enter("immersive-vr"),
    enterAR: () => enter("immersive-ar"),
    onSessionEnd(callback) {
      endListener = callback;
      return () => {
        endListener = null;
      };
    },
  };
  const xr = { isSessionSupported: async (mode: ImmersiveMode) => modes.includes(mode) };
  return { store, xr, requests, session: () => session, ended: () => endListener === null };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("immersive controls enter one selected mode through the XR store", async () => {
  const f = fixture({ modes: ["immersive-vr", "immersive-ar"] });
  const controller = new ImmersiveController(f.store, f.xr);
  await settle();
  assert.equal(controller.getView().mode, "immersive-vr");
  controller.setMode("immersive-ar");
  const first = controller.toggle();
  const second = controller.toggle();
  await Promise.all([first, second]);
  assert.deepEqual(f.requests, ["immersive-ar"], "a second click while busy is ignored");
  assert.equal(controller.getView().active, true);
  controller.setMode("immersive-vr");
  assert.equal(controller.getView().mode, "immersive-ar", "mode is locked while immersive");
  await controller.toggle();
  assert.equal(f.session(), null);
  assert.equal(controller.getView().status, "已返回桌面视图");
  assert.equal(controller.getView().busy, false);
  controller.dispose();
  assert.equal(f.ended(), true);
});

test("a failed XR store entry stays on the desktop and can be retried", async () => {
  const f = fixture({ fail: true });
  const controller = new ImmersiveController(f.store, f.xr);
  await settle();
  await controller.toggle();
  assert.equal(f.requests.length, 1);
  assert.equal(controller.getView().active, false);
  assert.equal(controller.getView().busy, false);
  assert.match(controller.getView().status, /未能进入/);
  await controller.toggle();
  assert.equal(f.requests.length, 2);
});

test("a browser without immersive support cannot request a session", async () => {
  const none = fixture({ modes: [] });
  const controller = new ImmersiveController(none.store, none.xr);
  await settle();
  assert.deepEqual(controller.getView().supported, []);
  await controller.toggle();
  assert.equal(none.requests.length, 0);
  const missing = fixture();
  const withoutXr = new ImmersiveController(missing.store, undefined);
  assert.match(withoutXr.getView().status, /不支持沉浸模式/);
});
