// Prints one line per result of CodeQL SARIF files: rule, severity, location, message.
import { readFileSync } from "node:fs";

interface Rule {
  id: string;
  properties?: { "security-severity"?: string; "problem.severity"?: string };
}
interface Result {
  ruleId?: string;
  rule?: { index?: number };
  level?: string;
  message: { text: string };
  locations?: { physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number } } }[];
}
interface Sarif {
  runs: { tool: { driver: { rules?: Rule[] }; extensions?: { rules?: Rule[] }[] }; results?: Result[] }[];
}

function severity(rule: Rule | undefined, result: Result): string {
  const score = rule?.properties?.["security-severity"];
  if (score === undefined) return rule?.properties?.["problem.severity"] ?? result.level ?? "unknown";
  const value = Number(score);
  const band = value >= 9 ? "critical" : value >= 7 ? "high" : value >= 4 ? "medium" : "low";
  return `${band} (${score})`;
}

let total = 0;
for (const file of process.argv.slice(2)) {
  const sarif = JSON.parse(readFileSync(file, "utf8")) as Sarif;
  for (const run of sarif.runs) {
    const rules = new Map<string, Rule>();
    for (const rule of [
      ...(run.tool.driver.rules ?? []),
      ...(run.tool.extensions ?? []).flatMap((e) => e.rules ?? []),
    ]) {
      rules.set(rule.id, rule);
    }
    for (const result of run.results ?? []) {
      total += 1;
      const ruleId = result.ruleId ?? "unknown";
      const location = result.locations?.[0]?.physicalLocation;
      const where = `${location?.artifactLocation?.uri ?? "?"}:${location?.region?.startLine ?? "?"}`;
      const message = result.message.text.replace(/\s+/gu, " ");
      console.log(`${ruleId}\t${severity(rules.get(ruleId), result)}\t${where}\t${message}`);
    }
  }
  console.log(`${file}: ${sarif.runs.reduce((sum, run) => sum + (run.results?.length ?? 0), 0)} result(s)`);
}
if (process.argv.length > 3) console.log(`total: ${total} result(s)`);
