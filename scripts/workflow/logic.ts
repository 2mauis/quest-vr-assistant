export function captureOptions(args: string[]) {
  const seconds = Number(args[0]);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 180) throw new Error("seconds must be 1–180");
  let source = "adb";
  let eye = "both";
  for (let i = 1; i < args.length; i += 2) {
    const value = args[i + 1];
    if (args[i] === "--source" && (value === "adb" || value === "mqdh")) source = value;
    else if (args[i] === "--eye" && (value === "left" || value === "right" || value === "both")) eye = value;
    else throw new Error("invalid capture option");
  }
  return {
    seconds,
    source,
    eye,
    filter: source === "mqdh" || eye === "both" ? "fps=2" : `crop=iw/2:ih:${eye === "left" ? "0" : "iw/2"}:0,fps=2`,
  };
}

export function privacyFindings(text: string, words: string[] = []): string[] {
  const allowedEmails = new Set(["noreply@anthropic.com", "noreply@openai.com"]);
  const emails = [...text.matchAll(/\b[\w.+-]+@(?![\w.-]*example\.com\b)[\w.-]+\.[a-z]{2,}\b/gi)];
  const rules: [string, RegExp][] = [
    ["IPv4", /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
    ["IPv6", /(?:\b[\da-f]{1,4}:){2,}[\da-f:]*|::[\da-f]{1,4}\b/i],
    ["internal domain", /\b[\w-]+(?:\.[\w-]+)*\.(?:local|internal|lan|home|localdomain|ts\.net)\b/i],
    ["secret", /\b(?:gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{16,}|sk-[a-z0-9]{16,})/i],
  ];
  // Public documentation/source hosts and RFC 2606 reserved names are not personal data.
  const publicHosts = new Set([
    "github.com",
    "docs.github.com",
    "raw.githubusercontent.com",
    "www.unicode.org",
    "scripts.sil.org",
    "temporary.trycloudflare.com",
  ]);
  const allowedHost = (host: string) =>
    host === "localhost" || publicHosts.has(host) || /(?:^|\.)example\.(?:com|net|org)$/.test(host);
  const urlHosts = [...text.matchAll(/\b(?:https?|wss?):\/\/(?:[^\s/@]*@)?([\w.-]+)/gi)].map((m) =>
    (m[1] ?? "").toLowerCase().replace(/\.+$/, ""),
  );
  const assignedHosts = [...text.matchAll(/\bhostname\s*[:=]\s*["']?([\w.-]+)/gi)].map((m) =>
    (m[1] ?? "").toLowerCase(),
  );
  return [
    ...(emails.some(([email]) => !allowedEmails.has(email)) ? ["email"] : []),
    ...rules.filter(([, rule]) => rule.test(text)).map(([name]) => name),
    ...(urlHosts.some((host) => !allowedHost(host)) ? ["hostname"] : []),
    ...(assignedHosts.some((host) => host !== "string" && !allowedHost(host)) ? ["hostname assignment"] : []),
    ...words.filter((w) => w.trim() && text.toLowerCase().includes(w.toLowerCase())).map(() => "local denylist"),
  ];
}

export interface MergeSnapshot {
  headRefOid: string;
  state: string;
  isDraft: boolean;
  mergeStateStatus: string;
  statusCheckRollup: { name?: string; status?: string; conclusion?: string }[];
}
export function validateMerge(pr: MergeSnapshot, sha: string): void {
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    pr.headRefOid !== sha ||
    pr.state !== "OPEN" ||
    pr.isDraft ||
    pr.mergeStateStatus !== "CLEAN"
  )
    throw new Error("PR/head is not mergeable");
  for (const name of ["privacy-scan", "gitleaks", "bugfix-evidence", "Relay unit and browser checks"]) {
    if (!pr.statusCheckRollup.some((c) => c.name === name && c.status === "COMPLETED" && c.conclusion === "SUCCESS"))
      throw new Error(`missing successful ${name}`);
  }
  if (pr.statusCheckRollup.some((c) => c.status !== "COMPLETED" || c.conclusion !== "SUCCESS"))
    throw new Error("checks not all successful");
}

export interface GateState {
  pr: number;
  sha: string;
  code: string;
  expires: number;
  repository: string;
}
export function confirmGate(state: GateState, pr: number, code: string, sha: string, now: number) {
  if (
    state.pr !== pr ||
    state.code !== code ||
    state.sha !== sha ||
    !Number.isFinite(state.expires) ||
    now >= state.expires
  )
    throw new Error("Confirmation mismatch");
}
export function evidenceSections(body: string) {
  return ["## Repro (before)", "## Verify (after)", "## 风险分级"].every(
    (heading) => body.includes(heading) && body.split(heading)[1]?.split("\n## ")[0]?.trim(),
  );
}

export function checkAgentTrailer({
  message,
  authorName,
  authorEmail,
}: {
  message: string;
  authorName?: string | undefined;
  authorEmail?: string | undefined;
}): string[] {
  const names: Record<string, string> = {
    "claude-code": "Claude Code (for 2mauis)",
    codex: "Codex (for 2mauis)",
    "grok-friday": "Grok Bot Friday (for 2mauis)",
  };
  const coauthors: Record<string, string> = {
    "claude-code": "Claude <noreply@anthropic.com>",
    codex: "Codex <noreply@openai.com>",
  };
  const errors: string[] = [];
  const lines = message.trimEnd().split(/\r?\n/);
  const agents = lines.filter((line) => /^Agent\s*:/i.test(line));
  if (agents.length !== 1) errors.push("trailer-count");
  else {
    const agent = /^Agent: (claude-code|codex|grok-friday|human)$/.exec(agents[0] ?? "")?.[1];
    if (!agent) errors.push("trailer-value");
    else {
      const lastBlank = lines.lastIndexOf("");
      const trailers = lines.slice(lastBlank + 1);
      if (lastBlank < 1 || !trailers.every((line) => /^[A-Za-z][A-Za-z-]*: .+$/.test(line)))
        errors.push("trailer-position");
      const coauthor = coauthors[agent];
      if (coauthor && !trailers.some((line) => /^Co-authored-by: (.+)$/i.exec(line)?.[1] === coauthor))
        errors.push("coauthor-missing");
      if (authorName !== undefined && agent !== "human" && authorName !== names[agent]) errors.push("author-name");
    }
  }
  if (authorEmail !== undefined && !authorEmail.endsWith("@users.noreply.github.com")) errors.push("author-email");
  return errors;
}
