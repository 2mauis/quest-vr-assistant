// Pure scene / panel state of the display. Every item carries a render key that
// changes whenever its content changes, so the renderer can report readiness for
// exactly the item a command produced.
import type {
  Anchor,
  ClearBody,
  CommandMessage,
  Pose,
  Preset,
  RenderPanelBody,
  SceneSnapshot,
  ShowSceneBody,
} from "../../../../shared/protocol/index.ts";

export type SceneItem =
  | { kind: "preset"; key: string; preset: Preset; anchor: Anchor; pose: Pose; targetId: Preset }
  | { kind: "model"; key: string; modelUrl: string; anchor: Anchor; pose: Pose; targetId: "model" };

export interface PanelItem {
  key: string;
  panelId: string;
  title: string;
  text: string;
  anchor: Anchor;
  pose: Pose;
}

export interface DisplayState {
  /** Increases on every applied change; the renderer reports which revision it committed. */
  revision: number;
  scene: SceneItem | null;
  panels: readonly PanelItem[];
}

export interface Transition {
  state: DisplayState;
  /** Render keys that must report ready before the change counts as shown. */
  awaiting: readonly string[];
}

export const EMPTY_STATE: DisplayState = { revision: 0, scene: null, panels: [] };

function sceneItem(body: ShowSceneBody, revision: number): SceneItem | null {
  if (body.preset) {
    return {
      kind: "preset",
      key: `scene:${revision}`,
      preset: body.preset,
      anchor: body.anchor,
      pose: body.pose,
      targetId: body.preset,
    };
  }
  if (body.model_url) {
    return {
      kind: "model",
      key: `scene:${revision}`,
      modelUrl: body.model_url,
      anchor: body.anchor,
      pose: body.pose,
      targetId: "model",
    };
  }
  return null;
}

function panelItem(body: RenderPanelBody, revision: number): PanelItem {
  return {
    key: `panel:${body.panel_id}:${revision}`,
    panelId: body.panel_id,
    title: body.title,
    text: body.text,
    anchor: body.anchor,
    pose: body.pose,
  };
}

function withPanel(panels: readonly PanelItem[], panel: PanelItem): PanelItem[] {
  return [...panels.filter((item) => item.panelId !== panel.panelId), panel];
}

function cleared(state: DisplayState, body: ClearBody, revision: number): DisplayState {
  const scene = body.scope === "all" || body.scope === "scene" ? null : state.scene;
  let panels = state.panels;
  if (body.scope === "all") panels = [];
  if (body.scope === "panel" && body.panel_id) panels = panels.filter((item) => item.panelId !== body.panel_id);
  return { revision, scene, panels };
}

export function applyCommand(state: DisplayState, command: CommandMessage): Transition {
  const revision = state.revision + 1;
  switch (command.type) {
    case "show_scene": {
      const scene = sceneItem(command.body, revision);
      return { state: { ...state, revision, scene }, awaiting: scene ? [scene.key] : [] };
    }
    case "render_panel": {
      const panel = panelItem(command.body, revision);
      return { state: { ...state, revision, panels: withPanel(state.panels, panel) }, awaiting: [panel.key] };
    }
    case "clear":
      return { state: cleared(state, command.body, revision), awaiting: [] };
  }
}

export function applySnapshot(state: DisplayState, snapshot: SceneSnapshot): Transition {
  const revision = state.revision + 1;
  const scene = snapshot.scene ? sceneItem(snapshot.scene, revision) : null;
  const panels = snapshot.panels.reduce<PanelItem[]>((list, body) => withPanel(list, panelItem(body, revision)), []);
  return {
    state: { revision, scene, panels },
    awaiting: [...(scene ? [scene.key] : []), ...panels.map((panel) => panel.key)],
  };
}

export function resetState(state: DisplayState): DisplayState {
  return { revision: state.revision + 1, scene: null, panels: [] };
}

/** Value of `data-scene`: the preset name, `model` once a model is ready, or empty. */
export function sceneName(scene: SceneItem | null, ready: boolean): string {
  if (!scene) return "";
  if (scene.kind === "preset") return scene.preset;
  return ready ? "model" : "";
}
