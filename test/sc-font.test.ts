import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ASCII_PRINTABLE,
  FALLBACK_GLYPH as GENERATOR_FALLBACK,
  PUNCTUATION,
  REPO_ROOT,
  commonHanzi,
  requiredCharset,
  sourceLiteralChars,
} from "../scripts/fonts/charset.ts";
import {
  DEFAULT_PANEL_TITLE,
  FALLBACK_GLYPH,
  hasGlyph,
  panelTitle,
  renderableText,
} from "../apps/web-display/src/model/glyph-fallback.ts";
import { SC_FONT_GLYPHS } from "../apps/web-display/src/model/sc-glyphs.ts";
import { FONT_FAMILIES } from "../apps/web-display/src/render/fonts.ts";

interface FontJson {
  pages: string[];
  chars: { char: string }[];
  common: { pages: number; scaleW: number; scaleH: number };
  distanceField: { fieldType: string };
}

const PUBLIC_DIR = path.join(REPO_ROOT, "apps/web-display/public");
const FONT_FILE = path.join(PUBLIC_DIR, FONT_FAMILIES.sc.normal);
const font = JSON.parse(readFileSync(FONT_FILE, "utf8")) as FontJson;
const fontChars = new Set(font.chars.map((glyph) => glyph.char));

// Sample panel strings mixing Latin, Chinese and punctuation, as a voice reply would.
const SAMPLE_TEXTS = [
  "你好，我是你的助手。今天天气不错！",
  "请看前面的面板：温度 25℃，湿度 60%。",
  "“开始”之后，再说一次【确认】即可。",
  "Hello, world! 3D model loaded (v1.0) — OK?",
];

const missingFrom = (chars: Iterable<string>) => [...chars].filter((char) => !fontChars.has(char));

test("font JSON is a single-page MSDF atlas that uikit can load", () => {
  assert.equal(font.distanceField.fieldType, "msdf");
  assert.equal(font.common.pages, 1);
  assert.equal(font.pages.length, 1);
  assert.ok(existsSync(path.join(path.dirname(FONT_FILE), font.pages[0]!)));
  assert.ok(existsSync(path.join(path.dirname(FONT_FILE), "LICENSE")));
  assert.equal(font.chars.length, fontChars.size, "duplicate glyph entries");
});

test("font covers every Chinese literal in source, the default title and the samples", () => {
  assert.deepEqual(missingFrom(sourceLiteralChars()), []);
  assert.deepEqual(missingFrom(DEFAULT_PANEL_TITLE), []);
  assert.deepEqual(missingFrom(SAMPLE_TEXTS.join("")), []);
});

test("font covers printable ASCII, punctuation, the common set and the fallback glyph", () => {
  assert.deepEqual(missingFrom(ASCII_PRINTABLE), []);
  assert.deepEqual(missingFrom(PUNCTUATION), []);
  assert.equal(commonHanzi().length, 1000);
  assert.deepEqual(missingFrom(commonHanzi()), []);
  assert.equal(FALLBACK_GLYPH, GENERATOR_FALLBACK);
  assert.ok(fontChars.has(FALLBACK_GLYPH));
  assert.deepEqual(missingFrom(requiredCharset()), []);
});

test("the model layer's glyph list matches the font JSON", () => {
  assert.deepEqual(Array.from(SC_FONT_GLYPHS).sort(), [...fontChars].sort());
});

test("characters outside the subset are replaced by the visible fallback", () => {
  // Written as escapes so the literal scanner does not pull them into the subset.
  const rare = "\u9F98";
  const emoji = "\u{1F600}";
  assert.equal(hasGlyph(rare), false);
  assert.equal(renderableText(`温度${rare}25℃`), `温度${FALLBACK_GLYPH}25℃`);
  assert.equal(renderableText(`ok ${emoji}!`), `ok ${FALLBACK_GLYPH}!`);
  for (const text of SAMPLE_TEXTS) assert.equal(renderableText(text), text);
  assert.equal(renderableText("第一行\n第二行\tend"), "第一行\n第二行 end");
  // Decomposed "é" is normalized to the precomposed form; it is not in the subset.
  assert.equal(renderableText("cafe\u0301"), `caf${FALLBACK_GLYPH}`);
});

test("an empty title falls back to the default and is cut by code point", () => {
  assert.equal(panelTitle("", 40), DEFAULT_PANEL_TITLE);
  assert.equal(panelTitle("ab\u{1F600}cd", 3), `ab${FALLBACK_GLYPH}`);
});
