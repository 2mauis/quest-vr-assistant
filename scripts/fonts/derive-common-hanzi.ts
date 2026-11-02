// Rebuilds common-hanzi.txt: the most frequent simplified characters.
// Frequency is the summed kHanyuPinlu count in Unihan (from the Xiandai Hanyu
// Pinlu Cidian); only characters in CLDR's zh main exemplar set are kept, which
// drops traditional variants. Requires the system `unzip`.
// Usage: node scripts/fonts/derive-common-hanzi.ts [count]
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { COMMON_HANZI_FILE } from "./charset.ts";
import { fetchVerified, loadSources } from "./sources.ts";

const count = Number(process.argv[2] ?? "1000");
if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer");

const sources = await loadSources();
const unihan = execFileSync("unzip", ["-p", await fetchVerified(sources.unihan), "Unihan_Readings.txt"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const cldr = await readFile(await fetchVerified(sources.cldr), "utf8");
const exemplarMatch = /<exemplarCharacters>([^<]*)<\/exemplarCharacters>/u.exec(cldr);
if (!exemplarMatch?.[1]) throw new Error("CLDR zh main exemplar set not found");
const simplified = new Set(exemplarMatch[1].match(/\p{Script=Han}/gu));

const frequency = new Map<string, number>();
for (const line of unihan.split("\n")) {
  const [codePoint, field, value] = line.split("\t");
  if (field !== "kHanyuPinlu" || !codePoint || !value) continue;
  const char = String.fromCodePoint(Number.parseInt(codePoint.slice(2), 16));
  if (!simplified.has(char)) continue;
  const total = [...value.matchAll(/\((\d+)\)/gu)].reduce((sum, match) => sum + Number(match[1]), 0);
  frequency.set(char, total);
}

const ranked = [...frequency.entries()]
  .sort(([a, x], [b, y]) => y - x || (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0))
  .slice(0, count)
  .map(([char]) => char);
if (ranked.length < count) throw new Error(`only ${String(ranked.length)} characters available`);

const lines: string[] = [];
for (let i = 0; i < ranked.length; i += 50) lines.push(ranked.slice(i, i + 50).join(""));
await writeFile(COMMON_HANZI_FILE, `${lines.join("\n")}\n`);
console.log(`wrote ${String(ranked.length)} characters to ${COMMON_HANZI_FILE}`);
