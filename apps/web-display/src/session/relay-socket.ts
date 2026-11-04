// Transport for the display WebSocket: authentication, heartbeat, watchdog and
// reconnect with backoff. It knows nothing about scenes; decoded downlink
// messages are handed to `onMessage`.
import {
  CLOSE_CODES,
  WIRE_VERSION,
  type DownlinkMessage,
  type UplinkMessage,
} from "../../../../shared/protocol/index.ts";

/** The subset of the browser WebSocket this module uses, so tests can supply a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number }) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;
export const HEARTBEAT_MS = 25_000;
export const WATCHDOG_MS = 60_000;
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
/** Close code the page uses for a deliberate test disconnect; it reconnects like a network drop. */
export const TEST_DISCONNECT_CODE = 4000;

export type RelayPhase = "connecting" | "authenticating" | "live" | "reconnecting";

/** Why the socket stopped for good and will not reconnect by itself. */
export type StopReason = "unauthorized" | "replaced";

export interface RelaySocketEvents {
  onPhase(phase: RelayPhase): void;
  onMessage(message: DownlinkMessage): void;
  onStop(reason: StopReason): void;
}

export interface RelaySocketOptions {
  url: string;
  sessionToken: string;
  lastSeq: () => number;
  createSocket: SocketFactory;
  random?: () => number;
}

function decode(data: unknown): DownlinkMessage | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const message = parsed as Partial<DownlinkMessage>;
  if (message.v !== WIRE_VERSION || typeof message.type !== "string") return null;
  if (typeof message.seq !== "number" || !Number.isInteger(message.seq) || message.seq < 0) return null;
  return message as DownlinkMessage;
}

export class RelaySocket {
  readonly #options: RelaySocketOptions;
  readonly #events: RelaySocketEvents;
  readonly #random: () => number;
  #socket: SocketLike | null = null;
  #attempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;

  constructor(options: RelaySocketOptions, events: RelaySocketEvents) {
    this.#options = options;
    this.#events = events;
    this.#random = options.random ?? Math.random;
  }

  get sessionToken(): string {
    return this.#options.sessionToken;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  start(): void {
    if (this.#stopped || this.#socket || this.#reconnectTimer) return;
    this.#open();
  }

  send(message: UplinkMessage): boolean {
    if (!this.#socket || this.#socket.readyState !== OPEN) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  /** Drop the current connection as if the network failed; the socket reconnects. */
  dropForTest(): void {
    this.#socket?.close(TEST_DISCONNECT_CODE, "test");
  }

  /** Stop permanently without reporting through `onStop`. */
  dispose(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#clearTimers();
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    const socket = this.#socket;
    this.#socket = null;
    socket?.close(CLOSE_CODES.normal, "bye");
  }

  #open(): void {
    const socket = this.#options.createSocket(this.#options.url);
    this.#socket = socket;
    this.#events.onPhase("connecting");
    socket.addEventListener("open", () => {
      if (this.#socket !== socket) return;
      this.#events.onPhase("authenticating");
      this.send({
        v: WIRE_VERSION,
        type: "auth",
        request_id: "",
        seq: 0,
        body: { session_token: this.#options.sessionToken, last_seq: this.#options.lastSeq() },
      });
      this.#armWatchdog(socket);
      this.#heartbeat = setInterval(() => {
        this.send({ v: WIRE_VERSION, type: "ping", request_id: "", seq: 0, body: {} });
      }, HEARTBEAT_MS);
    });
    socket.addEventListener("message", (event) => {
      if (this.#socket !== socket) return;
      this.#armWatchdog(socket);
      const message = decode(event.data);
      if (!message) return;
      if (message.type === "auth_ok") {
        this.#attempt = 0;
        this.#events.onPhase("live");
        return;
      }
      if (message.type === "ping") {
        this.send({ v: WIRE_VERSION, type: "pong", request_id: "", seq: 0, body: {} });
        return;
      }
      this.#events.onMessage(message);
    });
    socket.addEventListener("close", (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#clearTimers();
      if (this.#stopped) return;
      if (event.code === CLOSE_CODES.unauthorized) this.#stop("unauthorized");
      else if (event.code === CLOSE_CODES.replaced) this.#stop("replaced");
      else this.#scheduleReconnect();
    });
  }

  #armWatchdog(socket: SocketLike): void {
    if (this.#watchdog) clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(() => socket.close(CLOSE_CODES.timeout, "watchdog"), WATCHDOG_MS);
  }

  #clearTimers(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    if (this.#watchdog) clearTimeout(this.#watchdog);
    this.#heartbeat = null;
    this.#watchdog = null;
  }

  #scheduleReconnect(): void {
    const base = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    this.#attempt += 1;
    this.#events.onPhase("reconnecting");
    this.#reconnectTimer = setTimeout(
      () => {
        this.#reconnectTimer = null;
        if (!this.#stopped) this.#open();
      },
      base * (0.8 + this.#random() * 0.4),
    );
  }

  #stop(reason: StopReason): void {
    this.#stopped = true;
    this.#events.onStop(reason);
  }
}
