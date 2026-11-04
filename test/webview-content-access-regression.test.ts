import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

test("Quest WebView sources never enable content access", () => {
  const root = "apps/quest-app";
  const sources = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:java|kt)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
  assert.ok(sources.length > 0, "Android sources must be scanned");
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bsetAllowContentAccess\s*\(\s*true\s*\)/, file);
    assert.doesNotMatch(source, /\ballowContentAccess\s*=\s*true\b/, file);
  }
});
