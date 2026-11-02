import type { ServerResponse } from "node:http";
import { writeJson } from "../../../shared/node/http.ts";
import { bearerToken, safeEqual } from "./security.ts";

/** True only for `Authorization: Bearer <expected>`; the comparison is constant-time. */
export function isAuthorizedBearer(header: unknown, expected: string): boolean {
  const presented = bearerToken(header);
  const matches = safeEqual(presented, expected);
  return presented.length > 0 && matches;
}

/** Missing and wrong tokens get the same 401 body so neither can be told apart. */
export function writeUnauthorized(res: ServerResponse): void {
  writeJson(res, 401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="mcp"' });
}

export function writeRateLimited(res: ServerResponse): void {
  writeJson(res, 429, { error: "rate_limited" }, { "retry-after": "60" });
}

/** Requests without Origin (server-to-server) pass; browsers must be on the list. */
export function isOriginAllowed(origin: string | string[] | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return true;
  if (Array.isArray(origin)) return false;
  return allowed.includes(origin);
}
