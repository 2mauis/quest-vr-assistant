import { test as base, expect } from "@playwright/test";
import { mcpCall, startTestApp } from "../helpers.js";

// Device switching and failed assets must not share relay state with other tests.
const test = base.extend({
  relay: async ({}, use) => {
    const started = await startTestApp({ ACK_WAIT_MS: "2000" });
    try { await use(started); } finally { await started.app.close(); }
  },
});

async function pair(page, relay) {
  await page.goto(`http://localhost:${relay.port}/`);
  await page.locator("#token").fill(relay.env.DEVICE_PAIRING_TOKEN);
  await page.locator("#connect").click();
  await expect(page.locator("#status")).toHaveText("显示中");
}

async function call(relay, name, args) {
  const { response, body } = await mcpCall(relay.tunnelPort, relay.env.MCP_BEARER_SECRET, name, args);
  expect(response.status).toBe(200);
  return body.result.structuredContent;
}

test("two devices switch once, and manual disconnect cancels a scheduled reconnect", async ({ page, context, relay }) => {
  let firstConnections = 0;
  page.on("websocket", () => { firstConnections += 1; });
  await pair(page, relay);
  const quest = await context.newPage();
  await pair(quest, relay);
  await expect(page.locator("#status")).toHaveText("已切换到另一设备");
  // The former implementation stole the socket back after at most 1.2 seconds.
  await page.waitForTimeout(1500);
  expect(firstConnections).toBe(1);
  await expect(quest.locator("body")).toHaveAttribute("data-connected", "1");

  await page.locator("#takeover").click();
  await expect(page.locator("#status")).toHaveText("显示中");
  await expect(quest.locator("#status")).toHaveText("已切换到另一设备");
  await page.evaluate(() => window.__display.disconnectForTest());
  await expect(page.locator("#status")).toHaveText("正在重连");
  await page.locator("#disconnect").click();
  await page.waitForTimeout(1500);
  expect(firstConnections).toBe(2);
  await expect(page.locator("#status")).toHaveText("未连接");
  await expect(page.locator("#takeover")).toBeHidden();
});

test("a reload rebuilds its empty canvas instead of reusing a stored sequence", async ({ page, relay }) => {
  await pair(page, relay);
  const shown = await call(relay, "show_scene", {
    request_id: "reload-scene", preset: "pedestal", anchor: "front",
  });
  expect(shown.delivered).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene", "pedestal");
  await page.evaluate((seq) => sessionStorage.setItem("vr-display-last-seq", String(seq)), shown.seq);
  await pair(page, relay);
  await expect(page.locator("body")).toHaveAttribute("data-scene", "pedestal");
  await expect(page.locator("body")).toHaveAttribute("data-seq", String(shown.seq));
});

test("selecting a panel reports its ID, not the current scene", async ({ page, relay }) => {
  await pair(page, relay);
  expect((await call(relay, "render_panel", {
    request_id: "select-panel", panel_id: "front-note", text: "Select this panel",
    anchor: "world", pose: { position: { x: 0, y: 1, z: 1 } },
  })).delivered).toBe(true);
  await page.locator("#view").click({ position: { x: 640, y: 360 } });
  await expect.poll(async () => {
    const response = await fetch(`http://localhost:${relay.port}/api/debug/interactions`);
    return (await response.json()).events.at(-1)?.target_id;
  }).toBe("front-note");
});

test("model commands are acknowledged only after loading and a rendered frame", async ({ page, relay }) => {
  let release;
  let started;
  const loading = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("https://assets.example.com/slow.gltf", async (route) => {
    started();
    await gate;
    await route.fulfill({ contentType: "model/gltf+json", body: JSON.stringify({
      asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{}],
    }) });
  });
  await pair(page, relay);
  let settled = false;
  const result = call(relay, "show_scene", {
    request_id: "slow-model", model_url: "https://assets.example.com/slow.gltf", anchor: "front",
  }).then((value) => { settled = true; return value; });
  await loading;
  await page.waitForTimeout(200);
  expect(settled).toBe(false);
  await expect(page.locator("body")).toHaveAttribute("data-scene", "");
  release();
  expect((await result).delivered).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene", "model");
  await expect(page.locator("body")).toHaveAttribute("data-seq", "1");
});

test("a failed model cannot be marked rendered by a later panel ACK", async ({ page, relay }) => {
  await page.route("https://assets.example.com/broken.gltf", (route) => route.fulfill({ status: 404, body: "missing" }));
  await pair(page, relay);
  const failed = call(relay, "show_scene", {
    request_id: "failed-model", model_url: "https://assets.example.com/broken.gltf", anchor: "front",
  });
  await expect(page.locator("#status")).toContainText("渲染失败");
  const panel = await call(relay, "render_panel", {
    request_id: "after-failure", panel_id: "later", text: "Must not skip the failed command",
  });
  expect(panel.delivered).toBe(false);
  expect((await failed).delivered).toBe(false);
  await expect(page.locator("body")).toHaveAttribute("data-panels", "0");
  await expect(page.locator("body")).toHaveAttribute("data-seq", "0");
  expect((await call(relay, "show_scene", {
    request_id: "failed-model", model_url: "https://assets.example.com/broken.gltf", anchor: "front",
  })).delivered).toBe(false);
});
