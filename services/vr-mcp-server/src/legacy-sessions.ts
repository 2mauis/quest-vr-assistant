import type { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

interface Entry {
  transport: NodeStreamableHTTPServerTransport;
  expiresAt: number;
}

export interface LegacySessionStoreOptions {
  ttlMs: number;
  maxSessions: number;
  now?: () => number;
}

/**
 * Sessionful 2025-11-25 transports keyed by `Mcp-Session-Id`. Bounded: when
 * full, the least recently used session is closed to admit a new one.
 */
export class LegacySessionStore {
  readonly #entries = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #maxSessions: number;
  readonly #now: () => number;

  constructor(options: LegacySessionStoreOptions) {
    this.#ttlMs = options.ttlMs;
    this.#maxSessions = options.maxSessions;
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#entries.size;
  }

  add(sessionId: string, transport: NodeStreamableHTTPServerTransport): void {
    this.prune();
    while (this.#entries.size >= this.#maxSessions) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#close(oldest.value);
    }
    this.#entries.set(sessionId, { transport, expiresAt: this.#now() + this.#ttlMs });
  }

  /** Returns a live transport and extends its lifetime, or null when unknown or expired. */
  touch(sessionId: string): NodeStreamableHTTPServerTransport | null {
    this.prune();
    const entry = this.#entries.get(sessionId);
    if (!entry) return null;
    this.#entries.delete(sessionId);
    entry.expiresAt = this.#now() + this.#ttlMs;
    this.#entries.set(sessionId, entry);
    return entry.transport;
  }

  /** Forgets a session the transport itself closed. */
  forget(sessionId: string): void {
    this.#entries.delete(sessionId);
  }

  async remove(sessionId: string): Promise<boolean> {
    const entry = this.#entries.get(sessionId);
    if (!entry) return false;
    this.#entries.delete(sessionId);
    await entry.transport.close();
    return true;
  }

  prune(): void {
    const at = this.#now();
    for (const [sessionId, entry] of this.#entries) {
      if (entry.expiresAt <= at) this.#close(sessionId);
    }
  }

  async closeAll(): Promise<void> {
    const transports = [...this.#entries.values()].map((entry) => entry.transport);
    this.#entries.clear();
    await Promise.allSettled(transports.map((transport) => transport.close()));
  }

  #close(sessionId: string): void {
    const entry = this.#entries.get(sessionId);
    this.#entries.delete(sessionId);
    entry?.transport.close().catch(() => undefined);
  }
}
