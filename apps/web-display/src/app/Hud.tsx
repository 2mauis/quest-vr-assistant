import { useRef, useSyncExternalStore } from "react";
import type { DisplaySession } from "../session/display-session.ts";
import {
  IMMERSIVE_MODES,
  MODE_LABELS,
  type ImmersiveController,
  type ImmersiveMode,
} from "../xr/immersive-controller.ts";

function isImmersiveMode(value: string): value is ImmersiveMode {
  return (IMMERSIVE_MODES as readonly string[]).includes(value);
}

export function Hud({ session, immersive }: { session: DisplaySession; immersive: ImmersiveController }) {
  const view = useSyncExternalStore(session.subscribe, session.getView);
  const xr = useSyncExternalStore(immersive.subscribe, immersive.getView);
  const token = useRef<HTMLInputElement>(null);
  const xrUnavailable = xr.supported.length === 0;

  const connect = () => {
    const input = token.current;
    if (!input) return;
    const value = input.value;
    input.value = "";
    void session.connect(value);
  };

  return (
    <form className="hud" id="hud" onSubmit={(event) => event.preventDefault()}>
      <label>
        配对口令
        <input id="token" name="token" type="password" autoComplete="off" required disabled={view.busy} ref={token} />
      </label>
      <button type="button" id="connect" disabled={view.busy} onClick={connect}>
        连接
      </button>
      <button type="button" id="disconnect" disabled={!view.busy} onClick={() => session.disconnect()}>
        断开
      </button>
      <button type="button" id="takeover" hidden={view.takeover === null} onClick={() => session.takeover()}>
        {view.takeover ?? ""}
      </button>
      <label>
        沉浸模式
        <select
          id="xr-mode"
          value={xr.mode}
          disabled={xr.busy || xr.active || xrUnavailable}
          onChange={(event) => {
            if (isImmersiveMode(event.target.value)) immersive.setMode(event.target.value);
          }}
        >
          {IMMERSIVE_MODES.map((mode) => (
            <option key={mode} value={mode} disabled={!xr.supported.includes(mode)}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" id="xr" disabled={xr.busy || xrUnavailable} onClick={() => void immersive.toggle()}>
        {xr.active ? "退出沉浸模式" : `进入 ${MODE_LABELS[xr.mode]}`}
      </button>
      <span id="status" role="status">
        {view.status}
      </span>
      <span id="xr-status" role="status">
        {xr.status}
      </span>
    </form>
  );
}
