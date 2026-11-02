import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "/",
  plugins: [react()],
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    modulePreload: false,
    assetsInlineLimit: 0,
  },
});
