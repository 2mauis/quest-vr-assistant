// Relay core: display pairing, the single active display socket, the ordered
// command buffer and the idempotent tool results. `delivered: true` is only
// produced by an ACK from the active display.
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { createRateLimiter } from "../../../shared/node/rate-limit.ts";
import { CLOSE_CODES, WIRE_VERSION, isIdentifier } from "../../../shared/protocol/index.ts";
import { validateToolCall } from "../../vr-mcp-server/src/index.ts";
import { createDeviceGrants } from "./device-grants.ts";
import { safeEqual } from "./security.ts";

/**
 * @import { RawData } from "ws"
 * @import { RelayConfig } from "./config.ts"
 * @import { DeviceGrant } from "./device-grants.ts"
 * @import { ToolCaller, ToolOutcome } from "../../vr-mcp-server/src/index.ts"
 * @import { CommandBodies, RenderPanelBody, ShowSceneBody, ToolName, ToolResult, ToolStatus } from "../../../shared/protocol/index.ts"
 */

/**
 * @typedef {{ sessionId: string, expiresAt: number }} DisplaySession
 * @typedef {{ v: 1, session_id: string, request_id: string, seq: number, type: ToolName, body: CommandBodies[ToolName], at: number }} BufferedCommand
 * @typedef {{ hash: string, at: number, payload: ToolResult, promise: Promise<ToolOutcome> }} IdempotencyRecord
 * @typedef {{ request_id: string, kind: "select" | "activate", target_id: string, at: number }} Interaction
 * @typedef {{ ok: true, status: 200, body: Record<string, unknown> } | { ok: false, status: 401 | 429 }} PairOutcome
 */

/** Stable key for "same request_id, same content" checks. @param {unknown} value @returns {string} */
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {string} requestId
 * @param {ToolStatus} status
 * @param {number} seq
 * @param {boolean} delivered
 * @param {string | null} errorCode
 * @returns {ToolResult}
 */
function result(requestId, status, seq, delivered, errorCode) {
  return { request_id: requestId, status, seq, delivered, error_code: errorCode };
}

/**
 * @param {RelayConfig} config
 * @param {() => number} [clock]
 */
export function createHub(config, clock = Date.now) {
  const now = () => clock();
  const deviceId = `d${randomBytes(16).toString("hex")}`;
  /** @type {Map<string, DisplaySession>} */
  const sessions = new Map();
  const grants = createDeviceGrants(config);
  /** @type {BufferedCommand[]} */
  const buffer = [];
  /** @type {Map<string, IdempotencyRecord>} */
  const idempotency = new Map();
  /** @type {Map<number, () => void>} */
  const waiters = new Map();
  /** @type {Interaction[]} */
  const interactions = [];
  let nextSeq = 1;
  let ackedSeq = 0;
  /** @type {ShowSceneBody | null} */
  let scene = null;
  /** @type {Map<string, RenderPanelBody>} */
  const panels = new Map();
  /** @type {WebSocket | null} */
  let socket = null;
  let draining = false;
  let pairingFailures = 0;
  let pairingLockedUntil = 0;
  const allowPair = createRateLimiter(config.pairingRatePerMinute, 60_000);
  const allowRefresh = createRateLimiter(60, 60_000);

  /** @param {number} at @param {DeviceGrant | null} grant @returns {PairOutcome} */
  function issueSession(at, grant) {
    const sessionToken = randomBytes(32).toString("hex");
    const sessionId = `s${randomBytes(12).toString("hex")}`;
    sessions.set(sessionToken, { sessionId, expiresAt: at + config.sessionTtlMs });
    return {
      ok: true,
      status: 200,
      body: {
        session_id: sessionId,
        session_token: sessionToken,
        expires_in: Math.floor(config.sessionTtlMs / 1000),
        ...(grant
          ? { refresh_token: grant.token, refresh_expires_in: Math.floor((grant.expiresAt - at) / 1000) }
          : {}),
      },
    };
  }

  function highWater() {
    return nextSeq - 1;
  }

  function prune(at = now()) {
    while (buffer.length > 0 && at - (buffer[0]?.at ?? at) > config.queueTtlMs) {
      const expired = /** @type {BufferedCommand} */ (buffer.shift());
      const record = idempotency.get(expired.request_id);
      if (record && record.payload.seq === expired.seq && record.payload.delivered !== true) {
        record.payload = { ...record.payload, status: "expired", delivered: false, error_code: "expired" };
      }
    }
    for (const [key, record] of idempotency) {
      if (at - record.at > config.idempotencyTtlMs) idempotency.delete(key);
    }
    for (const [token, session] of sessions) {
      if (session.expiresAt <= at) sessions.delete(token);
    }
  }

  /** @param {string} token @returns {DisplaySession | null} */
  function findSession(token, at = now()) {
    prune(at);
    /** @type {DisplaySession | null} */
    let found = null;
    // Compare against every stored token so timing does not reveal a prefix match.
    for (const [stored, session] of sessions) {
      if (safeEqual(stored, token) && session.expiresAt > at) found = session;
    }
    return found;
  }

  /** @param {WebSocket | null} ws @param {Record<string, unknown>} message */
  function send(ws, message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  /** @param {string} type @param {Record<string, unknown>} body @param {string} [requestId] */
  function control(type, body = {}, requestId = "") {
    return { v: WIRE_VERSION, session_id: deviceId, request_id: requestId, seq: 0, type, body };
  }

  /** @param {unknown} seq */
  function resolveAck(seq) {
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq <= ackedSeq || seq > highWater()) return;
    ackedSeq = seq;
    for (const record of idempotency.values()) {
      if (record.payload.seq > 0 && record.payload.seq <= ackedSeq && record.payload.delivered !== true) {
        record.payload = { ...record.payload, status: "rendered", delivered: true, error_code: null };
      }
    }
    for (const [waitingSeq, finish] of waiters) {
      if (waitingSeq <= ackedSeq) {
        waiters.delete(waitingSeq);
        finish();
      }
    }
  }

  /** @param {WebSocket} ws @param {number} lastSeq */
  function replay(ws, lastSeq) {
    prune();
    const pending = buffer.filter((item) => item.seq > lastSeq);
    const gap =
      lastSeq > highWater() ||
      (lastSeq < highWater() && (pending.length === 0 || pending[0]?.seq !== lastSeq + 1));
    if (gap) {
      send(ws, {
        v: WIRE_VERSION,
        session_id: deviceId,
        request_id: "",
        seq: highWater(),
        type: "snapshot",
        body: { scene, panels: [...panels.values()], reason: "gap" },
      });
      return;
    }
    for (const item of pending) {
      send(ws, {
        v: WIRE_VERSION,
        session_id: item.session_id,
        request_id: item.request_id,
        seq: item.seq,
        type: item.type,
        body: item.body,
      });
    }
  }

  /** @param {string} requestId */
  function findPayload(requestId) {
    return idempotency.get(requestId)?.payload ?? result(requestId, "queued", 0, false, null);
  }

  /**
   * @param {string} requestId
   * @param {ToolName} type
   * @param {CommandBodies[ToolName]} body
   * @returns {{ error: ToolResult } | { payload: ToolResult, wait?: Promise<ToolResult> }}
   */
  function enqueue(requestId, type, body) {
    if (buffer.length >= config.queueMaxMessages) {
      return { error: result(requestId, "rejected", 0, false, "queue_full") };
    }
    const seq = nextSeq;
    nextSeq += 1;
    buffer.push({ v: WIRE_VERSION, session_id: deviceId, request_id: requestId, seq, type, body, at: now() });
    const payload = result(requestId, "queued", seq, false, null);
    const delivered = send(socket, { v: WIRE_VERSION, session_id: deviceId, request_id: requestId, seq, type, body });
    if (!delivered) return { payload };
    return {
      payload,
      wait: new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(seq);
          resolve({ ...findPayload(requestId) });
        }, config.ackWaitMs);
        waiters.set(seq, () => {
          clearTimeout(timer);
          const record = idempotency.get(requestId);
          if (record) record.payload = result(requestId, "rendered", seq, true, null);
          resolve(result(requestId, "rendered", seq, true, null));
        });
      }),
    };
  }

  /** @param {ToolName} type @param {CommandBodies[ToolName]} body */
  function applyState(type, body) {
    if (type === "show_scene") {
      scene = /** @type {ShowSceneBody} */ (body);
      return;
    }
    if (type === "render_panel") {
      const panel = /** @type {RenderPanelBody} */ (body);
      panels.set(panel.panel_id, panel);
      return;
    }
    const { scope, panel_id: panelId } = /** @type {CommandBodies["clear"]} */ (body);
    if (scope === "all" || scope === "scene") scene = null;
    if (scope === "all") panels.clear();
    if (scope === "panel" && panelId) panels.delete(panelId);
  }

  /** @param {WebSocket} ws @param {Record<string, unknown>} message */
  function recordInteraction(ws, message) {
    const requestId = message.request_id;
    const body = /** @type {Record<string, unknown> | undefined} */ (message.body);
    const kind = body?.kind;
    const targetId = body?.target_id;
    if (!isIdentifier(requestId) || (kind !== "select" && kind !== "activate") || !isIdentifier(targetId)) {
      send(ws, control("interaction_rejected", {}, typeof requestId === "string" ? requestId : ""));
      return;
    }
    interactions.push({ request_id: requestId, kind, target_id: targetId, at: now() });
    if (interactions.length > 50) interactions.shift();
    send(ws, control("interaction_ok", {}, requestId));
  }

  /** @param {unknown} value */
  function validLastSeq(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }

  /** @type {ToolCaller["call"]} */
  async function call(name, args) {
    prune();
    const rawRequestId = typeof args === "object" && args !== null ? Reflect.get(args, "request_id") : undefined;
    if (draining) {
      const requestId = typeof rawRequestId === "string" ? rawRequestId : "";
      return { isError: true, payload: result(requestId, "offline", 0, false, "draining") };
    }
    const validated = validateToolCall(name, args, config);
    if (!validated.ok) {
      const requestId = isIdentifier(rawRequestId) ? rawRequestId : "";
      return { isError: true, payload: result(requestId, "rejected", 0, false, validated.error_code) };
    }
    const hash = canonicalize({ name, body: validated.body });
    const existing = idempotency.get(validated.request_id);
    if (existing) {
      if (existing.hash !== hash) {
        return {
          isError: true,
          payload: result(validated.request_id, "rejected", 0, false, "idempotency_conflict"),
        };
      }
      return existing.promise.then(() => ({
        isError: existing.payload.status === "rejected" || existing.payload.status === "offline",
        payload: { ...existing.payload },
      }));
    }
    /** @type {(outcome: ToolOutcome) => void} */
    let resolveRecord = () => {};
    /** @type {Promise<ToolOutcome>} */
    const promise = new Promise((resolve) => {
      resolveRecord = resolve;
    });
    /** @type {IdempotencyRecord} */
    const record = { hash, at: now(), payload: result(validated.request_id, "queued", 0, false, null), promise };
    idempotency.set(validated.request_id, record);
    const queued = enqueue(validated.request_id, validated.type, validated.body);
    if ("error" in queued) {
      idempotency.delete(validated.request_id);
      resolveRecord({ isError: true, payload: queued.error });
      return record.promise;
    }
    applyState(validated.type, validated.body);
    record.payload = queued.payload;
    if (!queued.wait) {
      resolveRecord({ isError: false, payload: record.payload });
      return record.promise;
    }
    void queued.wait.then((payload) => {
      record.payload = payload;
      resolveRecord({ isError: payload.status === "rejected", payload });
    });
    return record.promise;
  }

  return {
    deviceId,
    prune,
    highWater,
    call,
    displayConnected() {
      return Boolean(socket && socket.readyState === WebSocket.OPEN);
    },
    draining() {
      return draining;
    },
    interactions() {
      return interactions.map((item) => ({ ...item }));
    },
    /** @param {unknown} token @param {number} [at] @param {boolean} [remember] @returns {PairOutcome} */
    pair(token, at = now(), remember = false) {
      prune(at);
      if (at < pairingLockedUntil) return { ok: false, status: 429 };
      if (!allowPair(at)) return { ok: false, status: 429 };
      const presented = typeof token === "string" ? token : "";
      const matches = safeEqual(presented, config.devicePairingToken);
      if (!presented || !matches) {
        pairingFailures += 1;
        if (pairingFailures >= config.pairingMaxAttempts) {
          pairingLockedUntil = at + config.pairingTtlMs;
          pairingFailures = 0;
        }
        return { ok: false, status: 401 };
      }
      pairingFailures = 0;
      pairingLockedUntil = 0;
      return issueSession(at, remember ? grants.issue(at) : null);
    },
    /** @param {unknown} token @param {number} [at] @returns {PairOutcome} */
    refresh(token, at = now()) {
      prune(at);
      if (!allowRefresh(at)) return { ok: false, status: 429 };
      const grant = grants.verify(token, at);
      if (!grant) return { ok: false, status: 401 };
      return issueSession(at, grants.issue(at, grant.subject));
    },
    /** @param {string} token @param {number} [at] */
    authorizeSocket(token, at = now()) {
      return findSession(token, at);
    },
    /** @param {WebSocket} ws */
    attach(ws) {
      let authed = false;
      let lastTraffic = now();
      const heartbeat = setInterval(() => {
        if (now() - lastTraffic > 60_000) {
          ws.close(CLOSE_CODES.timeout, "timeout");
          return;
        }
        send(ws, control("ping"));
      }, 25_000);
      const authTimer = setTimeout(() => {
        if (!authed) ws.close(CLOSE_CODES.unauthorized, "auth_timeout");
      }, 5_000);
      /** @param {RawData} data @param {boolean} isBinary */
      const onMessage = (data, isBinary) => {
        lastTraffic = now();
        const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (isBinary || raw.length > config.bodyLimit) {
          ws.close(CLOSE_CODES.messageTooBig, "invalid");
          return;
        }
        /** @type {unknown} */
        let parsed;
        try {
          parsed = JSON.parse(raw.toString("utf8"));
        } catch {
          ws.close(CLOSE_CODES.unsupportedData, "invalid");
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          ws.close(CLOSE_CODES.unsupportedData, "invalid");
          return;
        }
        const message = /** @type {Record<string, unknown>} */ (parsed);
        if (message.v !== WIRE_VERSION || typeof message.type !== "string") {
          ws.close(CLOSE_CODES.unsupportedData, "invalid");
          return;
        }
        const body = /** @type {Record<string, unknown> | undefined} */ (message.body);
        if (!authed) {
          if (message.type !== "auth") {
            ws.close(CLOSE_CODES.unauthorized, "auth");
            return;
          }
          const token = body?.session_token;
          const session = typeof token === "string" ? findSession(token) : null;
          if (!session) {
            ws.close(CLOSE_CODES.unauthorized, "auth");
            return;
          }
          const lastSeq = body?.last_seq;
          if (!validLastSeq(lastSeq)) {
            ws.close(CLOSE_CODES.unsupportedData, "invalid");
            return;
          }
          authed = true;
          clearTimeout(authTimer);
          // A pending or invalid handshake must not evict the active display.
          const previous = socket;
          socket = ws;
          if (previous && previous !== ws) previous.close(CLOSE_CODES.replaced, "replaced");
          send(ws, {
            v: WIRE_VERSION,
            session_id: deviceId,
            request_id: "",
            seq: highWater(),
            type: "auth_ok",
            body: { session_id: session.sessionId },
          });
          replay(ws, /** @type {number} */ (lastSeq));
          return;
        }
        if (socket !== ws) return;
        switch (message.type) {
          case "ping":
            send(ws, control("pong"));
            return;
          case "ack":
            resolveAck(message.seq);
            return;
          case "resume":
            if (validLastSeq(body?.last_seq)) replay(ws, /** @type {number} */ (body?.last_seq));
            return;
          case "interaction":
            recordInteraction(ws, message);
            return;
          default:
            return;
        }
      };
      const detach = () => {
        clearInterval(heartbeat);
        clearTimeout(authTimer);
        if (socket === ws) socket = null;
      };
      ws.on("message", onMessage);
      ws.on("close", detach);
      ws.on("error", detach);
    },
    state() {
      return { scene, panels: [...panels.values()], seq: highWater() };
    },
    drain() {
      draining = true;
      if (socket) socket.close(CLOSE_CODES.goingAway, "draining");
    },
  };
}

/** @typedef {ReturnType<typeof createHub>} Hub */
