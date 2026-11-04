import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
test("SARIF Markdown cells cannot inject table or HTML syntax", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "qva-sarif-"));
  try {
    const file = path.join(dir, "example.sarif");
    writeFileSync(
      file,
      JSON.stringify({
        runs: [{ tool: { driver: {} }, results: [{ ruleId: "example\\|<tag>`", message: { text: "example" } }] }],
      }),
    );
    const result = spawnSync(process.execPath, ["scripts/codeql-sarif-summary.ts", "--markdown", file], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.ok(!result.stdout.includes("\\|"));
    assert.ok(!result.stdout.includes("<tag>"));
    assert.match(result.stdout, /&#124;/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
