import assert from "node:assert/strict";
import test from "node:test";
import { privacyFindings } from "../scripts/workflow/logic.ts";

test("privacy scan allows reserved/public hosts and type annotations", () => {
  assert.deepEqual(
    privacyFindings(
      "https://user@display.example.com/ hostname: mcp.example.com hostname: string https://github.com/x https://mcp.example.com.",
    ),
    [],
  );
});

test("privacy scan still flags private hosts", () => {
  assert.ok(privacyFindings("see https:" + "//nas.private-box.example.io/").includes("hostname"));
  assert.ok(privacyFindings("hostname: " + "my-mbp").includes("hostname assignment"));
});
