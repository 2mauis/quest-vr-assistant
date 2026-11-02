import { Canvas } from "@react-three/fiber";
import { XR, type XRStore } from "@react-three/xr";
import { useEffect, useSyncExternalStore } from "react";
import { Stage } from "../render/Stage.tsx";
import type { DisplaySession, DisplayView } from "../session/display-session.ts";
import type { ImmersiveController } from "../xr/immersive-controller.ts";
import { Hud } from "./Hud.tsx";

/** The `data-*` attributes on <body> are the observable contract for tests and the native shell. */
function publishBody(view: DisplayView): void {
  const { dataset } = document.body;
  dataset.connected = view.connected ? "1" : "0";
  dataset.scene = view.sceneName;
  dataset.panels = String(view.state.panels.length);
  dataset.seq = String(view.seq);
}

export function App({
  session,
  xrStore,
  immersive,
}: {
  session: DisplaySession;
  xrStore: XRStore;
  immersive: ImmersiveController;
}) {
  const view = useSyncExternalStore(session.subscribe, session.getView);
  useEffect(() => publishBody(view), [view]);
  return (
    <>
      <Canvas
        camera={{ position: [0, 1.6, 4.2], fov: 50, near: 0.05, far: 50 }}
        // The e2e suite reads pixels back after a frame, which needs the buffer preserved.
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.domElement.id = "view";
        }}
      >
        <XR store={xrStore}>
          <Stage state={view.state} reporter={session.reporter} onSelect={(id) => session.select(id)} />
        </XR>
      </Canvas>
      <Hud session={session} immersive={immersive} />
    </>
  );
}
