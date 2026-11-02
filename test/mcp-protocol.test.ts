import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { toolDefinitions } from "../services/vr-mcp-server/src/index.ts";
import { type Json, mcpCall, mcpHeaders, modernBody, postJson, startTestApp } from "./helpers.ts";

const golden = JSON.parse(readFileSync(new URL("./fixtures/mcp-golden.json", import.meta.url), "utf8")) as Record<
  string,
  { status: number; body: Json }
>;

function versionMeta(version: string) {
  return {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": version,
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}

test("tools/list, discover, -32022 and legacy initialize match the 6986cb0 golden responses", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const url = `http://localhost:${started.tunnelPort}/mcp`;
  const token = started.env.MCP_BEARER_SECRET;

  const listed = await postJson(url, mcpHeaders(token, "tools/list"), modernBody(2, "tools/list", {}));
  assert.equal(listed.response.status, golden.modernToolsList?.status);
  assert.deepEqual(listed.json.result, golden.modernToolsList?.body.result);

  const discovered = await postJson(url, mcpHeaders(token, "server/discover"), modernBody(1, "server/discover", {}));
  assert.equal(discovered.response.status, golden.modernDiscover?.status);
  assert.deepEqual(discovered.json.result, golden.modernDiscover?.body.result);

  const unsupported = await postJson(
    url,
    { ...mcpHeaders(token, "tools/list"), "mcp-protocol-version": "1999-01-01" },
    { jsonrpc: "2.0", id: 4, method: "tools/list", params: versionMeta("1999-01-01") },
  );
  assert.equal(unsupported.response.status, golden.unsupportedVersion?.status);
  assert.deepEqual(unsupported.json, golden.unsupportedVersion?.body);

  const common = {
    authorization: `Bearer ${token}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const init = await postJson(url, common, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "golden", version: "0.1.0" } },
  });
  assert.equal(init.response.status, golden.legacyInitialize?.status);
  assert.deepEqual(init.json.result, golden.legacyInitialize?.body.result);
  const session = init.response.headers.get("mcp-session-id");
  assert.ok(session);
  const legacyHeaders = { ...common, "mcp-session-id": session, "mcp-protocol-version": "2025-11-25" };
  await postJson(url, legacyHeaders, { jsonrpc: "2.0", method: "notifications/initialized" });
  const legacyList = await postJson(url, legacyHeaders, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(legacyList.response.status, golden.legacyToolsList?.status);
  assert.deepEqual(legacyList.json.result, golden.legacyToolsList?.body.result);
  assert.deepEqual(
    legacyList.json.result.tools.map((tool: Json) => tool.inputSchema),
    toolDefinitions.map((tool) => tool.inputSchema),
  );
});

test("modern requests enforce header / body version agreement and Mcp-Name", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const url = `http://localhost:${started.tunnelPort}/mcp`;
  const token = started.env.MCP_BEARER_SECRET;

  const mismatch = await postJson(url, mcpHeaders(token, "tools/list"), {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
    params: versionMeta("2025-11-25"),
  });
  assert.equal(mismatch.response.status, 400);
  assert.equal(mismatch.json.error.code, -32020);

  const named = await mcpCall(started.tunnelPort, token, "show_scene", {
    request_id: "scene-a",
    preset: "pedestal",
    anchor: "front",
  });
  assert.equal(named.response.status, 200);
  assert.equal(named.body.result.structuredContent.status, "queued");
  assert.equal(named.body.result.structuredContent.delivered, false);

  const nameless = await postJson(
    url,
    mcpHeaders(token, "tools/call"),
    modernBody(5, "tools/call", {
      name: "show_scene",
      arguments: { request_id: "scene-b", preset: "grid", anchor: "world" },
    }),
  );
  assert.equal(nameless.response.status, 400);
  assert.equal(nameless.json.error.code, -32020);
});

test("tool calls report validation failures as isError with a stable error_code", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const call = (args: Record<string, unknown>, id: number, name = "show_scene") =>
    mcpCall(started.tunnelPort, started.env.MCP_BEARER_SECRET, name, args, id);

  const badUrl = await call({ request_id: "scene-c", model_url: "http://assets.example.com/model.glb", anchor: "front" }, 6);
  assert.equal(badUrl.body.result.isError, true);
  assert.equal(badUrl.body.result.structuredContent.error_code, "invalid_model_url");
  assert.equal(badUrl.body.result.structuredContent.delivered, false);

  const goodUrl = await call(
    { request_id: "scene-d", model_url: "https://assets.example.com/models/box.glb", anchor: "front", pose: { scale: 1 } },
    7,
  );
  assert.equal(goodUrl.body.result.isError, false);
  assert.equal(goodUrl.body.result.structuredContent.delivered, false);

  const blockedHost = ["10", "1", "1", "1"].join(".");
  const ipUrl = await call({ request_id: "scene-e", model_url: `https://${blockedHost}/model.glb`, anchor: "front" }, 8);
  assert.equal(ipUrl.body.result.structuredContent.error_code, "invalid_model_url");

  const unknown = await call({ request_id: "x1", anchor: "front" }, 9, "explode");
  assert.equal(unknown.body.error.code, -32602);
});

test("legacy 2025-11-25 initialize, tools/call, DELETE and GET", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const endpoint = `http://localhost:${started.tunnelPort}/mcp`;
  const common = {
    authorization: `Bearer ${started.env.MCP_BEARER_SECRET}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const init = await postJson(endpoint, common, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy-test", version: "0.1.0" } },
  });
  const session = init.response.headers.get("mcp-session-id");
  assert.equal(init.response.status, 200);
  assert.equal(init.json.result.protocolVersion, "2025-11-25");
  assert.ok(session);
  const legacy = { ...common, "mcp-session-id": session, "mcp-protocol-version": "2025-11-25" };

  const initialized = await postJson(endpoint, legacy, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(initialized.response.status, 202);

  const call = await postJson(endpoint, legacy, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "render_panel",
      arguments: { request_id: "legacy-panel", panel_id: "info", text: "Legacy panel" },
    },
  });
  assert.equal(call.response.status, 200);
  assert.equal(call.json.result.resultType, undefined);
  assert.equal(call.json.result.structuredContent.status, "queued");
  assert.equal(call.json.result.isError, false);

  const removed = await fetch(endpoint, {
    method: "DELETE",
    headers: { authorization: common.authorization, "mcp-session-id": session },
  });
  assert.equal(removed.status, 204);

  const after = await postJson(endpoint, legacy, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
  assert.equal(after.response.status, 404);

  const getStream = await fetch(endpoint, { headers: { authorization: common.authorization } });
  assert.equal(getStream.status, 405);
});

test("malformed transport requests fail with JSON-RPC errors instead of crashing", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const url = `http://localhost:${started.tunnelPort}/mcp`;
  const headers = mcpHeaders(started.env.MCP_BEARER_SECRET, "tools/list");

  const parse = await fetch(url, { method: "POST", headers, body: "{not json" });
  assert.equal(parse.status, 400);
  assert.equal(((await parse.json()) as Json).error.code, -32700);

  const wrongType = await fetch(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" });
  assert.equal(wrongType.status, 400);
  assert.equal(((await wrongType.json()) as Json).error.code, -32600);

  const tooLarge = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(modernBody(1, "tools/list", { padding: "x".repeat(300 * 1024) })),
  });
  assert.equal(tooLarge.status, 413);

  const search = await fetch(`${url}?a=1`, { method: "POST", headers, body: "{}" });
  assert.equal(search.status, 400);
});
