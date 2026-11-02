import { createXRStore } from "@react-three/xr";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import type {} from "./display-hooks.ts";
import { DisplaySession } from "./session/display-session.ts";
import { ImmersiveController } from "./xr/immersive-controller.ts";
import "../styles.css";

const socketUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
const session = new DisplaySession({ socketUrl, createSocket: (url) => new WebSocket(url) });
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
const immersive = new ImmersiveController(xrStore, navigator.xr);

window.__display = {
  adoptSession: (token) => session.adoptSession(token),
  disconnectForTest: () => session.disconnectForTest(),
};

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  session.dispose();
  immersive.dispose();
});

const root = document.querySelector("#root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App session={session} xrStore={xrStore} immersive={immersive} />
  </StrictMode>,
);
