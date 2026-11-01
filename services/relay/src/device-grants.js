import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./security.js";

/** Display-only recovery grants survive relay restarts, but not pairing-key rotation. */
export function createDeviceGrants(config) {
  const key = createHmac("sha256", config.devicePairingToken).update("qvr-device-recovery-v1").digest();
  const sign = (payload) => createHmac("sha256", key).update(payload).digest("base64url");
  return {
    issue(at, subject = randomBytes(16).toString("hex")) {
      const expiresAt = at + config.deviceGrantTtlMs;
      const payload = Buffer.from(JSON.stringify({ v: 1, scope: "display", subject, expiresAt })).toString("base64url");
      return { token: `${payload}.${sign(payload)}`, expiresAt };
    },
    verify(token, at) {
      if (typeof token !== "string" || token.length > 1024) return null;
      const parts = token.split(".");
      if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
      if (!safeEqual(sign(parts[0]), parts[1])) return null;
      try {
        const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
        if (value.v !== 1 || value.scope !== "display" || !/^[a-f0-9]{32}$/.test(value.subject) ||
            !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= at) return null;
        return value;
      } catch { return null; }
    },
  };
}
