import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./charset.ts";

export interface Source {
  name: string;
  url: string;
  sha256: string;
}

export type SourceName = "font" | "license" | "unihan" | "cldr";

export const CACHE_DIR = path.join(REPO_ROOT, "scripts/fonts/build/cache");

export async function loadSources(): Promise<Record<SourceName, Source>> {
  const text = await readFile(path.join(REPO_ROOT, "scripts/fonts/sources.json"), "utf8");
  return JSON.parse(text) as Record<SourceName, Source>;
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Downloads once into the ignored cache and refuses anything whose hash differs. */
export async function fetchVerified(source: Source): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, path.basename(new URL(source.url).pathname));
  const cached = await readFile(file).catch(() => null);
  if (cached && sha256(cached) === source.sha256) return file;
  const response = await fetch(source.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${String(response.status)}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== source.sha256) throw new Error(`${source.name}: sha256 ${actual} does not match ${source.sha256}`);
  await writeFile(file, data);
  return file;
}
