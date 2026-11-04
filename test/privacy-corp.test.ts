import assert from "node:assert/strict";
import test from "node:test";
import { privacyFindings } from "../scripts/workflow/logic.ts";

test("privacy scan flags .corp internal domains (issue #9)", () => {
  assert.ok(privacyFindings("build.example.corp").includes("internal domain"));
});
