// Run only in disposable CI directories. PR code is untrusted; never provide credentials.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { evidenceSections } from "./workflow/logic.ts";
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as {
  pull_request?: {
    body: string | null;
    head: { ref: string; sha: string };
    base: { sha: string };
    labels: { name: string }[];
  };
};
const pr = event.pull_request;
if (!pr || (!pr.head.ref.startsWith("fix/") && !pr.labels.some((l) => l.name === "bugfix"))) {
  console.log("not a fix PR: skip");
  process.exit(0);
}
if (!evidenceSections(pr.body ?? "")) throw new Error("Missing nonempty evidence sections");
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const base = pr.base.sha;
const head = pr.head.sha;
const files = git(["diff", "--name-only", "--diff-filter=A", base, head, "--", "test/*.test.ts"])
  .split("\n")
  .filter(Boolean);
if (!files.length) throw new Error("add a standalone test/*.test.ts regression (hardware evidence is supplementary)");
const commits = git(["rev-list", "--reverse", `${base}..${head}`]).split("\n");
const repro = commits.find((sha) => {
  const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha]).split("\n").filter(Boolean);
  return (
    changed.length > 0 && changed.every((f) => /^test\/.*\.test\.ts$/.test(f)) && files.some((f) => changed.includes(f))
  );
});
if (!repro || repro === head) throw new Error("a test-only reproduction commit must precede the fix");
const temp = mkdtempSync(path.join(tmpdir(), "qva-red-green-"));
try {
  for (const [name, revision, expectPass] of [
    ["base", base, false],
    ["repro", repro, false],
    ["head", head, true],
  ] as const) {
    const dir = path.join(temp, name);
    mkdirSync(dir);
    const archive = execFileSync("git", ["archive", revision]);
    execFileSync("tar", ["-x", "-C", dir], { input: archive });
    // Overlay only added regression files; production code always comes from the selected revision.
    for (const file of files) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      cpSync(file, path.join(dir, file));
    }
    execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: dir, stdio: "inherit" });
    execFileSync("npm", ["run", "build:display"], {
      cwd: dir,
      stdio: "inherit",
      env: { ...process.env, DISPLAY_BUILD_SHA: revision.slice(0, 12) },
    });
    const result = spawnSync(process.execPath, ["--test", ...files], { cwd: dir, encoding: "utf8" });
    const output = `${result.stdout}${result.stderr}`;
    if (!expectPass && !/ERR_ASSERTION|AssertionError/.test(output))
      throw new Error("Base/repro must fail an assertion");
    if (
      result.error ||
      result.signal ||
      /ERR_MODULE_NOT_FOUND|SyntaxError|Cannot find/.test(output) ||
      !/\btests [1-9]/.test(output)
    )
      throw new Error(`${name}: invalid reproduction run`);
    if ((result.status === 0) !== expectPass) throw new Error(`${name}: expected ${expectPass ? "green" : "red"}`);
    console.log(`${name}: expected result confirmed`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
