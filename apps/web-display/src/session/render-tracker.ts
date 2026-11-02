// Decides when a state change has really reached the screen: the renderer must
// have committed the revision, every awaited item must report ready, and
// FRAMES_AFTER_READY more frames must have been drawn after that. uikit applies
// text layout during its own frame callback, so one frame is not always enough.

export const FRAMES_AFTER_READY = 2;

export class RenderError extends Error {
  readonly reason: "item_failed" | "timeout" | "aborted";

  constructor(reason: RenderError["reason"]) {
    super(reason);
    this.name = "RenderError";
    this.reason = reason;
  }
}

interface Waiter {
  revision: number;
  keys: ReadonlySet<string>;
  stage: "content" | "frame" | "done";
  frames: number;
  resolve: () => void;
  reject: (error: RenderError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RenderTracker {
  #committed = 0;
  readonly #ready = new Set<string>();
  readonly #failed = new Set<string>();
  readonly #waiters = new Set<Waiter>();

  noteCommitted(revision: number): void {
    if (revision <= this.#committed) return;
    this.#committed = revision;
    this.#check();
  }

  markReady(key: string): void {
    this.#ready.add(key);
    this.#check();
  }

  markFailed(key: string): void {
    this.#failed.add(key);
    for (const waiter of this.#waiters) {
      if (waiter.keys.has(key)) this.#settle(waiter, new RenderError("item_failed"));
    }
  }

  isReady(key: string): boolean {
    return this.#ready.has(key);
  }

  /** Drop bookkeeping for keys that are no longer on screen. */
  retain(keys: Iterable<string>): void {
    const live = new Set(keys);
    for (const key of this.#ready) if (!live.has(key)) this.#ready.delete(key);
    for (const key of this.#failed) if (!live.has(key)) this.#failed.delete(key);
  }

  /**
   * Called after the renderer finished drawing a frame (R3F after-effect), so a
   * waiter whose content was ready before this frame is now visible.
   */
  noteFrame(): void {
    for (const waiter of this.#waiters) {
      if (waiter.stage !== "frame") continue;
      waiter.frames -= 1;
      if (waiter.frames <= 0) this.#settle(waiter);
    }
    this.#check();
  }

  waitForRender(revision: number, keys: readonly string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        revision,
        keys: new Set(keys),
        stage: "content",
        frames: FRAMES_AFTER_READY,
        resolve,
        reject,
        timer: setTimeout(() => this.#settle(waiter, new RenderError("timeout")), timeoutMs),
      };
      if (keys.some((key) => this.#failed.has(key))) {
        this.#settle(waiter, new RenderError("item_failed"));
        return;
      }
      this.#waiters.add(waiter);
      this.#check();
    });
  }

  abortAll(): void {
    for (const waiter of this.#waiters) this.#settle(waiter, new RenderError("aborted"));
  }

  #check(): void {
    for (const waiter of this.#waiters) {
      if (waiter.stage !== "content" || waiter.revision > this.#committed) continue;
      if ([...waiter.keys].every((key) => this.#ready.has(key))) waiter.stage = "frame";
    }
  }

  #settle(waiter: Waiter, error?: RenderError): void {
    if (waiter.stage === "done") return;
    waiter.stage = "done";
    this.#waiters.delete(waiter);
    clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
    else waiter.resolve();
  }
}
