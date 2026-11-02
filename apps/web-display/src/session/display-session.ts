// Orchestrates one display: pairing, the relay socket, ordered command handling
// and render-gated ACKs. The UI reads an immutable `DisplayView` snapshot.
import { WIRE_VERSION, type CommandMessage, type DownlinkMessage } from "../../../../shared/protocol/index.ts";
import {
  applyCommand,
  applySnapshot,
  EMPTY_STATE,
  resetState,
  sceneName,
  type DisplayState,
  type Transition,
} from "../state/display-state.ts";
import {
  isAllowedModelUrl,
  isSessionToken,
  loadDisplayConfig,
  pairDisplay,
  type DisplayConfig,
  type FetchLike,
} from "./pairing.ts";
import { RelaySocket, type RelayPhase, type SocketFactory, type StopReason } from "./relay-socket.ts";
import { RenderError, RenderTracker } from "./render-tracker.ts";

export const RENDER_TIMEOUT_MS = 20_000;

export const STATUS = {
  idle: "未连接",
  pairing: "正在配对",
  connecting: "正在连接",
  authenticating: "正在验证配对",
  live: "显示中",
  reconnecting: "正在重连",
  unauthorized: "需要重新配对",
  replaced: "已切换到另一设备",
  renderFailed: "渲染失败，未确认显示；请检查模型后重试",
  rateLimited: "配对受限，请稍后重试",
  badToken: "配对口令错误",
  unreachable: "无法连接中继，请检查服务与 USB 转发",
} as const;

const PHASE_STATUS: Record<RelayPhase, string> = {
  connecting: STATUS.connecting,
  authenticating: STATUS.authenticating,
  live: STATUS.live,
  reconnecting: STATUS.reconnecting,
};

export interface DisplayView {
  status: string;
  connected: boolean;
  /** Pairing or a connection is in progress: the token form is locked and "disconnect" is enabled. */
  busy: boolean;
  /** Label of the "use this device again" button, or null when it is hidden. */
  takeover: string | null;
  state: DisplayState;
  sceneName: string;
  seq: number;
}

/** Callbacks the renderer uses to report what actually reached the screen. */
export interface RenderReporter {
  committed(revision: number): void;
  ready(key: string): void;
  failed(key: string): void;
  frame(): void;
}

export interface DisplaySessionOptions {
  socketUrl: string;
  createSocket: SocketFactory;
  fetch?: FetchLike;
  renderTimeoutMs?: number;
}

function isCommand(message: DownlinkMessage): message is CommandMessage {
  return message.type === "show_scene" || message.type === "render_panel" || message.type === "clear";
}

export class DisplaySession {
  readonly #options: DisplaySessionOptions;
  readonly #fetch: FetchLike;
  readonly #listeners = new Set<() => void>();
  readonly #tracker = new RenderTracker();
  readonly #configAbort = new AbortController();
  readonly #config: Promise<DisplayConfig>;
  #view: DisplayView;
  #state: DisplayState = EMPTY_STATE;
  #status: string = STATUS.idle;
  #connected = false;
  #relay: RelaySocket | null = null;
  #sessionToken = "";
  #pairing: AbortController | null = null;
  #takeoverLabel = "切回此设备";
  #lastSeq = 0;
  #resumeRequestedAt = -1;
  #commands: Promise<void> = Promise.resolve();

  readonly reporter: RenderReporter = {
    committed: (revision) => this.#tracker.noteCommitted(revision),
    ready: (key) => {
      this.#tracker.markReady(key);
      if (this.#state.scene?.key === key) this.#emit();
    },
    failed: (key) => this.#tracker.markFailed(key),
    frame: () => this.#tracker.noteFrame(),
  };

  constructor(options: DisplaySessionOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#config = loadDisplayConfig(this.#configAbort.signal, this.#fetch);
    this.#config.catch(() => {});
    this.#view = this.#buildView();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getView = (): DisplayView => this.#view;

  async connect(token: string): Promise<void> {
    if (this.#pairing || this.#relay) return;
    const request = new AbortController();
    this.#pairing = request;
    this.#setStatus(STATUS.pairing, false);
    try {
      const result = await pairDisplay(token, request.signal, this.#fetch);
      if (this.#pairing !== request) return;
      if (!result.ok) {
        if (result.reason === "rate_limited") this.#setStatus(STATUS.rateLimited, false);
        else if (result.reason === "unauthorized") this.#setStatus(STATUS.badToken, false);
        else if (result.reason !== "aborted") this.#setStatus(STATUS.unreachable, false);
        return;
      }
      this.#state = resetState(this.#state);
      this.#lastSeq = 0;
      this.#startRelay(result.sessionToken);
    } finally {
      if (this.#pairing === request) this.#pairing = null;
      this.#emit();
    }
  }

  disconnect(): void {
    this.#pairing?.abort();
    this.#pairing = null;
    this.#stopRelay();
    this.#sessionToken = "";
    this.#setStatus(STATUS.idle, false);
  }

  takeover(): void {
    if (!this.#sessionToken || this.#relay || this.#pairing) return;
    this.#startRelay(this.#sessionToken);
  }

  /** Entry point for the native shell, which pairs on its own and injects the session. */
  adoptSession(token: unknown): boolean {
    if (!isSessionToken(token)) return false;
    if (this.#relay && this.#relay.sessionToken === token) return true;
    this.#pairing?.abort();
    this.#pairing = null;
    this.#startRelay(token);
    return true;
  }

  select(targetId: string): void {
    if (!this.#connected || !targetId) return;
    this.#relay?.send({
      v: WIRE_VERSION,
      type: "interaction",
      request_id: `select_${crypto.randomUUID()}`,
      seq: 0,
      body: { kind: "select", target_id: targetId },
    });
  }

  disconnectForTest(): void {
    this.#relay?.dropForTest();
  }

  dispose(): void {
    this.#configAbort.abort();
    this.#pairing?.abort();
    this.#stopRelay();
    this.#listeners.clear();
  }

  #startRelay(token: string): void {
    this.#stopRelay();
    this.#sessionToken = token;
    this.#resumeRequestedAt = -1;
    this.#commands = Promise.resolve();
    const relay: RelaySocket = new RelaySocket(
      {
        url: this.#options.socketUrl,
        sessionToken: token,
        lastSeq: () => this.#lastSeq,
        createSocket: this.#options.createSocket,
      },
      {
        onPhase: (phase) => {
          if (this.#relay === relay) this.#setStatus(PHASE_STATUS[phase], phase === "live");
        },
        onMessage: (message) => {
          if (this.#relay !== relay) return;
          this.#commands = this.#commands.then(() => this.#handle(message, relay));
        },
        onStop: (reason) => {
          if (this.#relay === relay) this.#onStop(reason);
        },
      },
    );
    this.#relay = relay;
    relay.start();
    this.#emit();
  }

  #stopRelay(): void {
    const relay = this.#relay;
    this.#relay = null;
    relay?.dispose();
    this.#tracker.abortAll();
    this.#connected = false;
  }

  #onStop(reason: StopReason): void {
    this.#stopRelay();
    if (reason === "unauthorized") {
      this.#sessionToken = "";
      this.#setStatus(STATUS.unauthorized, false);
    } else {
      this.#takeoverLabel = "切回此设备";
      this.#setStatus(STATUS.replaced, false);
    }
  }

  async #handle(message: DownlinkMessage, relay: RelaySocket): Promise<void> {
    if (this.#relay !== relay) return;
    if (message.type === "snapshot") {
      await this.#render(relay, applySnapshot(this.#state, message.body), message.seq, null);
      return;
    }
    if (!isCommand(message)) return;
    if (message.seq <= this.#lastSeq) {
      // Already shown; repeat the ACK in case the first one was lost.
      relay.send({ v: WIRE_VERSION, type: "ack", request_id: message.request_id, seq: message.seq, body: {} });
      return;
    }
    if (message.seq !== this.#lastSeq + 1) {
      if (this.#resumeRequestedAt !== this.#lastSeq) {
        this.#resumeRequestedAt = this.#lastSeq;
        relay.send({ v: WIRE_VERSION, type: "resume", request_id: "", seq: 0, body: { last_seq: this.#lastSeq } });
      }
      return;
    }
    if (message.type === "show_scene" && message.body.model_url) {
      const allowed = await this.#modelAllowed(message.body.model_url);
      if (this.#relay !== relay) return;
      if (!allowed) {
        this.#renderFailed();
        return;
      }
    }
    await this.#render(relay, applyCommand(this.#state, message), message.seq, message.request_id);
  }

  async #render(relay: RelaySocket, transition: Transition, seq: number, requestId: string | null): Promise<void> {
    this.#state = transition.state;
    this.#tracker.retain([
      ...(this.#state.scene ? [this.#state.scene.key] : []),
      ...this.#state.panels.map((panel) => panel.key),
    ]);
    this.#emit();
    try {
      await this.#tracker.waitForRender(
        transition.state.revision,
        transition.awaiting,
        this.#options.renderTimeoutMs ?? RENDER_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof RenderError && error.reason === "aborted") return;
      if (this.#relay === relay) this.#renderFailed();
      return;
    }
    if (this.#relay !== relay) return;
    this.#lastSeq = seq;
    this.#emit();
    if (requestId !== null) relay.send({ v: WIRE_VERSION, type: "ack", request_id: requestId, seq, body: {} });
  }

  async #modelAllowed(url: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.#options.renderTimeoutMs ?? RENDER_TIMEOUT_MS);
    });
    const config = await Promise.race([this.#config.catch(() => null), timeout]);
    clearTimeout(timer);
    return config !== null && isAllowedModelUrl(url, config);
  }

  #renderFailed(): void {
    this.#stopRelay();
    this.#takeoverLabel = "重试显示";
    this.#setStatus(STATUS.renderFailed, false);
  }

  #setStatus(status: string, connected: boolean): void {
    this.#status = status;
    this.#connected = connected;
    this.#emit();
  }

  #buildView(): DisplayView {
    const scene = this.#state.scene;
    return {
      status: this.#status,
      connected: this.#connected,
      busy: this.#pairing !== null || this.#relay !== null,
      takeover: this.#sessionToken && !this.#relay && !this.#pairing ? this.#takeoverLabel : null,
      state: this.#state,
      sceneName: sceneName(scene, scene ? this.#tracker.isReady(scene.key) : false),
      seq: this.#lastSeq,
    };
  }

  #emit(): void {
    this.#view = this.#buildView();
    for (const listener of this.#listeners) listener();
  }
}
