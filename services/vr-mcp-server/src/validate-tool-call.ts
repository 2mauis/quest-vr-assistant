// Tool argument validation. The advertised JSON schema is not enforced by the
// SDK (see mcp-server.ts) so that every rejection reaches the caller as a
// structured result with a stable `error_code`.
import {
  ANCHORS,
  CLEAR_SCOPES,
  LIMITS,
  PRESETS,
  includes,
  isIdentifier,
  isIpHostname,
  type CommandBodies,
  type Pose,
  type ToolName,
  type Vector3,
} from "../../../shared/protocol/index.ts";

export type ValidationErrorCode =
  | "invalid_arguments"
  | "invalid_request_id"
  | "invalid_scene_source"
  | "invalid_anchor"
  | "invalid_preset"
  | "invalid_model_url"
  | "invalid_pose"
  | "invalid_panel_id"
  | "invalid_text"
  | "invalid_title"
  | "invalid_scope"
  | "unknown_tool";

export type ValidatedCall = {
  [Name in ToolName]: { ok: true; request_id: string; type: Name; body: CommandBodies[Name] };
}[ToolName];

export type ValidationResult = ValidatedCall | { ok: false; error_code: ValidationErrorCode };

export interface ValidationOptions {
  assetAllowedOrigins: readonly string[];
}

type Arguments = Record<string, unknown>;

function isPlain(value: unknown): value is Arguments {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(args: Arguments, allowed: readonly string[]): boolean {
  return Object.keys(args).every((key) => allowed.includes(key));
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function vector(input: unknown, limit: number): Vector3 | null {
  if (!isPlain(input) || Object.keys(input).sort().join() !== "x,y,z") return null;
  const { x, y, z } = input;
  if (!finiteInRange(x, -limit, limit) || !finiteInRange(y, -limit, limit) || !finiteInRange(z, -limit, limit)) {
    return null;
  }
  return { x, y, z };
}

function normalizePose(input: unknown): Pose | null {
  const pose: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };
  if (input === undefined) return pose;
  if (!isPlain(input) || !onlyKeys(input, ["position", "rotation", "scale"])) return null;
  if (input.position !== undefined) {
    const position = vector(input.position, LIMITS.position);
    if (!position) return null;
    pose.position = position;
  }
  if (input.rotation !== undefined) {
    const rotation = vector(input.rotation, LIMITS.rotation);
    if (!rotation) return null;
    pose.rotation = rotation;
  }
  if (input.scale !== undefined) {
    if (!finiteInRange(input.scale, LIMITS.scaleMin, LIMITS.scaleMax)) return null;
    pose.scale = input.scale;
  }
  return pose;
}

function isPlainText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max && !/[<>\u0000]/.test(value);
}

export function validateModelUrl(value: unknown, allowedOrigins: readonly string[]): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > LIMITS.modelUrl) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.hash) return false;
  if (url.search.length > LIMITS.modelQuery) return false;
  if (isIpHostname(url.hostname)) return false;
  if (!/\.(gltf|glb)$/i.test(url.pathname)) return false;
  return allowedOrigins.includes(url.origin);
}

function fail(error_code: ValidationErrorCode): ValidationResult {
  return { ok: false, error_code };
}

function showScene(request_id: string, args: Arguments, options: ValidationOptions): ValidationResult {
  if (!onlyKeys(args, ["request_id", "preset", "model_url", "anchor", "pose"])) return fail("invalid_arguments");
  const hasPreset = args.preset !== undefined;
  const hasModel = args.model_url !== undefined;
  if (hasPreset === hasModel) return fail("invalid_scene_source");
  if (!includes(ANCHORS, args.anchor)) return fail("invalid_anchor");
  if (hasPreset && !includes(PRESETS, args.preset)) return fail("invalid_preset");
  if (hasModel && !validateModelUrl(args.model_url, options.assetAllowedOrigins)) return fail("invalid_model_url");
  const pose = normalizePose(args.pose);
  if (!pose) return fail("invalid_pose");
  return {
    ok: true,
    request_id,
    type: "show_scene",
    body: {
      preset: includes(PRESETS, args.preset) ? args.preset : null,
      model_url: typeof args.model_url === "string" ? args.model_url : null,
      anchor: args.anchor,
      pose,
    },
  };
}

function renderPanel(request_id: string, args: Arguments): ValidationResult {
  if (!onlyKeys(args, ["request_id", "panel_id", "text", "title", "anchor", "pose"])) return fail("invalid_arguments");
  if (!isIdentifier(args.panel_id)) return fail("invalid_panel_id");
  if (!isPlainText(args.text, LIMITS.panelText)) return fail("invalid_text");
  if (args.title !== undefined && !isPlainText(args.title, LIMITS.panelTitle)) return fail("invalid_title");
  const anchor = args.anchor === undefined ? "front" : args.anchor;
  if (!includes(ANCHORS, anchor)) return fail("invalid_anchor");
  const pose = normalizePose(args.pose);
  if (!pose) return fail("invalid_pose");
  return {
    ok: true,
    request_id,
    type: "render_panel",
    body: {
      panel_id: args.panel_id,
      title: typeof args.title === "string" ? args.title : "",
      text: args.text,
      anchor,
      pose,
    },
  };
}

function clear(request_id: string, args: Arguments): ValidationResult {
  if (!onlyKeys(args, ["request_id", "scope", "panel_id"])) return fail("invalid_arguments");
  if (!includes(CLEAR_SCOPES, args.scope)) return fail("invalid_scope");
  if (args.scope === "panel") {
    if (!isIdentifier(args.panel_id)) return fail("invalid_panel_id");
    return { ok: true, request_id, type: "clear", body: { scope: "panel", panel_id: args.panel_id } };
  }
  if (args.panel_id !== undefined) return fail("invalid_arguments");
  return { ok: true, request_id, type: "clear", body: { scope: args.scope, panel_id: null } };
}

export function validateToolCall(name: string, args: unknown, options: ValidationOptions): ValidationResult {
  if (!isPlain(args)) return fail("invalid_arguments");
  if (!isIdentifier(args.request_id)) return fail("invalid_request_id");
  switch (name) {
    case "show_scene":
      return showScene(args.request_id, args, options);
    case "render_panel":
      return renderPanel(args.request_id, args);
    case "clear":
      return clear(args.request_id, args);
    default:
      return fail("unknown_tool");
  }
}
