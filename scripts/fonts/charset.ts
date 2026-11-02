// Character set of the display page's Chinese MSDF font. Shared by the
// generator and by the coverage tests, so both agree on what must be present.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const COMMON_HANZI_FILE = path.join(REPO_ROOT, "scripts/fonts/common-hanzi.txt");
export const CHARSET_FILE = path.join(REPO_ROOT, "scripts/fonts/charset.txt");

/** Shown in place of any character the font lacks; must itself be in the font. */
export const FALLBACK_GLYPH = "\u25A1";

export const ASCII_PRINTABLE = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join("");

/** Chinese and general punctuation a panel is likely to contain. */
export const PUNCTUATION = [
  "，。、；：？！…—～·",
  "“”‘’「」『』（）《》〈〉【】〔〕［］｛｝",
  "＂＇＃＄％＆＊＋－／＜＝＞＠＼＾＿｀｜",
  "０１２３４５６７８９",
  "–‐•‰′″℃°±×÷→←↑↓",
  "￥",
].join("");

/** Tracked source that can put Chinese text on a panel, including test strings. */
const SOURCE_DIRS = ["apps/web-display/src", "shared", "services", "scripts", "test"];
const SOURCE_FILE = /\.(ts|tsx|js|mjs)$/;
/** Generated from the font itself; scanning it would make the set self-sustaining. */
const EXCLUDED_FILES = new Set(["apps/web-display/src/model/sc-glyphs.ts"]);
/** Han ideographs, CJK punctuation, fullwidth forms and general punctuation. */
const LITERAL_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF\u2010-\u2027]/gu;

export function sourceFiles(): string[] {
  const listing = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...SOURCE_DIRS],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  const files = listing.split("\n").filter((file) => SOURCE_FILE.test(file) && !EXCLUDED_FILES.has(file));
  return [...new Set(files)].sort();
}

/** Every Chinese character or punctuation mark written in tracked source. */
export function sourceLiteralChars(files: readonly string[] = sourceFiles()): string[] {
  const found = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(path.join(REPO_ROOT, file), "utf8").matchAll(LITERAL_CHAR)) found.add(match[0]);
  }
  return [...found].sort();
}

export function commonHanzi(): string[] {
  return Array.from(readFileSync(COMMON_HANZI_FILE, "utf8").replace(/\s+/gu, ""));
}

/** Sorted, de-duplicated characters for the generator. */
export function requiredCharset(): string[] {
  const all = new Set([
    ...Array.from(ASCII_PRINTABLE),
    ...Array.from(PUNCTUATION),
    FALLBACK_GLYPH,
    ...commonHanzi(),
    ...sourceLiteralChars(),
  ]);
  return [...all].sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0));
}
