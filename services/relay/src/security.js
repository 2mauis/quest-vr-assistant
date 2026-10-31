import { createHash, timingSafeEqual } from "node:crypto";

const textEncoder = new TextEncoder();

/**
 * Compare two strings without returning early on the secret's contents.
 * Both sides are hashed to a fixed length before the constant-time compare.
 */
export function safeEqual(left, right) {
  const a = createHash("sha256").update(textEncoder.encode(String(left))).digest();
  const b = createHash("sha256").update(textEncoder.encode(String(right))).digest();
  return timingSafeEqual(a, b);
}

export function bearerToken(header) {
  if (typeof header !== "string") return "";
  const match = /^Bearer ([!-~]+)$/i.exec(header);
  if (!match) return "";
  return match[1];
}

export function safeEqualBearer(header, expected) {
  const presented = bearerToken(header);
  const matches = safeEqual(presented, expected);
  return presented.length > 0 && matches;
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        const error = new Error("payload_too_large");
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (!failed) reject(error);
    });
  });
}

export function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value));
}
