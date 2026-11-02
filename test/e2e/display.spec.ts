import type {} from "../../apps/web-display/src/display-hooks.ts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { mcpCall } from "../helpers.ts";
import type { E2eState } from "./global-setup.ts";

function state(): E2eState {
  const raw = process.env.VR_MCP_E2E_STATE;
  if (!raw) throw new Error("global setup did not run");
  return JSON.parse(raw) as E2eState;
}

async function tool(name: string, args: Record<string, unknown>, id: number) {
  const current = state();
  const { response, body } = await mcpCall(current.tunnelPort, current.bearer, name, args, id);
  return { status: response.status, payload: body.result?.structuredContent, isError: body.result?.isError };
}

async function sample(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#view");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    if (!canvas || !gl) throw new Error("no WebGL canvas");
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let orange = 0;
    for (let index = 0; index + 2 < pixels.length; index += 16) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      if (red > 140 && green > 30 && green < 190 && blue < 100) orange += 1;
    }
    return { orange, scene: document.body.dataset.scene ?? "" };
  });
}

const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

test("display renders show_scene, replays a panel, then clears", async ({ page }, testInfo) => {
  const notes: string[] = [];
  page.on("pageerror", (error) => notes.push(`pageerror ${error.message}`));
  page.on("console", (message) => notes.push(`console ${message.type()} ${message.text()}`));
  const current = state();
  const beforePath = testInfo.outputPath("01-before.png");
  const scenePath = testInfo.outputPath("02-after-show-scene.png");
  const replayPath = testInfo.outputPath("03-after-replay-panel.png");
  const clearPath = testInfo.outputPath("04-after-clear.png");
  await page.goto(`http://localhost:${current.port}/`);
  await page.locator("#token").fill(current.pairing);
  await page.locator("#connect").click();
  await expect(page.locator("body")).toHaveAttribute("data-connected", "1", { timeout: 5000 });
  await expect(page.locator("#view")).toBeVisible();

  const before = await sample(page);
  await page.screenshot({ path: beforePath });
  expect(before.scene).toBe("");
  expect(before.orange).toBe(0);

  const shown = await tool("show_scene", { request_id: "e2e-scene", preset: "pedestal", anchor: "front" }, 1);
  expect(shown.status).toBe(200);
  expect(shown.payload.delivered).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene", "pedestal");
  const afterScene = await sample(page);
  await page.screenshot({ path: scenePath });
  expect(afterScene.orange).toBeGreaterThan(before.orange);

  await page.evaluate(() => window.__display?.disconnectForTest());
  await expect(page.locator("body")).toHaveAttribute("data-connected", "0");
  const missed = await tool(
    "render_panel",
    { request_id: "e2e-panel", panel_id: "info", title: "Note", text: "Hello display", anchor: "right" },
    2,
  );
  expect(missed.payload.status).toBe("queued");
  expect(missed.payload.delivered).toBe(false);
  await expect(page.locator("body")).toHaveAttribute("data-panels", "1", { timeout: 8000 });
  await expect(page.locator("body")).toHaveAttribute("data-seq", "2", { timeout: 8000 });
  await page.screenshot({ path: replayPath });

  const cleared = await tool("clear", { request_id: "e2e-clear", scope: "all" }, 3);
  expect(cleared.payload.delivered).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene", "");
  await expect(page.locator("body")).toHaveAttribute("data-panels", "0");
  await page.screenshot({ path: clearPath });

  expect(digest(scenePath)).not.toBe(digest(beforePath));
  expect(digest(clearPath)).not.toBe(digest(scenePath));
  expect(notes.filter((note) => note.startsWith("pageerror"))).toEqual([]);
  writeFileSync(testInfo.outputPath("e2e.log"), `${notes.join("\n")}\nscene_orange=${afterScene.orange}\n`);
});
