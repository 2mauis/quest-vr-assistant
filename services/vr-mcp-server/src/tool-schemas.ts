// Advertised tool contract. tools/list must stay byte-compatible with the
// fixture in test/fixtures/mcp-golden.json; change it only together with the
// connector that consumes it.
import {
  ANCHORS,
  CLEAR_SCOPES,
  IDENTIFIER_SOURCE,
  LIMITS,
  PRESETS,
  TOOL_STATUSES,
  type ToolName,
} from "../../../shared/protocol/index.ts";

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: JsonSchema;
}

function axes(limit: number): JsonSchema {
  const axis = { type: "number", minimum: -limit, maximum: limit };
  return {
    type: "object",
    additionalProperties: false,
    required: ["x", "y", "z"],
    properties: { x: axis, y: axis, z: axis },
  };
}

const poseSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    position: axes(LIMITS.position),
    rotation: axes(LIMITS.rotation),
    scale: { type: "number", minimum: LIMITS.scaleMin, maximum: LIMITS.scaleMax },
  },
};

const identifierSchema: JsonSchema = { type: "string", pattern: IDENTIFIER_SOURCE };
const anchorSchema: JsonSchema = { type: "string", enum: [...ANCHORS] };

export const toolDefinitions: readonly ToolDefinition[] = [
  {
    name: "show_scene",
    description:
      "在已配对的显示端展示一个预设三维场景，或一个允许列表内的 glTF 模型。delivered 仅在显示端确认后为 true。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "anchor"],
      properties: {
        request_id: identifierSchema,
        preset: { type: "string", enum: [...PRESETS] },
        model_url: { type: "string", maxLength: LIMITS.modelUrl },
        anchor: anchorSchema,
        pose: poseSchema,
      },
    },
  },
  {
    name: "render_panel",
    description: "在场景中显示一块纯文本信息面板。不执行面板正文。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "panel_id", "text"],
      properties: {
        request_id: identifierSchema,
        panel_id: identifierSchema,
        text: { type: "string", minLength: 1, maxLength: LIMITS.panelText },
        title: { type: "string", maxLength: LIMITS.panelTitle },
        anchor: anchorSchema,
        pose: poseSchema,
      },
    },
  },
  {
    name: "clear",
    description: "按 scope 清除场景、指定面板或全部显示内容。scope 必须显式给出。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "scope"],
      properties: {
        request_id: identifierSchema,
        scope: { type: "string", enum: [...CLEAR_SCOPES] },
        panel_id: identifierSchema,
      },
    },
  },
];

/**
 * Shape of every `structuredContent`. Deliberately not registered as an MCP
 * `outputSchema`: tools/list has never advertised one and connectors would start
 * validating against it. Tests check every relay result against this schema.
 */
export const toolResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["request_id", "status", "seq", "delivered", "error_code"],
  properties: {
    request_id: { type: "string" },
    status: { type: "string", enum: [...TOOL_STATUSES] },
    seq: { type: "integer" },
    delivered: { type: "boolean" },
    error_code: { type: ["string", "null"] },
  },
};
