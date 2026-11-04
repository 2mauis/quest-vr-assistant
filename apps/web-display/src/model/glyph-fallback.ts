import { SC_FONT_GLYPHS } from "./sc-glyphs.ts";

export const DEFAULT_PANEL_TITLE = "信息";
// Must be in the bundled subset; uikit draws nothing visible for a glyph it lacks.
export const FALLBACK_GLYPH = "\u25A1";

const GLYPHS: ReadonlySet<string> = new Set(Array.from(SC_FONT_GLYPHS));

export function hasGlyph(char: string): boolean {
  return GLYPHS.has(char);
}

// Maps every character the font subset cannot draw to FALLBACK_GLYPH, so a
// missing glyph shows up as a box instead of a silent gap.
export function renderableText(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    if (char === "\n") out += char;
    else if (char === "\t") out += " ";
    else out += GLYPHS.has(char) ? char : FALLBACK_GLYPH;
  }
  return out;
}

export function panelTitle(title: string, limit: number): string {
  return renderableText(
    Array.from(title || DEFAULT_PANEL_TITLE)
      .slice(0, limit)
      .join(""),
  );
}
