import { rmSync } from "node:fs";

export default async function globalTeardown() {
  if (globalThis.__vrApp) await globalThis.__vrApp.close();
  rmSync("/tmp/vr-mcp-e2e-state.json", { force: true });
}
