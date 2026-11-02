import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const SOURCE_PATHS = ["apps/web-display", "apps/quest-app", "services", "shared", "scripts", "test"];
// Build outputs and caches that are meant to stay out of Git.
const GENERATED = /(^|\/)(node_modules|dist|build|test-results|\.gradle|\.kotlin)\//;

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

// A broad ignore rule (for example `state/` for local runtime state) once hid a
// source module: every local check passed while the pushed tree did not build.
test("no source file is hidden by an ignore rule", (t) => {
  const listing = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--", ...SOURCE_PATHS]);
  if (listing === null) {
    t.skip("not a Git checkout");
    return;
  }
  const hidden = listing
    .split("\n")
    .filter((file) => file && !GENERATED.test(file))
    .filter((file) => /\.(ts|tsx|js|mjs|kt|kts|java|json|html|css|py|sh)$/.test(file));
  assert.deepEqual(hidden, []);
});
