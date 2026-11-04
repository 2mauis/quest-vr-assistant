import assert from "node:assert/strict";
import test from "node:test";
import { captureOptions, privacyFindings, confirmGate, evidenceSections } from "../scripts/workflow/logic.ts";
test("capture bounds and eye geometry", () => {
  assert.throws(() => captureOptions(["0"]));
  assert.throws(() => captureOptions(["181"]));
  assert.throws(() => captureOptions(["10", "--eye", "invalid"]));
  assert.match(captureOptions(["10", "--eye", "right"]).filter, /iw\/2:0/);
  assert.equal(captureOptions(["10", "--source", "mqdh"]).filter, "fps=2");
});
test("privacy blocks synthetic PII without echoing it", () => {
  assert.deepEqual(privacyFindings("user@example.com localhost <PLACEHOLDER>"), []);
  for (const text of [
    "user@" + "private.invalid",
    [192, 168, 5, 6].join("."),
    "device" + ".internal",
    "hostname=" + "private-device",
    "ghp_" + "a".repeat(30),
    "::" + "1",
  ])
    assert.ok(privacyFindings(text).length);
  assert.deepEqual(privacyFindings("private phrase", ["private phrase"]), ["local denylist"]);
});
test("confirmation rejects wrong PR/code/head and timeout repeatedly", () => {
  const state = { pr: 4, sha: "abc", code: "1234", expires: 100, repository: "example" };
  for (let i = 0; i < 10; i++) {
    assert.throws(() => confirmGate(state, 5, "1234", "abc", 1));
    assert.throws(() => confirmGate(state, 4, "0000", "abc", 1));
    assert.throws(() => confirmGate(state, 4, "1234", "def", 1));
    assert.throws(() => confirmGate(state, 4, "1234", "abc", 100));
  }
  assert.doesNotThrow(() => confirmGate(state, 4, "1234", "abc", 1));
});
test("evidence headings require content", () => {
  assert.equal(evidenceSections("## Repro (before)\n\n## Verify (after)\n\n## 风险分级"), false);
  assert.equal(evidenceSections("## Repro (before)\nassertion\n## Verify (after)\npass\n## 风险分级\n低；桌面"), true);
});

test("merge snapshot rejects missing, failing or pending checks and changed heads", async () => {
  const { validateMerge } = await import("../scripts/workflow/logic.ts");
  const sha = "a".repeat(40);
  const pr = {
    headRefOid: sha,
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    statusCheckRollup: ["privacy-scan", "gitleaks", "bugfix-evidence", "Relay unit and browser checks"].map((name) => ({
      name,
      status: "COMPLETED",
      conclusion: "SUCCESS",
    })),
  };
  validateMerge(pr, sha);
  for (let i = 0; i < 10; i++) {
    assert.throws(() => validateMerge(pr, "b".repeat(40)));
    assert.throws(() => validateMerge({ ...pr, statusCheckRollup: [] }, sha));
    assert.throws(() =>
      validateMerge(
        {
          ...pr,
          statusCheckRollup: [...pr.statusCheckRollup, { name: "pending", status: "IN_PROGRESS", conclusion: "" }],
        },
        sha,
      ),
    );
    assert.throws(() => validateMerge({ ...pr, isDraft: true }, sha));
  }
});

test("merge checks fail closed for pending, missing privacy and changed head", async () => {
  const { validateMerge } = await import("../scripts/workflow/logic.ts");
  const sha = "a".repeat(40);
  const checks = ["privacy-scan", "gitleaks", "bugfix-evidence", "Relay unit and browser checks"].map((name) => ({
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
  }));
  const snapshot = {
    headRefOid: sha,
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    statusCheckRollup: checks,
  };
  assert.doesNotThrow(() => validateMerge(snapshot, sha));
  assert.throws(() => validateMerge(snapshot, "b".repeat(40)));
  assert.throws(() => validateMerge({ ...snapshot, statusCheckRollup: checks.slice(1) }, sha));
  assert.throws(() =>
    validateMerge(
      { ...snapshot, statusCheckRollup: [...checks, { name: "review", status: "PENDING", conclusion: "" }] },
      sha,
    ),
  );
});
