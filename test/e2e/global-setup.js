import { mkdirSync, writeFileSync } from "node:fs";
import { startTestApp } from "../helpers.js";

const STATE = "/tmp/vr-mcp-e2e-state.json";

export default async function globalSetup() {
  const started = await startTestApp({ ACK_WAIT_MS: "2000" });
  mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
  mkdirSync("/opt/cursor/artifacts/logs", { recursive: true });
  writeFileSync(STATE, JSON.stringify({
    port: started.port,
    tunnelPort: started.tunnelPort,
    bearer: started.env.MCP_BEARER_SECRET,
    pairing: started.env.DEVICE_PAIRING_TOKEN,
  }), { mode: 0o600 });
  globalThis.__vrApp = started.app;
}

export { STATE };
