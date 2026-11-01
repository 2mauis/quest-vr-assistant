import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { XR, createXRStore } from "@react-three/xr";
import { Color } from "three";
import { createDisplaySession } from "./session.js";
import { Stage } from "./scene.jsx";
import { bindImmersiveControls } from "./xr-entry.js";
import "../styles.css";

const session = createDisplaySession();
const xrStore = createXRStore({
  emulate: false,
  hand: true,
  controller: true,
  handTracking: true,
  anchors: false,
  layers: false,
  meshDetection: false,
  planeDetection: false,
  hitTest: false,
  domOverlay: false,
});

function Hud() {
  const [view, setView] = useState(session.snapshot());
  useEffect(() => session.subscribe(setView), []);
  useEffect(() => {
    const button = document.querySelector("#xr");
    const mode = document.querySelector("#xr-mode");
    const status = document.querySelector("#xr-status");
    return bindImmersiveControls({ store: xrStore, xr: navigator.xr, button, mode, status });
  }, []);
  return (
    <form className="hud" id="hud" onSubmit={(event) => event.preventDefault()}>
      <label>配对口令
        <input id="token" name="token" type="password" autoComplete="off" required disabled={view.tokenDisabled} />
      </label>
      <button type="button" id="connect" disabled={view.connectDisabled} onClick={(event) => {
        const input = event.currentTarget.form?.querySelector("#token");
        session.connect(input?.value || "");
        if (input) input.value = "";
      }}>连接</button>
      <button type="button" id="disconnect" disabled={view.disconnectDisabled} onClick={() => session.disconnect()}>断开</button>
      <button type="button" id="takeover" hidden={!view.takeoverVisible} onClick={() => session.takeover()}>{view.takeoverLabel}</button>
      <label>沉浸模式
        <select id="xr-mode" defaultValue="immersive-vr">
          <option value="immersive-vr">VR</option>
          <option value="immersive-ar">透视 AR</option>
        </select>
      </label>
      <button type="button" id="xr">进入 WebXR</button>
      <span id="status" role="status">{view.status}</span>
      <span id="xr-status" role="status">正在检查头显支持</span>
    </form>
  );
}

function App() {
  const [view, setView] = useState(session.snapshot());
  useEffect(() => session.subscribe(setView), []);
  return (
    <>
      <Canvas
        camera={{ position: [0, 1.6, 4.2], fov: 50, near: 0.05, far: 50 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl, scene }) => {
          gl.domElement.id = "view";
          const background = new Color("#070b14");
          scene.background = background;
          scene.userData.desktopBackground = background;
        }}
      >
        <XR store={xrStore}>
          <Stage session={session} view={view} />
        </XR>
      </Canvas>
      <Hud />
    </>
  );
}

window.__display = {
  disconnectForTest() { session.disconnectForTest(); },
  adoptSession(token) { return session.adoptSession(token); },
};

createRoot(document.querySelector("#root")).render(<App />);
