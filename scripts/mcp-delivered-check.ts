// Acceptance check: a local relay, a headless display page and the official MCP
// client. Each tool must come back with delivered: true and the page must show it.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { startTestApp } from "../test/helpers.ts";
import { callTool, connectMcp, runId, type ToolCallRecord } from "./mcp-client.ts";

const outputDir = process.env.QVR_CHECK_DIR || "test-results/mcp-delivered";
const started = await startTestApp({ ACK_WAIT_MS: "8000" });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const notes: string[] = [];
page.on("pageerror", (error) => notes.push(`pageerror ${error.message}`));
await mkdir(outputDir, { recursive: true });

interface Step {
  name: string;
  args: Record<string, unknown>;
  /** Body attributes the page must show afterwards. */
  expect: { scene: string; panels: string };
  image: string;
}

const id = runId();
const steps: Step[] = [
  {
    name: "show_scene",
    args: { request_id: `check-scene-${id}`, preset: "pedestal", anchor: "front" },
    expect: { scene: "pedestal", panels: "0" },
    image: "01-scene.png",
  },
  {
    name: "render_panel",
    args: {
      request_id: `check-panel-${id}`,
      panel_id: "info",
      title: "Note",
      text: "Hello display",
      anchor: "right",
    },
    expect: { scene: "pedestal", panels: "1" },
    image: "02-panel.png",
  },
  {
    name: "clear",
    args: { request_id: `check-clear-${id}`, scope: "all" },
    expect: { scene: "", panels: "0" },
    image: "03-clear.png",
  },
];

try {
  await page.goto(`http://localhost:${started.port}/`);
  await page.locator("#token").fill(started.env.DEVICE_PAIRING_TOKEN);
  await page.locator("#connect").click();
  await page.waitForSelector('body[data-connected="1"]');
  const client = await connectMcp(
    new URL(`http://localhost:${started.tunnelPort}/mcp`),
    started.env.MCP_BEARER_SECRET,
    "display-check",
  );
  const results: (ToolCallRecord & { image: string; page_seq: string | null })[] = [];
  try {
    for (const step of steps) {
      const result = await callTool(client, step.name, step.args);
      if (result.isError || !result.delivered) {
        throw new Error(
          `${step.name} delivered=${result.delivered} status=${result.status} error=${result.error_code}`,
        );
      }
      await page.waitForSelector(`body[data-scene="${step.expect.scene}"][data-panels="${step.expect.panels}"]`);
      await page.screenshot({ path: path.join(outputDir, step.image) });
      const pageSeq = await page.locator("body").getAttribute("data-seq");
      results.push({ ...result, image: step.image, page_seq: pageSeq });
    }
  } finally {
    await client.close();
  }
  const report = { ok: true, protocol: "2026-07-28", results };
  await writeFile(path.join(outputDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await page.screenshot({ path: path.join(outputDir, "failure.png") }).catch(() => {});
  await writeFile(path.join(outputDir, "failure.log"), `${notes.join("\n")}\n${message}\n`);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await started.app.close();
}
