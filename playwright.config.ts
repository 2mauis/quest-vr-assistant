import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  globalSetup: "./test/e2e/global-setup.ts",
  use: {
    viewport: { width: 1280, height: 720 },
    headless: true,
    trace: process.env.BUGFIX_TRACE ? "on" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
});
