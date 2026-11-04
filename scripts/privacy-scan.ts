import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { privacyFindings } from "./workflow/logic.ts";
const args = process.argv.slice(2);
if (!(
  args.length === 0 ||
  (args.length === 1 && args[0] === "--stdin") ||
  (args.length === 2 && ["--file", "--diff"].includes(args[0] ?? "") && args[1] && !args[1].startsWith("--"))
)) {
  console.error("usage: privacy-scan [--file FILE | --diff BASE | --stdin]");
  process.exit(2);
}
let text: string;
if (args[0] === "--file" && args[1]) text = readFileSync(args[1], "utf8");
else if (args[0] === "--stdin") text = readFileSync(0, "utf8");
else if (args[0] === "--diff" && args[1])
  text = execFileSync(
    "git",
    ["diff", "--no-ext-diff", "--unified=0", args[1], "--", ".", ":(glob,exclude)**/package-lock.json"],
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
else if (!args.length)
  text = execFileSync("git", ["diff", "HEAD", "--no-ext-diff", "--unified=0"], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
else throw new Error("unreachable argument mode");
if (!args.length) {
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  for (const file of untracked) {
    const data = readFileSync(file);
    if (!data.includes(0)) text += "\n" + data.toString("utf8");
  }
}
const words = process.env.PRIVACY_WORDLIST ? readFileSync(process.env.PRIVACY_WORDLIST, "utf8").split("\n") : [];
const findings = privacyFindings(text, words);
console.log(
  findings.length
    ? `BLOCKED: ${[...new Set(findings)].join(", ")} (content redacted)`
    : "privacy-scan passed; manually inspect images and unstructured PII",
);
if (findings.length) process.exitCode = 1;
