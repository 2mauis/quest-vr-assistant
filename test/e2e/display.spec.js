import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

function state() {
  return JSON.parse(process.env.VR_MCP_E2E_STATE);
}

async function tool(name, args, id) {
  const current = state();
  const response = await fetch(`http://localhost:${current.tunnelPort}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${current.bearer}`,
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
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "0.1.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  const body = await response.json();
  return { status: response.status, payload: body.result?.structuredContent, isError: body.result?.isError };
}

async function sample(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#view");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let orange = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (red > 140 && green > 30 && green < 190 && blue < 100) orange += 1;
    }
    return {
      orange,
      scene: document.body.dataset.scene || "",
      panels: document.body.dataset.panels || "0",
      connected: document.body.dataset.connected || "0",
    };
  });
}

test("display renders show_scene, replays a panel, then clears", async ({ page }, testInfo) => {
  const notes = [];
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

  const shown = await tool("show_scene", {
    request_id: "e2e-scene",
    preset: "pedestal",
    anchor: "front",
  }, 1);
  expect(shown.status).toBe(200);
  expect(shown.payload.delivered).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene", "pedestal");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterScene = await sample(page);
  await page.screenshot({ path: scenePath });
  expect(afterScene.orange).toBeGreaterThan(before.orange);

  await page.evaluate(() => window.__display.disconnectForTest());
  await expect(page.locator("body")).toHaveAttribute("data-connected", "0");
  const missed = await tool("render_panel", {
    request_id: "e2e-panel",
    panel_id: "info",
    title: "Note",
    text: "Hello display",
    anchor: "right",
  }, 2);
  expect(missed.payload.status).toBe("queued");
  expect(missed.payload.delivered).toBe(false);
  await expect(page.locator("body")).toHaveAttribute("data-panels", "1", { timeout: 8000 });
  await page.screenshot({ path: replayPath });

  const cleared = await tool("clear", { request_id: "e2e-clear", scope: "all" }, 3);
  expect(cleared.payload.delivered).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene", "");
  await expect(page.locator("body")).toHaveAttribute("data-panels", "0");
  await page.screenshot({ path: clearPath });

  const beforeHash = createHash("sha256").update(readFileSync(beforePath)).digest("hex");
  const sceneHash = createHash("sha256").update(readFileSync(scenePath)).digest("hex");
  const clearHash = createHash("sha256").update(readFileSync(clearPath)).digest("hex");
  expect(sceneHash).not.toBe(beforeHash);
  expect(clearHash).not.toBe(sceneHash);
  writeFileSync(testInfo.outputPath("e2e.log"), `${notes.join("\n")}\nscene_orange=${afterScene.orange}\n`);
});
