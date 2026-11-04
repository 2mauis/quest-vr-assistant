// Never run automatically. user must initiate by voice; platform approval is required.
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { validateMerge, confirmGate, type MergeSnapshot } from "./workflow/logic.ts";
const [action, number, code] = process.argv.slice(2);
if (!number || !/^[1-9]\d*$/.test(number) || !["prepare", "confirm"].includes(action ?? ""))
  throw new Error("usage: merge-gate prepare N | confirm N CODE");
const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8" });
const snapshot = () =>
  JSON.parse(
    gh(["pr", "view", number, "--json", "headRefOid,state,isDraft,mergeStateStatus,statusCheckRollup"]),
  ) as MergeSnapshot;
// Session attestation is private, explicitly created after same-surface verification and review.
interface Attestation {
  repository: string;
  pr: number;
  sha: string;
  verifiedAt: number;
  surface: string;
  reportedSurface: string;
  voiceInitiatedBy: string;
  unresolvedP0P1: number;
  approvalMode: string;
}
const repository = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
const verified = JSON.parse(readFileSync(".debug-evidence/verified-pr.json", "utf8")) as Attestation;
if (
  verified.repository !== repository ||
  verified.pr !== Number(number) ||
  verified.voiceInitiatedBy !== "Jack" ||
  verified.unresolvedP0P1 !== 0 ||
  !verified.surface ||
  verified.surface !== verified.reportedSurface ||
  verified.approvalMode !== "ask-for-approval" ||
  !Number.isFinite(verified.verifiedAt) ||
  Date.now() - verified.verifiedAt > 3600_000 ||
  verified.verifiedAt > Date.now()
)
  throw new Error("missing current same-surface, voice-initiated verification / human approval configuration");
validateMerge(snapshot(), verified.sha);
const file = ".debug-evidence/merge-confirmation.json";
if (action === "prepare") {
  mkdirSync(".debug-evidence", { recursive: true, mode: 0o700 });
  const confirmation = {
    repository,
    pr: Number(number),
    sha: verified.sha,
    code: String(randomInt(1000, 10000)),
    expires: Date.now() + 120_000,
  };
  writeFileSync(file, JSON.stringify(confirmation), { mode: 0o600 });
  console.log(
    `PR ${number}; head ${verified.sha}; checks green; surface ${verified.surface}; confirmation ${confirmation.code}; expires in 120 seconds. Human platform approval still required.`,
  );
} else {
  const saved = JSON.parse(readFileSync(file, "utf8")) as {
    repository: string;
    pr: number;
    sha: string;
    code: string;
    expires: number;
  };
  unlinkSync(file); // one attempt, including incorrect codes
  if (saved.repository !== repository) throw new Error("Repository changed");
  confirmGate(saved, Number(number), code ?? "", verified.sha, Date.now());
  validateMerge(snapshot(), saved.sha);
  // The calling platform MUST intercept this operation for explicit human approval.
  gh(["pr", "merge", number, "--squash", "--match-head-commit", saved.sha]);
}
