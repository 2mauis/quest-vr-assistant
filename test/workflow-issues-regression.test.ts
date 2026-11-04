import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureOptions, validateMerge, type MergeSnapshot } from "../scripts/workflow/logic.ts";
const root = path.resolve(import.meta.dirname, "..");
function temporary(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "qva-regression-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("merge allows neutral/skipped and legacy success, required checks stay strict", () => {
  const sha = "a".repeat(40);
  const required = ["privacy-scan", "gitleaks", "bugfix-evidence", "Relay unit and browser checks"].map((name) => ({
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
  }));
  const snapshot: MergeSnapshot = {
    headRefOid: sha,
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    statusCheckRollup: required,
  };
  for (const check of [
    { status: "COMPLETED", conclusion: "SKIPPED" },
    { status: "COMPLETED", conclusion: "NEUTRAL" },
    { state: "SUCCESS" },
  ]) {
    assert.doesNotThrow(() => validateMerge({ ...snapshot, statusCheckRollup: [...required, check] }, sha));
  }
  for (const check of [
    { state: "PENDING" },
    { state: "FAILURE" },
    { status: "IN_PROGRESS", conclusion: "NEUTRAL" },
    {},
  ]) {
    assert.throws(() => validateMerge({ ...snapshot, statusCheckRollup: [...required, check] }, sha));
  }
  for (const conclusion of ["SKIPPED", "NEUTRAL"]) {
    assert.throws(() =>
      validateMerge({ ...snapshot, statusCheckRollup: required.map((c) => ({ ...c, conclusion })) }, sha),
    );
  }
});
test("privacy CLI rejects unknown/missing/extra args with usage and code 2", () => {
  for (const args of [
    ["--unknown"],
    ["--file"],
    ["--diff"],
    ["--stdin", "extra"],
    ["--file", "unused", "extra"],
    ["--diff", "HEAD", "extra"],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/privacy-scan.ts", ...args], {
      cwd: root,
      input: "",
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:.*--stdin/);
  }
});
test("new branch push scans merge base, existing branch scans remote, missing main scans files", () =>
  temporary((dir) => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "test@example.com");
    writeFileSync(path.join(dir, "tracked.txt"), "base\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", base);
    writeFileSync(path.join(dir, "tracked.txt"), "next\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "next");
    const local = git("rev-parse", "HEAD");
    mkdirSync(path.join(dir, "bin"));
    writeFileSync(path.join(dir, "bin/node"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SCAN_CALLS"\n', { mode: 0o755 });
    const calls = path.join(dir, "calls");
    const push = (remote: string) => {
      writeFileSync(calls, "");
      const result = spawnSync("sh", [path.join(root, ".githooks/pre-push")], {
        cwd: dir,
        input: `refs/heads/fix/example ${local} refs/heads/fix/example ${remote}\n`,
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, SCAN_CALLS: calls },
      });
      assert.equal(result.status, 0, result.stderr);
      return readFileSync(calls, "utf8");
    };
    assert.equal(push("0".repeat(40)), `scripts/privacy-scan.ts --diff ${base}\n`);
    assert.equal(push(base), `scripts/privacy-scan.ts --diff ${base}\n`);
    git("update-ref", "-d", "refs/remotes/origin/main");
    assert.equal(push("0".repeat(40)), "scripts/privacy-scan.ts --file tracked.txt\n");
  }));
test("mqdh rejects any explicit eye and CLI reports usage code", () => {
  for (const eye of ["both", "left", "right"])
    assert.throws(() => captureOptions(["10", "--source", "mqdh", "--eye", eye]));
  const result = spawnSync(process.execPath, ["scripts/quest-capture.ts", "10", "--source", "mqdh", "--eye", "left"], {
    cwd: root,
  });
  assert.equal(result.status, 2);
});
// Instrument process boundaries, never invoke real capture tools or devices.
function captureFixture(dir: string, mode: string) {
  const preload = path.join(dir, "mock.mjs");
  writeFileSync(
    preload,
    `import cp from 'node:child_process'; import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const mode = ${JSON.stringify(mode)};
cp.execFileSync = (cmd, args) => { if(args[0] === '-version') return ''; if(args[1] === 'screenrecord') throw new Error('original capture failure'); if(args[1] === 'rm') throw new Error('cleanup failure'); return ''; };
cp.spawn = () => ({on(){}, kill(){}});
if(mode === 'empty') {const open = fs.openSync; fs.openSync = (...args) => {if(String(args[0]).endsWith('logcat.txt')) throw new Error('open failure'); return open(...args);};}
if(mode === 'retained') { const open = fs.openSync; fs.openSync = (...args) => {if(String(args[0]).endsWith('logcat.txt')) fs.writeFileSync(args[0] + '.retained', 'evidence'); return open(...args);}; }
syncBuiltinESMExports();`,
  );
  return spawnSync(process.execPath, ["--import", preload, path.join(root, "scripts/quest-capture.ts"), "1"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, QUEST_RELAY_LOG: "" },
  });
}
test("capture preserves original and cleanup errors", () =>
  temporary((dir) => {
    const result = captureFixture(dir, "retained");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Error: original capture failure/);
    assert.match(result.stderr, /Error: cleanup failure/);
    assert.ok(readdirSync(path.join(dir, ".debug-evidence")).length);
  }));
test("capture removes empty evidence directory on setup failure", () =>
  temporary((dir) => {
    const result = captureFixture(dir, "empty");
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(path.join(dir, ".debug-evidence")), []);
  }));
test("doctor uses relay PORT for health request", () =>
  temporary((dir) => {
    const preload = path.join(dir, "doctor.mjs");
    writeFileSync(
      preload,
      `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; cp.execFileSync = () => 'ready'; syncBuiltinESMExports(); globalThis.fetch = async url => { console.log('REQUEST ' + url); return {ok:true, json:async () => ({ready:true})}; };`,
    );
    const result = spawnSync(process.execPath, ["--import", preload, path.join(root, "scripts/doctor.ts")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PORT: "45678", QUEST_RELAY_URL: "" },
    });
    // Unset override rather than supplying an invalid empty URL.
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: "45678" };
    delete env.QUEST_RELAY_URL;
    const actual = spawnSync(process.execPath, ["--import", preload, path.join(root, "scripts/doctor.ts")], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    assert.ok(result.status !== null);
    assert.match(actual.stdout, /REQUEST http:\/\/localhost:45678\/healthz/);
  }));
