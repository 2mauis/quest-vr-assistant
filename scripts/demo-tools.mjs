const host = process.env.TUNNEL_HOST;
const port = process.env.TUNNEL_PORT;
const token = process.env.MCP_BEARER_SECRET;

if (!host || !port || !token) {
  process.stderr.write("缺少 TUNNEL_HOST、TUNNEL_PORT 或 MCP_BEARER_SECRET\n");
  process.exit(1);
}

const endpoint = `http://${host}:${port}/mcp`;

function meta() {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "local-demo", version: "0.1.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

async function call(name, args, id) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args, _meta: meta() },
    }),
  });
  const body = await response.json();
  const payload = body.result?.structuredContent;
  if (!response.ok || !payload) {
    process.stderr.write(`${name} 失败，HTTP ${response.status}\n`);
    process.exit(1);
  }
  process.stdout.write(`${name} status=${payload.status} seq=${payload.seq} delivered=${payload.delivered}\n`);
}

await call("show_scene", {
  request_id: "demo-scene",
  preset: "pedestal",
  anchor: "front",
}, 1);

await call("render_panel", {
  request_id: "demo-panel",
  panel_id: "info",
  title: "Note",
  text: "Hello display",
  anchor: "right",
}, 2);

await call("clear", {
  request_id: "demo-clear",
  scope: "all",
}, 3);
