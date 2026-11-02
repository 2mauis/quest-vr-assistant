export type RateLimiter = (now: number) => boolean;

/** Sliding window: at most `limit` accepted events in any `windowMs`. */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits: number[] = [];
  return (now) => {
    while (hits.length > 0 && now - (hits[0] ?? now) >= windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}
