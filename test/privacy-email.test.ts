import assert from "node:assert/strict";
import test from "node:test";
import { privacyFindings } from "../scripts/workflow/logic.ts";

test("privacy allows exactly the two public vendor attribution emails", () => {
  for (const email of ["noreply@anthropic.com", "noreply@openai.com"]) {
    assert.deepEqual(privacyFindings(`Co-authored-by: Agent <${email}>`), []);
  }
});

test("privacy blocks other emails and lookalikes even alongside allowed emails", () => {
  const blocked = [
    ["user", "anthropic.com"],
    ["user", "openai.com"],
    ["user", "users.noreply.github.com"],
    ["user", "github.com"],
    ["prefix-noreply", "openai.com"],
    ["noreply+tag", "anthropic.com"],
    ["noreply", "openai.com.evil.com"],
    ["noreply", "anthropic.com-extra.com"],
    ["noreply", "sub.openai.com"],
    ["NOREPLY", "openai.com"],
  ].map((parts) => parts.join("@"));
  for (const email of blocked) {
    assert.deepEqual(privacyFindings(email), ["email"]);
    assert.deepEqual(privacyFindings(`noreply@anthropic.com ${email} noreply@openai.com`), ["email"]);
  }
});
