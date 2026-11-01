// Capability checks stay outside the session request so the click keeps the
// browser user activation. @react-three/xr performs the actual requestSession.
export function bindImmersiveControls({ store, xr, button, mode, status }) {
  let busy = false;
  let active = false;
  const modes = ["immersive-vr", "immersive-ar"];
  const labels = { "immersive-vr": "VR", "immersive-ar": "透视 AR" };
  let supported = [];
  const unsubscribe = store.onSessionEnd?.(() => {
    active = false;
    status.textContent = "已返回桌面视图";
    update();
  });

  function update() {
    button.disabled = busy || supported.length === 0;
    mode.disabled = busy || active || supported.length === 0;
    button.textContent = active ? "退出沉浸模式" : `进入 ${labels[mode.value] || "WebXR"}`;
  }

  async function onClick() {
    if (busy || !supported.includes(mode.value)) return;
    busy = true;
    update();
    try {
      const session = store.getState?.().session;
      if (active || session) {
        await session?.end();
        active = false;
        return;
      }
      const entered = mode.value === "immersive-ar" ? await store.enterAR() : await store.enterVR();
      if (!entered) throw new Error("no-session");
      active = true;
      status.textContent = `${labels[mode.value]} 中；可用系统菜单退出`;
    } catch {
      active = Boolean(store.getState?.().session);
      status.textContent = "未能进入或退出沉浸模式，请在头显确认权限后重试";
    } finally {
      busy = false;
      update();
    }
  }

  button.addEventListener("click", onClick);
  mode.addEventListener("change", update);

  if (!xr) {
    status.textContent = "当前浏览器不支持沉浸模式，可继续桌面调试";
    update();
    return () => {
      button.removeEventListener("click", onClick);
      unsubscribe?.();
    };
  }

  Promise.all(modes.map((value) => xr.isSessionSupported(value))).then((available) => {
    supported = modes.filter((_, index) => available[index]);
    for (const option of mode.options) option.disabled = !supported.includes(option.value);
    mode.value = supported[0] || modes[0];
    status.textContent = supported.length ? "可进入沉浸模式" : "未检测到可用头显，可继续桌面调试";
    update();
  }).catch(() => {
    status.textContent = "无法检查头显支持，请刷新后重试";
    update();
  });

  return () => {
    button.removeEventListener("click", onClick);
    unsubscribe?.();
  };
}
