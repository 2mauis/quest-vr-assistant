// Summarises CodeQL SARIF files: one tab-separated line per result (rule,
// severity, location, message), or with --markdown a per-language table of
// counts by severity followed by the results, for $GITHUB_STEP_SUMMARY.
import { readFileSync } from "node:fs";
import path from "node:path";

interface Rule {
  id: string;
  properties?: { "security-severity"?: string; "problem.severity"?: string };
}
interface Result {
  ruleId?: string;
  level?: string;
  message: { text: string };
  locations?: { physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number } } }[];
}
interface Sarif {
  runs: {
    automationDetails?: { id?: string };
    tool: { driver: { rules?: Rule[] }; extensions?: { rules?: Rule[] }[] };
    results?: Result[];
  }[];
}
interface Alert {
  ruleId: string;
  band: string;
  severity: string;
  where: string;
  message: string;
}

const BANDS = ["critical", "high", "medium", "low", "error", "warning", "note", "recommendation"];
const MARKDOWN_ROW_LIMIT = 100;

function classify(rule: Rule | undefined, result: Result): { band: string; severity: string } {
  const score = rule?.properties?.["security-severity"];
  if (score === undefined) {
    const band = rule?.properties?.["problem.severity"] ?? result.level ?? "unknown";
    return { band, severity: band };
  }
  const value = Number(score);
  const band = value >= 9 ? "critical" : value >= 7 ? "high" : value >= 4 ? "medium" : "low";
  return { band, severity: `${band} (${score})` };
}

function readAlerts(file: string): { label: string; alerts: Alert[] } {
  const sarif = JSON.parse(readFileSync(file, "utf8")) as Sarif;
  const alerts: Alert[] = [];
  let label = path.basename(file, ".sarif");
  for (const run of sarif.runs) {
    const category = run.automationDetails?.id?.replace(/^\/language:|\/$/gu, "");
    if (category) label = category;
    const rules = new Map<string, Rule>();
    for (const rule of [
      ...(run.tool.driver.rules ?? []),
      ...(run.tool.extensions ?? []).flatMap((e) => e.rules ?? []),
    ]) {
      rules.set(rule.id, rule);
    }
    for (const result of run.results ?? []) {
      const ruleId = result.ruleId ?? "unknown";
      const location = result.locations?.[0]?.physicalLocation;
      alerts.push({
        ruleId,
        ...classify(rules.get(ruleId), result),
        where: `${location?.artifactLocation?.uri ?? "?"}:${location?.region?.startLine ?? "?"}`,
        message: result.message.text.replace(/\s+/gu, " "),
      });
    }
  }
  return { label, alerts };
}

const cell = (text: string) => text.replace(/[&<>|`\\\r\n]/gu, (char) => `&#${char.codePointAt(0)};`);

function markdown(label: string, alerts: Alert[]): string {
  const counts = new Map<string, number>();
  for (const alert of alerts) counts.set(alert.band, (counts.get(alert.band) ?? 0) + 1);
  const bands = [...counts.keys()].sort((a, b) => {
    const rank = (band: string) => (BANDS.includes(band) ? BANDS.indexOf(band) : BANDS.length);
    return rank(a) - rank(b);
  });
  const lines = [`### CodeQL: ${cell(label)}`, "", `${alerts.length} result(s)`, ""];
  if (alerts.length === 0) return `${lines.join("\n")}\n`;
  lines.push(`| ${bands.map(cell).join(" | ")} |`, `|${bands.map(() => "---").join("|")}|`);
  lines.push(`| ${bands.map((band) => String(counts.get(band))).join(" | ")} |`, "");
  lines.push("| Rule | Severity | Location |", "|---|---|---|");
  for (const alert of alerts.slice(0, MARKDOWN_ROW_LIMIT)) {
    lines.push(`| <code>${cell(alert.ruleId)}</code> | ${cell(alert.severity)} | <code>${cell(alert.where)}</code> |`);
  }
  if (alerts.length > MARKDOWN_ROW_LIMIT)
    lines.push("", `${alerts.length - MARKDOWN_ROW_LIMIT} more in the SARIF artifact.`);
  return `${lines.join("\n")}\n`;
}

const args = process.argv.slice(2);
const asMarkdown = args.includes("--markdown");
const files = args.filter((arg) => arg !== "--markdown");
let total = 0;
for (const file of files) {
  const { label, alerts } = readAlerts(file);
  total += alerts.length;
  if (asMarkdown) {
    process.stdout.write(markdown(label, alerts));
    continue;
  }
  for (const alert of alerts) console.log(`${alert.ruleId}\t${alert.severity}\t${alert.where}\t${alert.message}`);
  console.log(`${file}: ${alerts.length} result(s)`);
}
if (!asMarkdown && files.length > 1) console.log(`total: ${total} result(s)`);
