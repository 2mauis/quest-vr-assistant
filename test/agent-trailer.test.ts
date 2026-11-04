import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkAgentTrailer } from "../scripts/workflow/logic.ts";

const email = "test@" + "users.noreply.github.com";
const valid = {
  message: "Change\n\nCo-authored-by: Codex <noreply@openai.com>\nAgent: codex\n",
  authorName: "Codex (for 2mauis)",
  authorEmail: email,
};
test("agent trailer validates identities, count, values and trailer placement", () => {
  assert.deepEqual(checkAgentTrailer(valid), []);
  assert.deepEqual(checkAgentTrailer({ ...valid, message: "Change" }), ["trailer-count"]);
  assert.deepEqual(checkAgentTrailer({ ...valid, message: "Change\n\nAgent: unknown" }), ["trailer-value"]);
  assert.deepEqual(checkAgentTrailer({ ...valid, authorName: "Other" }), ["author-name"]);
  assert.deepEqual(checkAgentTrailer({ ...valid, authorEmail: "test@example.com" }), ["author-email"]);
  assert.deepEqual(checkAgentTrailer({ ...valid, message: "Change\n\nAgent: human", authorName: "Other" }), []);
  assert.deepEqual(
    checkAgentTrailer({ ...valid, message: "Change\n\nAgent: human", authorEmail: "test@example.com" }),
    ["author-email"],
  );
  assert.deepEqual(checkAgentTrailer({ message: valid.message }), []);
  assert.deepEqual(checkAgentTrailer({ ...valid, message: valid.message + "Agent: codex\n" }), ["trailer-count"]);
  assert.deepEqual(checkAgentTrailer({ ...valid, message: valid.message + "\nBody" }), [
    "trailer-position",
    "coauthor-missing",
  ]);
  for (const [agent, authorName] of [
    ["claude-code", "Claude Code (for 2mauis)"],
    ["grok-friday", "Grok Bot Friday (for 2mauis)"],
  ])
    assert.deepEqual(
      checkAgentTrailer({
        ...valid,
        message: `Change\n\nCo-authored-by: Claude <noreply@anthropic.com>\nAgent: ${agent}`,
        authorName,
      }),
      [],
    );
});

test("agent coauthors must match the agent in the final trailer block", () => {
  for (const [agent, identity] of [
    ["codex", "Codex <noreply@openai.com>"],
    ["claude-code", "Claude <noreply@anthropic.com>"],
  ]) {
    const check = (message: string) => checkAgentTrailer({ message });
    assert.deepEqual(check(`Change\n\nAgent: ${agent}`), ["coauthor-missing"]);
    for (const key of ["Co-authored-by", "Co-Authored-By", "co-authored-by"])
      assert.deepEqual(check(`Change\n\nAgent: ${agent}\n${key}: ${identity}`), []);
    assert.deepEqual(check(`Change\n\nCo-authored-by: Other <test@example.com>\nAgent: ${agent}`), [
      "coauthor-missing",
    ]);
    assert.deepEqual(check(`Change\n\nCo-authored-by: ${identity}\n\nAgent: ${agent}`), ["coauthor-missing"]);
    assert.deepEqual(check(`Change\n\nCo-authored-by: ${identity} extra\nAgent: ${agent}`), ["coauthor-missing"]);
  }
  for (const agent of ["grok-friday", "human"])
    assert.deepEqual(checkAgentTrailer({ message: `Change\n\nAgent: ${agent}` }), []);
});

test("range checks committer cutoff inclusively, skips merges, supports override and redacts errors", () => {
  const cwd = mkdtempSync(join(tmpdir(), "agent-trailer-"));
  const script = resolve("scripts/agent-trailer.ts");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: valid.authorName,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: valid.authorName,
    GIT_COMMITTER_EMAIL: email,
  };
  delete env.AGENT_TRAILER_SINCE;
  const git = (...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  const commit = (date: string, message: string, parents: string[] = []) =>
    execFileSync("git", ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p])], {
      cwd,
      env: { ...env, GIT_AUTHOR_DATE: "2026-11-03T00:00:00Z", GIT_COMMITTER_DATE: date },
      input: message,
      encoding: "utf8",
    }).trim();
  const run = (base: string, head: string, extra = {}) =>
    spawnSync(process.execPath, [script, "--range", `${base}..${head}`], {
      cwd,
      env: { ...env, ...extra },
      encoding: "utf8",
    });
  let tree: string;
  try {
    git("init", "--quiet");
    tree = execFileSync("git", ["mktree"], { cwd, input: "", encoding: "utf8" }).trim();
    const base = commit("2026-11-03T00:00:00Z", "Base");
    const old = commit("2026-11-04T05:59:59Z", "Old without trailer", [base]);
    assert.equal(run(base, old).status, 0);
    const bad = commit("2026-11-04T06:00:00Z", "Private body without trailer", [old]);
    const result = run(base, bad);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), `${bad.slice(0, 12)} trailer-count`);
    assert.equal(result.stdout, "");
    assert.equal(run(base, bad, { AGENT_TRAILER_SINCE: "2026-11-05T00:00:00Z" }).status, 0);
    assert.equal(run(base, bad, { AGENT_TRAILER_SINCE: "invalid" }).status, 1);
    const missingCoauthor = commit("2026-11-04T06:00:00Z", "Change\n\nAgent: codex", [old]);
    assert.equal(run(base, missingCoauthor).status, 1);
    assert.equal(run(base, missingCoauthor).stderr.trim(), `${missingCoauthor.slice(0, 12)} coauthor-missing`);
    const oldAgent = commit("2026-11-04T05:59:59Z", "Change\n\nAgent: codex", [base]);
    assert.equal(run(base, oldAgent).status, 0);
    const good = commit("2026-11-04T06:00:01Z", valid.message, [old]);
    assert.equal(run(base, good).status, 0);
    const merge = commit("2026-11-04T06:00:02Z", "Merge without trailer", [good, old]);
    assert.equal(run(base, merge).status, 0);
    const file = join(cwd, "message");
    writeFileSync(file, "Change\n\nAgent: codex");
    const missing = spawnSync(process.execPath, [script, "--message-file", file], { cwd, env, encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.equal(missing.stderr.trim(), "HEAD coauthor-missing");
    writeFileSync(file, valid.message);
    assert.equal(spawnSync(process.execPath, [script, "--message-file", file], { cwd, env }).status, 0);
    assert.equal(
      spawnSync(process.execPath, [script, "--message-file", file], { cwd, env: { ...env, GIT_AUTHOR_NAME: "Other" } })
        .status,
      1,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
