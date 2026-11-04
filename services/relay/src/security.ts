import { createHash, timingSafeEqual } from "node:crypto";

const textEncoder = new TextEncoder();

/**
 * Compare two strings without returning early on the secret's contents.
 * Both sides are hashed to a fixed length before the constant-time compare.
 */
export function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(textEncoder.encode(left)).digest();
  const b = createHash("sha256").update(textEncoder.encode(right)).digest();
  return timingSafeEqual(a, b);
}

/** Token from `Authorization: Bearer <token>`, or "" when absent or malformed. */
export function bearerToken(header: unknown): string {
  if (typeof header !== "string") return "";
  const match = /^Bearer ([!-~]+)$/i.exec(header);
  return match?.[1] ?? "";
}
