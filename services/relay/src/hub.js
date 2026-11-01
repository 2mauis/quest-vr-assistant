import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { safeEqual } from "./security.js";
import { validateToolCall, wireMessage } from "../../vr-mcp-server/src/tools.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function createLimiter(limit, windowMs) {
  const hits = [];
  return (now) => {
    while (hits.length > 0 && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createHub(config, clock = Date.now) {
  const now = () => clock();
  const deviceId = `d${randomBytes(16).toString("hex")}`;
  const sessions = new Map();
  const buffer = [];
  const idempotency = new Map();
  const waiters = new Map();
  const interactions = [];
  let nextSeq = 1;
  let ackedSeq = 0;
  let scene = null;
  const panels = new Map();
  let socket = null;
  let draining = false;
  let pairingFailures = 0;
  let pairingLockedUntil = 0;
  const allowPair = createLimiter(config.pairingRatePerMinute, 60_000);

  function highWater() {
    return nextSeq - 1;
  }

  function prune(at = now()) {
    while (buffer.length > 0 && at - buffer[0].at > config.queueTtlMs) {
      const expired = buffer.shift();
      const record = idempotency.get(expired.request_id);
      if (record && record.payload.seq === expired.seq && record.payload.delivered !== true) {
        record.payload = {
          ...record.payload,
          status: "expired",
          delivered: false,
          error_code: "expired",
        };
      }
    }
    for (const [key, record] of idempotency) {
      if (at - record.at > config.idempotencyTtlMs) idempotency.delete(key);
    }
    for (const [token, session] of sessions) {
      if (session.expiresAt <= at) sessions.delete(token);
    }
  }

  function result(requestId, status, seq, delivered, errorCode) {
    return {
      request_id: requestId,
      status,
      seq,
      delivered,
      error_code: errorCode,
    };
  }

  function findSession(token, at = now()) {
    prune(at);
    let found = null;
    for (const [stored, session] of sessions) {
      if (safeEqual(stored, token) && session.expiresAt > at) found = session;
    }
    return found;
  }

  function snapshotBody() {
    return {
      scene,
      panels: [...panels.values()],
      reason: "gap",
    };
  }

  function send(ws, message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  function broadcast(message) {
    return send(socket, message);
  }

  function resolveAck(seq) {
    if (!Number.isInteger(seq) || seq <= ackedSeq || seq > highWater()) return;
    ackedSeq = seq;
    for (const record of idempotency.values()) {
      if (record.payload.seq > 0 && record.payload.seq <= ackedSeq && record.payload.delivered !== true) {
        record.payload = {
          ...record.payload,
          status: "rendered",
          delivered: true,
          error_code: null,
        };
      }
    }
    for (const [waitingSeq, finish] of waiters) {
      if (waitingSeq <= ackedSeq) {
        waiters.delete(waitingSeq);
        finish();
      }
    }
  }

  function replay(ws, lastSeq) {
    prune();
    const pending = buffer.filter((item) => item.seq > lastSeq);
    const gap = lastSeq > highWater()
      || (lastSeq < highWater() && (pending.length === 0 || pending[0].seq !== lastSeq + 1));
    if (gap) {
      send(ws, {
        v: 1,
        session_id: deviceId,
        request_id: "",
        seq: highWater(),
        type: "snapshot",
        body: snapshotBody(),
      });
      return;
    }
    for (const item of pending) {
      send(ws, {
        v: 1,
        session_id: item.session_id,
        request_id: item.request_id,
        seq: item.seq,
        type: item.type,
        body: item.body,
      });
    }
  }

  function enqueue(requestId, type, body) {
    if (buffer.length >= config.queueMaxMessages) {
      return { error: result(requestId, "rejected", 0, false, "queue_full") };
    }
    const seq = nextSeq;
    nextSeq += 1;
    const message = {
      v: 1,
      session_id: deviceId,
      request_id: requestId,
      seq,
      type,
      body,
      at: now(),
    };
    buffer.push(message);
    const payload = result(requestId, "queued", seq, false, null);
    const delivered = broadcast({
      v: 1,
      session_id: deviceId,
      request_id: requestId,
      seq,
      type,
      body,
    });
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
          if (record) {
            record.payload = result(requestId, "rendered", seq, true, null);
          }
          resolve(result(requestId, "rendered", seq, true, null));
        });
      }),
    };
  }

  function findPayload(requestId) {
    return idempotency.get(requestId)?.payload ?? result(requestId, "queued", 0, false, null);
  }

  function applyState(type, body) {
    if (type === "show_scene") {
      scene = body;
      return;
    }
    if (type === "render_panel") {
      panels.set(body.panel_id, body);
      return;
    }
    if (type === "clear") {
      if (body.scope === "all" || body.scope === "scene") scene = null;
      if (body.scope === "all") panels.clear();
      if (body.scope === "panel") panels.delete(body.panel_id);
    }
  }

  return {
    deviceId,
    prune,
    highWater,
    displayConnected() {
      return Boolean(socket && socket.readyState === WebSocket.OPEN);
    },
    draining() {
      return draining;
    },
    interactions() {
      return interactions.map((item) => ({ ...item }));
    },
    pair(token, at = now()) {
      prune(at);
      if (at < pairingLockedUntil) {
        return { ok: false, status: 429 };
      }
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
        },
      };
    },
    authorizeSocket(token, at = now()) {
      return findSession(token, at);
    },
    attach(ws) {
      let authed = false;
      let lastTraffic = now();
      const heartbeat = setInterval(() => {
        if (now() - lastTraffic > 60_000) {
          ws.close(4408, "timeout");
          return;
        }
        send(ws, { v: 1, session_id: deviceId, request_id: "", seq: 0, type: "ping", body: {} });
      }, 25_000);
      const authTimer = setTimeout(() => {
        if (!authed) ws.close(4401, "auth_timeout");
      }, 5_000);
      ws.on("message", (data, isBinary) => {
        lastTraffic = now();
        if (isBinary || data.length > config.bodyLimit) {
          ws.close(1009, "invalid");
          return;
        }
        let message;
        try {
          message = JSON.parse(data.toString("utf8"));
        } catch {
          ws.close(1003, "invalid");
          return;
        }
        if (!message || message.v !== 1 || typeof message.type !== "string") {
          ws.close(1003, "invalid");
          return;
        }
        if (!authed) {
          if (message.type !== "auth") {
            ws.close(4401, "auth");
            return;
          }
          const token = message.body?.session_token;
          const session = typeof token === "string" ? findSession(token) : null;
          if (!session) {
            ws.close(4401, "auth");
            return;
          }
          const lastSeq = message.body?.last_seq;
          if (!Number.isInteger(lastSeq) || lastSeq < 0) {
            ws.close(1003, "invalid");
            return;
          }
          authed = true;
          clearTimeout(authTimer);
          // A pending or invalid handshake must not evict the active display.
          const previous = socket;
          socket = ws;
          if (previous && previous !== ws) previous.close(4410, "replaced");
          send(ws, {
            v: 1,
            session_id: deviceId,
            request_id: "",
            seq: highWater(),
            type: "auth_ok",
            body: { session_id: session.sessionId },
          });
          replay(ws, lastSeq);
          return;
        }
        if (socket !== ws) return;
        if (message.type === "pong" || message.type === "ping") {
          if (message.type === "ping") {
            send(ws, { v: 1, session_id: deviceId, request_id: "", seq: 0, type: "pong", body: {} });
          }
          return;
        }
        if (message.type === "ack") {
          resolveAck(message.seq);
          return;
        }
        if (message.type === "resume") {
          const lastSeq = message.body?.last_seq;
          if (!Number.isInteger(lastSeq) || lastSeq < 0) return;
          replay(ws, lastSeq);
          return;
        }
        if (message.type === "interaction") {
          const requestId = message.request_id;
          const kind = message.body?.kind;
          const targetId = message.body?.target_id;
          const ok = typeof requestId === "string" && ID_PATTERN.test(requestId)
            && (kind === "select" || kind === "activate")
            && typeof targetId === "string" && ID_PATTERN.test(targetId);
          if (!ok) {
            send(ws, {
              v: 1,
              session_id: deviceId,
              request_id: typeof requestId === "string" ? requestId : "",
              seq: 0,
              type: "interaction_rejected",
              body: {},
            });
            return;
          }
          interactions.push({ request_id: requestId, kind, target_id: targetId, at: now() });
          if (interactions.length > 50) interactions.shift();
          send(ws, {
            v: 1,
            session_id: deviceId,
            request_id: requestId,
            seq: 0,
            type: "interaction_ok",
            body: {},
          });
        }
      });
      const detach = () => {
        clearInterval(heartbeat);
        clearTimeout(authTimer);
        if (socket === ws) socket = null;
      };
      ws.on("close", detach);
      ws.on("error", detach);
    },
    async call(name, args) {
      prune();
      if (draining) {
        const requestId = typeof args?.request_id === "string" ? args.request_id : "";
        return { isError: true, payload: result(requestId, "offline", 0, false, "draining") };
      }
      const validated = validateToolCall(name, args, config);
      if (!validated.ok) {
        const requestId = typeof args?.request_id === "string" && ID_PATTERN.test(args.request_id)
          ? args.request_id
          : "";
        return {
          isError: true,
          payload: result(requestId, "rejected", 0, false, validated.error_code),
        };
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
      let resolveRecord;
      const promise = new Promise((resolve) => {
        resolveRecord = resolve;
      });
      const record = {
        hash,
        at: now(),
        payload: result(validated.request_id, "queued", 0, false, null),
        promise,
      };
      idempotency.set(validated.request_id, record);
      const queued = enqueue(validated.request_id, validated.type, validated.body);
      if (queued.error) {
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
      queued.wait.then((payload) => {
        record.payload = payload;
        resolveRecord({ isError: payload.status === "rejected", payload });
      });
      return record.promise;
    },
    markRenderedForTests(seq) {
      resolveAck(seq);
    },
    wirePreview(name, args) {
      return wireMessage(name, args);
    },
    state() {
      return { scene, panels: [...panels.values()], seq: highWater() };
    },
    drain() {
      draining = true;
      if (socket) socket.close(1001, "draining");
    },
  };
}
