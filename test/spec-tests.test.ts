import assert from "node:assert/strict";
import test from "node:test";
import { checkSpecTests } from "../scripts/check-spec-tests.ts";

test("spec changed without tests fails", () => {
  assert.equal(checkSpecTests(["docs/specs/pairing.md"]), false);
});

test("spec changed with unit or browser tests passes", () => {
  for (const file of ["test/pairing.test.ts", "test/e2e/pairing.spec.ts"])
    assert.equal(checkSpecTests(["docs/specs/pairing.md", file]), true);
});

test("only spec TEMPLATE and README changed passes", () => {
  assert.equal(checkSpecTests(["docs/specs/TEMPLATE.md", "docs/specs/README.md"]), true);
});

test("no spec changed passes", () => {
  assert.equal(checkSpecTests([]), true);
  assert.equal(checkSpecTests(["services/relay/src/app.ts", "docs/workflow-v2.md"]), true);
});

test("deleted specs do not require tests and deleted tests still count as touched", () => {
  assert.equal(checkSpecTests(["docs/specs/old.md"], []), true);
  assert.equal(checkSpecTests(["docs/specs/new.md", "test/old.test.ts"], ["docs/specs/new.md"]), true);
});

test("fixtures, helpers and similarly named paths do not count as test cases", () => {
  for (const file of [
    "test/helpers.ts",
    "test/fixtures/data.json",
    "docs/test/example.test.ts",
    "test/example.test.ts.md",
  ])
    assert.equal(checkSpecTests(["docs/specs/pairing.md", file]), false);
});
