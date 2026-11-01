const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PRESETS = ["grid", "orbit", "crystal", "pedestal"];
const ANCHORS = ["world", "head", "floor", "front", "left", "right"];

const poseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    position: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y", "z"],
      properties: {
        x: { type: "number", minimum: -10, maximum: 10 },
        y: { type: "number", minimum: -10, maximum: 10 },
        z: { type: "number", minimum: -10, maximum: 10 },
      },
    },
    rotation: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y", "z"],
      properties: {
        x: { type: "number", minimum: -360, maximum: 360 },
        y: { type: "number", minimum: -360, maximum: 360 },
        z: { type: "number", minimum: -360, maximum: 360 },
      },
    },
    scale: { type: "number", minimum: 0.1, maximum: 3 },
  },
};

const requestIdSchema = { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" };

export const toolDefinitions = [
  {
    name: "show_scene",
    description: "在已配对的显示端展示一个预设三维场景，或一个允许列表内的 glTF 模型。delivered 仅在显示端确认后为 true。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "anchor"],
      properties: {
        request_id: requestIdSchema,
        preset: { type: "string", enum: PRESETS },
        model_url: { type: "string", maxLength: 2048 },
        anchor: { type: "string", enum: ANCHORS },
        pose: poseSchema,
      },
    },
    outputSchema: resultSchema(),
  },
  {
    name: "render_panel",
    description: "在场景中显示一块纯文本信息面板。不执行面板正文。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "panel_id", "text"],
      properties: {
        request_id: requestIdSchema,
        panel_id: requestIdSchema,
        text: { type: "string", minLength: 1, maxLength: 20000 },
        title: { type: "string", maxLength: 100 },
        anchor: { type: "string", enum: ANCHORS },
        pose: poseSchema,
      },
    },
    outputSchema: resultSchema(),
  },
  {
    name: "clear",
    description: "按 scope 清除场景、指定面板或全部显示内容。scope 必须显式给出。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "scope"],
      properties: {
        request_id: requestIdSchema,
        scope: { type: "string", enum: ["scene", "panel", "all"] },
        panel_id: requestIdSchema,
      },
    },
    outputSchema: resultSchema(),
  },
];

function resultSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["request_id", "status", "seq", "delivered", "error_code"],
    properties: {
      request_id: { type: "string" },
      status: { type: "string", enum: ["queued", "rendered", "offline", "expired", "rejected"] },
      seq: { type: "integer" },
      delivered: { type: "boolean" },
      error_code: { type: ["string", "null"] },
    },
  };
}

function isPlain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteInRange(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function normalizePose(input) {
  const pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
  };
  if (input === undefined) return { ok: true, pose };
  if (!isPlain(input)) return { ok: false };
  const keys = Object.keys(input);
  if (keys.some((key) => !["position", "rotation", "scale"].includes(key))) return { ok: false };
  if (input.position !== undefined) {
    if (!isPlain(input.position) || Object.keys(input.position).sort().join() !== "x,y,z") return { ok: false };
    for (const axis of ["x", "y", "z"]) {
      if (!finiteInRange(input.position[axis], -10, 10)) return { ok: false };
      pose.position[axis] = input.position[axis];
    }
  }
  if (input.rotation !== undefined) {
    if (!isPlain(input.rotation) || Object.keys(input.rotation).sort().join() !== "x,y,z") return { ok: false };
    for (const axis of ["x", "y", "z"]) {
      if (!finiteInRange(input.rotation[axis], -360, 360)) return { ok: false };
      pose.rotation[axis] = input.rotation[axis];
    }
  }
  if (input.scale !== undefined) {
    if (!finiteInRange(input.scale, 0.1, 3)) return { ok: false };
    pose.scale = input.scale;
  }
  return { ok: true, pose };
}

function plainText(value, max) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) return false;
  if (/[<>\u0000]/.test(value)) return false;
  return true;
}

function isIpHostname(hostname) {
  if (hostname.includes(":")) return true;
  return /^\d+(\.\d+){3}$/.test(hostname);
}

export function validateModelUrl(value, allowedOrigins) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.hash) return false;
  if ((url.search || "").length > 256) return false;
  if (isIpHostname(url.hostname)) return false;
  if (!/\.(gltf|glb)$/i.test(url.pathname)) return false;
  return allowedOrigins.includes(url.origin);
}

export function validateToolCall(name, args, config) {
  if (!isPlain(args)) return { ok: false, error_code: "invalid_arguments" };
  if (typeof args.request_id !== "string" || !ID_PATTERN.test(args.request_id)) {
    return { ok: false, error_code: "invalid_request_id" };
  }
  if (name === "show_scene") {
    const keys = Object.keys(args);
    if (keys.some((key) => !["request_id", "preset", "model_url", "anchor", "pose"].includes(key))) {
      return { ok: false, error_code: "invalid_arguments" };
    }
    const hasPreset = args.preset !== undefined;
    const hasModel = args.model_url !== undefined;
    if (hasPreset === hasModel) return { ok: false, error_code: "invalid_scene_source" };
    if (!ANCHORS.includes(args.anchor)) return { ok: false, error_code: "invalid_anchor" };
    if (hasPreset && !PRESETS.includes(args.preset)) return { ok: false, error_code: "invalid_preset" };
    if (hasModel && !validateModelUrl(args.model_url, config.assetAllowedOrigins)) {
      return { ok: false, error_code: "invalid_model_url" };
    }
    const pose = normalizePose(args.pose);
    if (!pose.ok) return { ok: false, error_code: "invalid_pose" };
    return {
      ok: true,
      request_id: args.request_id,
      type: "show_scene",
      body: {
        preset: hasPreset ? args.preset : null,
        model_url: hasModel ? args.model_url : null,
        anchor: args.anchor,
        pose: pose.pose,
      },
    };
  }
  if (name === "render_panel") {
    const keys = Object.keys(args);
    if (keys.some((key) => !["request_id", "panel_id", "text", "title", "anchor", "pose"].includes(key))) {
      return { ok: false, error_code: "invalid_arguments" };
    }
    if (typeof args.panel_id !== "string" || !ID_PATTERN.test(args.panel_id)) {
      return { ok: false, error_code: "invalid_panel_id" };
    }
    if (!plainText(args.text, 20000)) return { ok: false, error_code: "invalid_text" };
    if (args.title !== undefined && !plainText(args.title, 100)) return { ok: false, error_code: "invalid_title" };
    const anchor = args.anchor === undefined ? "front" : args.anchor;
    if (!ANCHORS.includes(anchor)) return { ok: false, error_code: "invalid_anchor" };
    const pose = normalizePose(args.pose);
    if (!pose.ok) return { ok: false, error_code: "invalid_pose" };
    return {
      ok: true,
      request_id: args.request_id,
      type: "render_panel",
      body: {
        panel_id: args.panel_id,
        title: args.title ?? "",
        text: args.text,
        anchor,
        pose: pose.pose,
      },
    };
  }
  if (name === "clear") {
    const keys = Object.keys(args);
    if (keys.some((key) => !["request_id", "scope", "panel_id"].includes(key))) {
      return { ok: false, error_code: "invalid_arguments" };
    }
    if (!["scene", "panel", "all"].includes(args.scope)) return { ok: false, error_code: "invalid_scope" };
    if (args.scope === "panel") {
      if (typeof args.panel_id !== "string" || !ID_PATTERN.test(args.panel_id)) {
        return { ok: false, error_code: "invalid_panel_id" };
      }
    } else if (args.panel_id !== undefined) {
      return { ok: false, error_code: "invalid_arguments" };
    }
    return {
      ok: true,
      request_id: args.request_id,
      type: "clear",
      body: { scope: args.scope, panel_id: args.scope === "panel" ? args.panel_id : null },
    };
  }
  return { ok: false, error_code: "unknown_tool" };
}

export function wireMessage(name, args) {
  return validateToolCall(name, args, { assetAllowedOrigins: [] });
}
