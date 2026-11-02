// Display WebSocket envelope (`/ws`). Every frame is one JSON object.
import type { ClearBody, RenderPanelBody, ShowSceneBody } from "./tools.ts";

export const WIRE_VERSION = 1;

export const CLOSE_CODES = {
  normal: 1000,
  goingAway: 1001,
  unsupportedData: 1003,
  messageTooBig: 1009,
  unauthorized: 4401,
  timeout: 4408,
  replaced: 4410,
} as const;

export interface Envelope<Type extends string, Body> {
  v: typeof WIRE_VERSION;
  session_id?: string;
  request_id: string;
  seq: number;
  type: Type;
  body: Body;
}

export interface SceneSnapshot {
  scene: ShowSceneBody | null;
  panels: RenderPanelBody[];
  reason: "gap";
}

export type CommandMessage =
  | Envelope<"show_scene", ShowSceneBody>
  | Envelope<"render_panel", RenderPanelBody>
  | Envelope<"clear", ClearBody>;

export type SnapshotMessage = Envelope<"snapshot", SceneSnapshot>;

export type DownlinkMessage =
  | CommandMessage
  | SnapshotMessage
  | Envelope<"auth_ok", { session_id: string }>
  | Envelope<"ping" | "pong" | "interaction_ok" | "interaction_rejected", Record<string, never>>;

export type InteractionKind = "select" | "activate";

export type UplinkMessage =
  | Envelope<"auth", { session_token: string; last_seq: number }>
  | Envelope<"ack", Record<string, never>>
  | Envelope<"resume", { last_seq: number }>
  | Envelope<"interaction", { kind: InteractionKind; target_id: string }>
  | Envelope<"ping" | "pong", Record<string, never>>;
