import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { chromium } from "@playwright/test";
import { startTestApp } from "../test/helpers.js";

const outputDir = process.env.QVR_CHECK_DIR || "test-results/mcp-delivered";
const started = await startTestApp({ ACK_WAIT_MS: "8000" });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const notes = [];
page.on("pageerror", (error) => notes.push(`pageerror ${error.message}`));
await mkdir(outputDir, { recursive: true });

try {
  await page.goto(`http://localhost:${started.port}/`);
  await page.locator("#token").fill(started.env.DEVICE_PAIRING_TOKEN);
  await page.locator("#connect").click();
  await page.locator("body").getAttribute("data-connected");
  await page.waitForFunction(() => document.body.dataset.connected === "1");
  const client = new Client(
    { name: "display-check", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${started.tunnelPort}/mcp`),
    { authProvider: { token: async () => started.env.MCP_BEARER_SECRET } },
  );
  await client.connect(transport);
  const calls = [
    ["show_scene", { request_id: "check-scene", preset: "pedestal", anchor: "front" }, "01-scene.png"],
    ["render_panel", {
      request_id: "check-panel", panel_id: "info", title: "Note", text: "Hello display", anchor: "right",
    }, "02-panel.png"],
    ["clear", { request_id: "check-clear", scope: "all" }, "03-clear.png"],
  ];
  const results = [];
  for (const [name, args, file] of calls) {
    const result = await client.callTool({ name, arguments: args });
    const payload = result.structuredContent;
    if (!payload || payload.delivered !== true) {
      throw new Error(`${name} delivered=${payload?.delivered} status=${payload?.status}`);
    }
    if (name === "show_scene") await page.locator("body").getAttribute("data-scene");
    await page.waitForFunction(
      (expected) => document.body.dataset.scene === expected.scene && document.body.dataset.panels === expected.panels,
      { scene: name === "clear" ? "" : name === "show_scene" ? "pedestal" : "pedestal", panels: name === "render_panel" ? "1" : name === "clear" ? "0" : "0" },
    );
    const image = path.join(outputDir, file);
    await page.screenshot({ path: image });
    results.push({ name, seq: payload.seq, delivered: payload.delivered, status: payload.status, image: file });
  }
  await client.close();
  await writeFile(path.join(outputDir, "result.json"), `${JSON.stringify({ ok: true, results }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, results })}\n`);
} catch (error) {
  await page.screenshot({ path: path.join(outputDir, "failure.png") }).catch(() => {});
  await writeFile(path.join(outputDir, "failure.log"), `${notes.join("\n")}\n${error.stack || error.message}\n`);
  process.stderr.write(`${error.stack || error.message}\n${error.cause ? `cause ${error.cause.stack || error.cause.message}\n` : ""}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await started.app.close();
}
