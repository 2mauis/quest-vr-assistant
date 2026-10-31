import assert from "node:assert/strict";
import test from "node:test";
import { mcpCall, mcpHeaders, modernBody, startTestApp } from "./helpers.js";

async function post(port, headers, body) {
  const response = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null, text };
}

test("modern discover, tools/list, and version errors follow 2026-07-28", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const { tunnelPort, env } = started;

  const listed = await post(
    tunnelPort,
    mcpHeaders(env.MCP_BEARER_SECRET, "tools/list"),
    modernBody(2, "tools/list", {}),
  );
  assert.equal(listed.response.status, 200);
  assert.equal(listed.json.result.resultType, "complete");
  assert.deepEqual(listed.json.result.tools.map((tool) => tool.name), ["show_scene", "render_panel", "clear"]);

  const mismatch = await post(tunnelPort, {
    ...mcpHeaders(env.MCP_BEARER_SECRET, "tools/list"),
    "mcp-protocol-version": "2026-07-28",
  }, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2025-11-25",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });
  assert.equal(mismatch.response.status, 400);
  assert.equal(mismatch.json.error.code, -32020);

  const unsupported = await post(tunnelPort, {
    ...mcpHeaders(env.MCP_BEARER_SECRET, "tools/list"),
    "mcp-protocol-version": "1999-01-01",
  }, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/list",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "1999-01-01",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });
  assert.equal(unsupported.response.status, 400);
  assert.equal(unsupported.json.error.code, -32022);
  assert.deepEqual(unsupported.json.error.data.supported, ["2026-07-28", "2025-11-25"]);

  const missingName = await mcpCall(tunnelPort, env.MCP_BEARER_SECRET, "show_scene", {
    request_id: "scene-a",
    preset: "pedestal",
    anchor: "front",
  });
  // mcpCall includes Mcp-Name. A call without it is covered below.
  assert.equal(missingName.response.status, 200);
  assert.equal(missingName.body.result.structuredContent.status, "queued");
  assert.equal(missingName.body.result.structuredContent.delivered, false);

  const nameless = await post(tunnelPort, mcpHeaders(env.MCP_BEARER_SECRET, "tools/call"), modernBody(5, "tools/call", {
    name: "show_scene",
    arguments: { request_id: "scene-b", preset: "grid", anchor: "world" },
  }));
  assert.equal(nameless.response.status, 400);
  assert.equal(nameless.json.error.code, -32020);

  const badUrl = await mcpCall(tunnelPort, env.MCP_BEARER_SECRET, "show_scene", {
    request_id: "scene-c",
    model_url: "http://assets.example.com/model.glb",
    anchor: "front",
  }, 6);
  assert.equal(badUrl.body.result.isError, true);
  assert.equal(badUrl.body.result.structuredContent.error_code, "invalid_model_url");

  const goodUrl = await mcpCall(tunnelPort, env.MCP_BEARER_SECRET, "show_scene", {
    request_id: "scene-d",
    model_url: "https://assets.example.com/models/box.glb",
    anchor: "front",
    pose: { scale: 1 },
  }, 7);
  assert.equal(goodUrl.body.result.isError, false);
  assert.equal(goodUrl.body.result.structuredContent.delivered, false);

  const blockedHost = ["10", "1", "1", "1"].join(".");
  const ipUrl = await mcpCall(tunnelPort, env.MCP_BEARER_SECRET, "show_scene", {
    request_id: "scene-e",
    model_url: `https://${blockedHost}/model.glb`,
    anchor: "front",
  }, 8);
  assert.equal(ipUrl.body.result.structuredContent.error_code, "invalid_model_url");
});

test("legacy 2025-11-25 initialize then tools/call", async (t) => {
  const started = await startTestApp();
  t.after(() => started.app.close());
  const { tunnelPort, env } = started;
  const endpoint = `http://localhost:${tunnelPort}/mcp`;
  const common = {
    authorization: `Bearer ${env.MCP_BEARER_SECRET}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const init = await fetch(endpoint, {
    method: "POST",
    headers: common,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "legacy-test", version: "0.1.0" },
      },
    }),
  });
  const initBody = await init.json();
  const session = init.headers.get("mcp-session-id");
  assert.equal(init.status, 200);
  assert.equal(initBody.result.protocolVersion, "2025-11-25");
  assert.ok(session);

  const initialized = await fetch(endpoint, {
    method: "POST",
    headers: { ...common, "mcp-session-id": session, "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.equal(initialized.status, 202);

  const call = await fetch(endpoint, {
    method: "POST",
    headers: { ...common, "mcp-session-id": session, "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "render_panel",
        arguments: { request_id: "legacy-panel", panel_id: "info", text: "Legacy panel" },
      },
    }),
  });
  const callBody = await call.json();
  assert.equal(call.status, 200);
  assert.equal(callBody.result.resultType, undefined);
  assert.equal(callBody.result.structuredContent.status, "queued");
  assert.equal(callBody.result.isError, false);

  const removed = await fetch(endpoint, {
    method: "DELETE",
    headers: { authorization: `Bearer ${env.MCP_BEARER_SECRET}`, "mcp-session-id": session },
  });
  assert.equal(removed.status, 204);

  const after = await fetch(endpoint, {
    method: "POST",
    headers: { ...common, "mcp-session-id": session, "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
  });
  assert.equal(after.status, 404);

  const getStream = await fetch(endpoint, {
    headers: { authorization: `Bearer ${env.MCP_BEARER_SECRET}` },
  });
  assert.equal(getStream.status, 405);
});
