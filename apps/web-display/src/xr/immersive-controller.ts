// State machine behind the "enter WebXR" button. Capability checks happen ahead
// of time so the click handler keeps the browser's user activation; the XR store
// performs the actual requestSession.

export const IMMERSIVE_MODES = ["immersive-vr", "immersive-ar"] as const;
export type ImmersiveMode = (typeof IMMERSIVE_MODES)[number];

export const MODE_LABELS: Record<ImmersiveMode, string> = {
  "immersive-vr": "VR",
  "immersive-ar": "透视 AR",
};

/** The parts of the @react-three/xr store this controller uses. */
export interface XrStoreLike {
  getState(): { session?: { end(): Promise<void> } | null | undefined };
  enterVR(): Promise<unknown>;
  enterAR(): Promise<unknown>;
  onSessionEnd(callback: () => void): () => void;
}

export interface XrSystemLike {
  isSessionSupported(mode: ImmersiveMode): Promise<boolean>;
}

export interface ImmersiveView {
  supported: readonly ImmersiveMode[];
  mode: ImmersiveMode;
  busy: boolean;
  active: boolean;
  status: string;
}

export class ImmersiveController {
  readonly #store: XrStoreLike;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribe: () => void;
  #view: ImmersiveView = {
    supported: [],
    mode: "immersive-vr",
    busy: false,
    active: false,
    status: "正在检查头显支持",
  };

  constructor(store: XrStoreLike, xr: XrSystemLike | undefined) {
    this.#store = store;
    this.#unsubscribe = store.onSessionEnd(() => this.#update({ active: false, status: "已返回桌面视图" }));
    if (!xr) {
      this.#update({ status: "当前浏览器不支持沉浸模式，可继续桌面调试" });
      return;
    }
    Promise.all(IMMERSIVE_MODES.map((mode) => xr.isSessionSupported(mode))).then(
      (available) => {
        const supported = IMMERSIVE_MODES.filter((_, index) => available[index]);
        this.#update({
          supported,
          mode: supported[0] ?? "immersive-vr",
          status: supported.length ? "可进入沉浸模式" : "未检测到可用头显，可继续桌面调试",
        });
      },
      () => this.#update({ status: "无法检查头显支持，请刷新后重试" }),
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getView = (): ImmersiveView => this.#view;

  setMode(mode: ImmersiveMode): void {
    if (this.#view.busy || this.#view.active || !this.#view.supported.includes(mode)) return;
    this.#update({ mode });
  }

  async toggle(): Promise<void> {
    const { busy, active, mode, supported } = this.#view;
    if (busy || !supported.includes(mode)) return;
    this.#update({ busy: true });
    try {
      const session = this.#store.getState().session;
      if (active || session) {
        await session?.end();
        this.#update({ active: false });
        return;
      }
      const entered = mode === "immersive-ar" ? await this.#store.enterAR() : await this.#store.enterVR();
      if (!entered) throw new Error("no session");
      this.#update({ active: true, status: `${MODE_LABELS[mode]} 中；可用系统菜单退出` });
    } catch {
      this.#update({
        active: Boolean(this.#store.getState().session),
        status: "未能进入或退出沉浸模式，请在头显确认权限后重试",
      });
    } finally {
      this.#update({ busy: false });
    }
  }

  dispose(): void {
    this.#unsubscribe();
    this.#listeners.clear();
  }

  #update(patch: Partial<ImmersiveView>): void {
    this.#view = { ...this.#view, ...patch };
    for (const listener of this.#listeners) listener();
  }
}
