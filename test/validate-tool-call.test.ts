import assert from "node:assert/strict";
import test from "node:test";
import { toolDefinitions, toolResultSchema, validateToolCall } from "../services/vr-mcp-server/src/index.ts";
import { TOOL_NAMES } from "../shared/protocol/index.ts";

const options = { assetAllowedOrigins: ["https://assets.example.com"] };
const code = (name: string, args: unknown) => {
  const result = validateToolCall(name, args, options);
  return result.ok ? "ok" : result.error_code;
};

test("show_scene accepts exactly one source and normalises pose and anchor", () => {
  const preset = validateToolCall("show_scene", { request_id: "a", preset: "grid", anchor: "left" }, options);
  assert.deepEqual(preset, {
    ok: true,
    request_id: "a",
    type: "show_scene",
    body: {
      preset: "grid",
      model_url: null,
      anchor: "left",
      pose: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
    },
  });
  const model = validateToolCall(
    "show_scene",
    {
      request_id: "b",
      model_url: "https://assets.example.com/a.glb",
      anchor: "front",
      pose: { position: { x: 1, y: 0, z: -2 }, scale: 2 },
    },
    options,
  );
  assert.equal(model.ok, true);
  assert.equal(code("show_scene", { request_id: "c", anchor: "front" }), "invalid_scene_source");
  assert.equal(
    code("show_scene", { request_id: "c", preset: "grid", model_url: "https://assets.example.com/a.glb", anchor: "front" }),
    "invalid_scene_source",
  );
});

test("show_scene rejects unsafe or out-of-range input with stable codes", () => {
  const base = { request_id: "x", preset: "grid", anchor: "front" };
  assert.equal(code("show_scene", null), "invalid_arguments");
  assert.equal(code("show_scene", { ...base, extra: 1 }), "invalid_arguments");
  assert.equal(code("show_scene", { ...base, request_id: "has space" }), "invalid_request_id");
  assert.equal(code("show_scene", { ...base, request_id: "x".repeat(65) }), "invalid_request_id");
  assert.equal(code("show_scene", { ...base, anchor: "ceiling" }), "invalid_anchor");
  assert.equal(code("show_scene", { ...base, preset: "castle" }), "invalid_preset");
  assert.equal(code("show_scene", { ...base, pose: { scale: 4 } }), "invalid_pose");
  assert.equal(code("show_scene", { ...base, pose: { position: { x: 11, y: 0, z: 0 } } }), "invalid_pose");
  assert.equal(code("show_scene", { ...base, pose: { rotation: { x: 0, y: Number.NaN, z: 0 } } }), "invalid_pose");
  assert.equal(code("show_scene", { ...base, pose: { position: { x: 0, y: 0 } } }), "invalid_pose");
  const model = { request_id: "m", anchor: "front" };
  for (const url of [
    "http://assets.example.com/a.glb",
    "https://other.example.com/a.glb",
    "https://user@assets.example.com/a.glb",
    "https://assets.example.com/a.glb#x",
    `https://assets.example.com/${"a".repeat(2048)}.glb`,
    "not a url",
  ]) {
    assert.equal(code("show_scene", { ...model, model_url: url }), "invalid_model_url", url);
  }
});

test("render_panel and clear validate ids, text and scope", () => {
  const panel = { request_id: "p", panel_id: "info", text: "hello" };
  assert.equal(code("render_panel", panel), "ok");
  assert.equal(code("render_panel", { ...panel, panel_id: "bad id" }), "invalid_panel_id");
  assert.equal(code("render_panel", { ...panel, text: "" }), "invalid_text");
  assert.equal(code("render_panel", { ...panel, text: "x".repeat(20001) }), "invalid_text");
  assert.equal(code("render_panel", { ...panel, title: "x".repeat(101) }), "invalid_title");
  assert.equal(code("clear", { request_id: "c", scope: "all" }), "ok");
  assert.equal(code("clear", { request_id: "c", scope: "panel" }), "invalid_panel_id");
  assert.equal(code("clear", { request_id: "c", scope: "panel", panel_id: "info" }), "ok");
  assert.equal(code("clear", { request_id: "c", scope: "everything" }), "invalid_scope");
  assert.equal(code("teleport", { request_id: "c" }), "unknown_tool");
});

test("advertised tool definitions stay in sync with the shared protocol", () => {
  assert.deepEqual(
    toolDefinitions.map((tool) => tool.name),
    [...TOOL_NAMES],
  );
  for (const tool of toolDefinitions) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.inputSchema.required.includes("request_id"));
  }
  assert.deepEqual(toolResultSchema.required, ["request_id", "status", "seq", "delivered", "error_code"]);
});
