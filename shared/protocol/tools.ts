// Tool vocabulary shared by the MCP server, the relay and the web display.
// The JSON schemas advertised over MCP live in services/vr-mcp-server and are
// built from these constants so the enums cannot drift apart.

export const IDENTIFIER_SOURCE = "^[A-Za-z0-9_-]{1,64}$";
const IDENTIFIER_PATTERN = new RegExp(IDENTIFIER_SOURCE);

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export const TOOL_NAMES = ["show_scene", "render_panel", "clear"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const PRESETS = ["grid", "orbit", "crystal", "pedestal"] as const;
export type Preset = (typeof PRESETS)[number];

export const ANCHORS = ["world", "head", "floor", "front", "left", "right"] as const;
export type Anchor = (typeof ANCHORS)[number];

export const CLEAR_SCOPES = ["scene", "panel", "all"] as const;
export type ClearScope = (typeof CLEAR_SCOPES)[number];

export const TOOL_STATUSES = ["queued", "rendered", "offline", "expired", "rejected"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const LIMITS = {
  position: 10,
  rotation: 360,
  scaleMin: 0.1,
  scaleMax: 3,
  modelUrl: 2048,
  modelQuery: 256,
  panelText: 20000,
  panelTitle: 100,
} as const;

export function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Pose {
  position: Vector3;
  rotation: Vector3;
  scale: number;
}

export interface ShowSceneBody {
  preset: Preset | null;
  model_url: string | null;
  anchor: Anchor;
  pose: Pose;
}

export interface RenderPanelBody {
  panel_id: string;
  title: string;
  text: string;
  anchor: Anchor;
  pose: Pose;
}

export interface ClearBody {
  scope: ClearScope;
  panel_id: string | null;
}

export interface CommandBodies {
  show_scene: ShowSceneBody;
  render_panel: RenderPanelBody;
  clear: ClearBody;
}

/** `structuredContent` of every tool call. */
export interface ToolResult {
  request_id: string;
  status: ToolStatus;
  seq: number;
  delivered: boolean;
  error_code: string | null;
}
