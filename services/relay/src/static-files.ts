import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { securityHeaders, writeJson } from "../../../shared/node/http.ts";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

const DOCUMENT_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: data:; worker-src 'self' blob:";

/** Maps a URL path to a file below the build root, or null for anything suspicious. */
export function resolveDisplayFile(root: string, pathname: string): string | null {
  if (pathname === "/" || pathname === "/index.html") return path.join(root, "index.html");
  if (!pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("\0")) return null;
  const relative = pathname.slice(1);
  if (!relative || relative.endsWith("/") || relative.split("/").includes("..")) return null;
  const full = path.resolve(root, relative);
  return full === root || full.startsWith(`${root}${path.sep}`) ? full : null;
}

export async function serveFile(res: ServerResponse, file: string, method: string): Promise<void> {
  const extension = path.extname(file).toLowerCase();
  const type = TYPES[extension];
  const info = type ? await stat(file).catch(() => null) : null;
  if (!type || !info?.isFile()) {
    writeJson(res, 404, { error: "not_found" });
    return;
  }
  const headers: OutgoingHttpHeaders = securityHeaders({ "content-type": type, "content-length": info.size });
  if (extension === ".html") headers["content-security-policy"] = DOCUMENT_POLICY;
  if (method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  const stream = createReadStream(file);
  try {
    await new Promise<void>((resolve, reject) => {
      stream.once("open", () => resolve());
      stream.once("error", reject);
    });
  } catch {
    writeJson(res, 404, { error: "not_found" });
    return;
  }
  res.writeHead(200, headers);
  // A read error after headers cannot change the status; destroying the socket
  // makes the truncated body visible to the client instead of crashing the relay.
  await pipeline(stream, res).catch(() => res.destroy());
}
