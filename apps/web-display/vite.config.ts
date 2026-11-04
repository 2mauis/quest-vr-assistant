import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

const build = {
  build_id:
    process.env.DISPLAY_BUILD_SHA ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
  built_at: new Date().toISOString(),
};

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify(build) },
  root,
  base: "/",
  plugins: [
    react(),
    {
      name: "build-info",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "build-info.json", source: JSON.stringify(build) });
      },
    },
  ],
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    modulePreload: false,
    assetsInlineLimit: 0,
  },
});
