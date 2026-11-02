import { createHmac, randomBytes } from "node:crypto";
import type { RelayConfig } from "./config.ts";
import { safeEqual } from "./security.ts";

export interface DeviceGrant {
  token: string;
  expiresAt: number;
}

interface GrantPayload {
  v: 1;
  scope: "display";
  subject: string;
  expiresAt: number;
}

function isGrantPayload(value: unknown, at: number): value is GrantPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === 1 &&
    payload.scope === "display" &&
    typeof payload.subject === "string" &&
    /^[a-f0-9]{32}$/.test(payload.subject) &&
    Number.isSafeInteger(payload.expiresAt) &&
    (payload.expiresAt as number) > at
  );
}

/** Display-only recovery grants survive relay restarts, but not pairing-key rotation. */
export function createDeviceGrants(config: Pick<RelayConfig, "devicePairingToken" | "deviceGrantTtlMs">) {
  const key = createHmac("sha256", config.devicePairingToken).update("qvr-device-recovery-v1").digest();
  const sign = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");
  return {
    issue(at: number, subject: string = randomBytes(16).toString("hex")): DeviceGrant {
      const expiresAt = at + config.deviceGrantTtlMs;
      const payload = Buffer.from(JSON.stringify({ v: 1, scope: "display", subject, expiresAt })).toString(
        "base64url",
      );
      return { token: `${payload}.${sign(payload)}`, expiresAt };
    },
    verify(token: unknown, at: number): GrantPayload | null {
      if (typeof token !== "string" || token.length > 1024) return null;
      const [payload, signature, ...rest] = token.split(".");
      if (payload === undefined || signature === undefined || rest.length > 0) return null;
      if (![payload, signature].every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
      if (!safeEqual(sign(payload), signature)) return null;
      try {
        const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return isGrantPayload(value, at) ? value : null;
      } catch {
        return null;
      }
    },
  };
}
