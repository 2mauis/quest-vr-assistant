import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  globalSetup: "./test/e2e/global-setup.js",
  globalTeardown: "./test/e2e/global-teardown.js",
  use: {
    viewport: { width: 1280, height: 720 },
    headless: true,
  },
  reporter: [["list"]],
});
