import { OrbitControls } from "@react-three/drei";
import { addAfterEffect, type ThreeEvent } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useEffect } from "react";
import type { RenderReporter } from "../session/display-session.ts";
import type { DisplayState, SceneItem } from "../model/display-state.ts";
import { PanelCard } from "./PanelCard.tsx";
import { placement } from "./placement.ts";
import { PresetScene } from "./Presets.tsx";
import { forgetModel, RemoteModel } from "./RemoteModel.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";

/** Passthrough AR shows the room, so the scene must not paint a background there. */
function Backdrop() {
  const passthrough = useXR((xr) => Boolean(xr.session) && xr.mode === "immersive-ar");
  return passthrough ? null : <color attach="background" args={["#070b14"]} />;
}

function RenderReports({ revision, reporter }: { revision: number; reporter: RenderReporter }) {
  useEffect(() => reporter.committed(revision), [revision, reporter]);
  // After-effects run once all roots have rendered, both on desktop and in an XR frame.
  useEffect(() => addAfterEffect(() => reporter.frame()), [reporter]);
  return null;
}

function SceneContent({
  scene,
  reporter,
  onSelect,
}: {
  scene: SceneItem;
  reporter: RenderReporter;
  onSelect: (targetId: string) => void;
}) {
  const pose = placement(scene.anchor, scene.pose);
  const failed = () => {
    if (scene.kind === "model") forgetModel(scene.modelUrl);
    reporter.failed(scene.key);
  };
  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(scene.targetId);
  };
  return (
    <group position={pose.position} rotation={pose.rotation} scale={pose.scale} onClick={select}>
      <RenderBoundary resetKey={scene.key} onReady={() => reporter.ready(scene.key)} onFailed={failed}>
        {scene.kind === "preset" ? <PresetScene preset={scene.preset} /> : <RemoteModel url={scene.modelUrl} />}
      </RenderBoundary>
    </group>
  );
}

export function Stage({
  state,
  reporter,
  onSelect,
}: {
  state: DisplayState;
  reporter: RenderReporter;
  onSelect: (targetId: string) => void;
}) {
  const presenting = useXR((xr) => Boolean(xr.session));
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[2, 4, 3]} intensity={1.4} />
      <Backdrop />
      <OrbitControls target={[0, 1, 0]} enabled={!presenting} />
      {state.scene ? (
        <SceneContent key={state.scene.key} scene={state.scene} reporter={reporter} onSelect={onSelect} />
      ) : null}
      {state.panels.map((panel) => (
        <PanelCard key={panel.panelId} panel={panel} reporter={reporter} onSelect={onSelect} />
      ))}
      <RenderReports revision={state.revision} reporter={reporter} />
    </>
  );
}
