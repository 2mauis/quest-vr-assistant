import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkAgentTrailer } from "./workflow/logic.ts";

export const AGENT_TRAILER_SINCE = "2026-11-04T14:00:00+08:00";
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
function report(sha: string, errors: string[]) {
  for (const error of errors) console.error(`${sha} ${error}`);
  if (errors.length) process.exitCode = 1;
}

try {
  const [mode, value, ...rest] = process.argv.slice(2);
  if (!value || rest.length) throw new Error("arguments");
  if (mode === "--message-file") {
    let authorName = process.env.GIT_AUTHOR_NAME;
    let authorEmail = process.env.GIT_AUTHOR_EMAIL;
    try {
      const ident = /^(.*) <([^<>]*)> \d+ [+-]\d+$/.exec(git("var", "GIT_AUTHOR_IDENT"));
      authorName ??= ident?.[1];
      authorEmail ??= ident?.[2];
    } catch {
      // A message can still be checked when Git has no author identity configured.
    }
    report("HEAD", checkAgentTrailer({ message: readFileSync(value, "utf8"), authorName, authorEmail }));
  } else if (mode === "--range") {
    const since = Date.parse(process.env.AGENT_TRAILER_SINCE ?? AGENT_TRAILER_SINCE);
    if (!Number.isFinite(since) || !/^[^\s]+(?<!\.)\.\.(?!\.)[^\s]+$/.test(value) || value.startsWith("-"))
      throw new Error("range");
    const commits = git("rev-list", "--no-merges", value, "--").split("\n").filter(Boolean);
    for (const sha of commits) {
      const [date = "", authorName, authorEmail, message = ""] = git(
        "show",
        "-s",
        "--format=%cI%x00%an%x00%ae%x00%B",
        sha,
      ).split("\0");
      if (Date.parse(date) < since) continue;
      report(sha.slice(0, 12), checkAgentTrailer({ message, authorName, authorEmail }));
    }
  } else throw new Error("arguments");
} catch {
  report("HEAD", ["check-failed"]);
}
