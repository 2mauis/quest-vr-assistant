// Keep capability probing outside the click handler so requestSession retains
// the browser's user activation. Request only the mode the user selected.
export async function setupXR({ xr, renderer, scene, controls, button, mode, status }) {
  let active = null;
  let busy = false;
  const background = scene.background;
  const modes = ["immersive-vr", "immersive-ar"];
  const labels = { "immersive-vr": "VR", "immersive-ar": "透视 AR" };
  let supported = [];

  function update() {
    button.disabled = busy || supported.length === 0;
    mode.disabled = busy || Boolean(active) || supported.length === 0;
    button.textContent = active ? "退出沉浸模式" : `进入 ${labels[mode.value] || "WebXR"}`;
  }

  function restore() {
    renderer.xr.removeEventListener("sessionend", restore);
    active = null;
    scene.background = background;
    controls.enabled = true;
    controls.reset();
    status.textContent = "已返回桌面视图";
    update();
  }

  button.addEventListener("click", async () => {
    if (busy || !supported.includes(mode.value)) return;
    busy = true;
    update();
    let requested = null;
    try {
      if (active) {
        await active.end();
        return;
      }
      controls.saveState();
      requested = await xr.requestSession(mode.value, {
        requiredFeatures: ["local-floor"],
        optionalFeatures: ["hand-tracking"],
      });
      active = requested;
      // WebXRManager restores its camera/render target before our UI reset.
      renderer.xr.addEventListener("sessionend", restore);
      controls.enabled = false;
      scene.background = mode.value === "immersive-ar" ? null : background;
      renderer.xr.setReferenceSpaceType("local-floor");
      await renderer.xr.setSession(requested);
      status.textContent = `${labels[mode.value]} 中；可用系统菜单退出`;
    } catch {
      if (requested) {
        await requested.end().catch(() => {});
        if (active === requested) restore();
      }
      status.textContent = "未能进入或退出沉浸模式，请在头显确认权限后重试";
    } finally {
      busy = false;
      update();
    }
  });
  mode.addEventListener("change", update);

  if (!xr) {
    status.textContent = "当前浏览器不支持沉浸模式，可继续桌面调试";
    update();
    return;
  }
  try {
    const available = await Promise.all(modes.map((value) => xr.isSessionSupported(value)));
    supported = modes.filter((_, index) => available[index]);
    for (const option of mode.options) option.disabled = !supported.includes(option.value);
    mode.value = supported[0] || modes[0];
    status.textContent = supported.length ? "可进入沉浸模式" : "未检测到可用头显，可继续桌面调试";
  } catch {
    status.textContent = "无法检查头显支持，请刷新后重试";
  }
  update();
}
