// Calls the three tools once against a running relay (see scripts/start-local.sh).
import { callTool, connectMcp, runId } from "./mcp-client.ts";

const { TUNNEL_HOST: host, TUNNEL_PORT: port, MCP_BEARER_SECRET: token } = process.env;
if (!host || !port || !token) {
  process.stderr.write("缺少 TUNNEL_HOST、TUNNEL_PORT 或 MCP_BEARER_SECRET\n");
  process.exit(1);
}

const id = runId();
const client = await connectMcp(new URL(`http://${host}:${port}/mcp`), token, "local-demo");
try {
  const calls: [string, Record<string, unknown>][] = [
    ["show_scene", { request_id: `demo-scene-${id}`, preset: "pedestal", anchor: "front" }],
    [
      "render_panel",
      { request_id: `demo-panel-${id}`, panel_id: "info", title: "Note", text: "Hello display", anchor: "right" },
    ],
    ["clear", { request_id: `demo-clear-${id}`, scope: "all" }],
  ];
  for (const [name, args] of calls) {
    const result = await callTool(client, name, args);
    process.stdout.write(
      `${name} request_id=${result.request_id} status=${result.status} seq=${result.seq} delivered=${result.delivered}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await client.close();
}
