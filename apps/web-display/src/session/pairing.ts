// HTTP calls to the relay's private display listener.

export const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function isSessionToken(value: unknown): value is string {
  return typeof value === "string" && SESSION_TOKEN_PATTERN.test(value);
}

export type PairResult =
  | { ok: true; sessionToken: string }
  | { ok: false; reason: "rate_limited" | "unauthorized" | "network" | "aborted" | "invalid_response" };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function pairDisplay(
  token: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<PairResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/device/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      signal,
    });
  } catch {
    return { ok: false, reason: signal.aborted ? "aborted" : "network" };
  }
  if (response.status === 429) return { ok: false, reason: "rate_limited" };
  if (!response.ok) return { ok: false, reason: "unauthorized" };
  try {
    const body = (await response.json()) as { session_token?: unknown };
    if (!isSessionToken(body.session_token)) return { ok: false, reason: "invalid_response" };
    return { ok: true, sessionToken: body.session_token };
  } catch {
    return { ok: false, reason: signal.aborted ? "aborted" : "invalid_response" };
  }
}

export interface DisplayConfig {
  assetOrigins: readonly string[];
}

/** Fetches `/api/display/config`, retrying with backoff until it succeeds or `signal` aborts. */
export async function loadDisplayConfig(signal: AbortSignal, fetchImpl: FetchLike = fetch): Promise<DisplayConfig> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchImpl("/api/display/config", { signal });
      if (response.ok) {
        const body = (await response.json()) as { asset_origins?: unknown };
        const origins = Array.isArray(body.asset_origins)
          ? body.asset_origins.filter((origin): origin is string => typeof origin === "string")
          : [];
        return { assetOrigins: origins };
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, Math.min(1000 * 2 ** attempt, 30_000));
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        },
        { once: true },
      );
    });
  }
}

export function isAllowedModelUrl(value: string, config: DisplayConfig): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && config.assetOrigins.includes(url.origin);
  } catch {
    return false;
  }
}
