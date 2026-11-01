// Display WebSocket client. Rendering is delegated to the React tree; this module
// keeps pairing, replay, single-connection takeover and ordered ACKs.

function publishDom(state) {
  document.body.dataset.connected = state.connected ? "1" : "0";
  document.body.dataset.scene = state.sceneName;
  document.body.dataset.panels = String(state.panels.length);
  document.body.dataset.seq = String(state.seq);
}

export function createDisplaySession() {
  const listeners = new Set();
  let socket = null;
  let sessionToken = "";
  let wantConnected = false;
  let reconnectAttempt = 0;
  let reconnectTimer = 0;
  let pairing = null;
  let lastSeq = 0;
  let assetOrigins = [];
  let commands = Promise.resolve();
  const paintWaiters = [];
  let assetWaiter = null;
  let paintGeneration = 0;
  const state = {
    status: "未连接",
    connected: false,
    sceneName: "",
    panels: [],
    seq: 0,
    scene: null,
    paintGeneration: 0,
    takeoverVisible: false,
    takeoverLabel: "切回此设备",
    connectDisabled: false,
    tokenDisabled: false,
    disconnectDisabled: true,
  };

  const assetConfig = fetch("/api/display/config").then((response) => response.json()).then((config) => {
    assetOrigins = config.asset_origins || [];
  }).catch(() => {});

  function snapshot() {
    return state;
  }

  function emit() {
    publishDom(state);
    const copy = { ...state, panels: state.panels.slice(), scene: state.scene ? { ...state.scene } : null };
    for (const listener of listeners) listener(copy);
  }

  function setStatus(text, connected) {
    state.status = text;
    state.connected = connected;
    emit();
  }

  function updateButtons() {
    state.connectDisabled = Boolean(pairing) || wantConnected;
    state.tokenDisabled = state.connectDisabled;
    state.disconnectDisabled = !pairing && !wantConnected;
    state.takeoverVisible = Boolean(sessionToken) && !wantConnected && !pairing;
    emit();
  }

  function rememberSeq(seq, reset = false) {
    if (!Number.isInteger(seq) || seq < 0 || (!reset && seq < lastSeq)) return;
    lastSeq = seq;
    state.seq = lastSeq;
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  function notePaint(generation) {
    for (let index = paintWaiters.length - 1; index >= 0; index -= 1) {
      if (paintWaiters[index].generation === generation) {
        paintWaiters[index].resolve();
        paintWaiters.splice(index, 1);
      }
    }
  }

  function waitPaint() {
    const generation = paintGeneration;
    return new Promise((resolve) => {
      paintWaiters.push({ generation, resolve });
    });
  }

  function bumpPaint() {
    paintGeneration += 1;
    state.paintGeneration = paintGeneration;
    emit();
    return waitPaint();
  }

  function assetReady(generation) {
    if (assetWaiter?.generation === generation) {
      const resolve = assetWaiter.resolve;
      assetWaiter = null;
      resolve();
    }
  }

  function assetFailed(generation) {
    if (assetWaiter?.generation === generation) {
      const reject = assetWaiter.reject;
      assetWaiter = null;
      reject(new Error("model_failed"));
    }
  }

  function waitAsset(generation) {
    return new Promise((resolve, reject) => {
      assetWaiter = { generation, resolve, reject };
    });
  }

  function allowedModelUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && assetOrigins.includes(url.origin);
    } catch {
      return false;
    }
  }

  function send(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function select(targetId) {
    if (!state.connected || !targetId) return;
    send({
      v: 1,
      type: "interaction",
      request_id: `select_${crypto.randomUUID()}`,
      seq: 0,
      body: { kind: "select", target_id: targetId },
    });
  }

  async function showScene(body, isCurrent) {
    if (body.preset) {
      state.scene = {
        key: `preset:${body.preset}:${paintGeneration + 1}`,
        preset: body.preset,
        modelUrl: "",
        anchor: body.anchor,
        pose: body.pose,
        targetId: body.preset,
      };
      state.sceneName = body.preset;
      return;
    }
    await assetConfig;
    if (!isCurrent()) return;
    if (!allowedModelUrl(body.model_url)) throw new Error("model_origin");
    const generation = paintGeneration + 1;
    state.scene = {
      key: `model:${body.model_url}:${generation}`,
      preset: "",
      modelUrl: body.model_url,
      anchor: body.anchor,
      pose: body.pose,
      targetId: "model",
      generation,
    };
    state.sceneName = "";
    emit();
    await waitAsset(generation);
    if (!isCurrent()) return;
    state.sceneName = "model";
  }

  function renderPanel(body) {
    const next = state.panels.filter((panel) => panel.panel_id !== body.panel_id);
    next.push({ ...body, key: `${body.panel_id}:${paintGeneration + 1}:${body.text}` });
    state.panels = next;
  }

  function applyClear(body) {
    if (body.scope === "all" || body.scope === "scene") {
      state.scene = null;
      state.sceneName = "";
    }
    if (body.scope === "all") state.panels = [];
    if (body.scope === "panel" && body.panel_id) {
      state.panels = state.panels.filter((panel) => panel.panel_id !== body.panel_id);
    }
  }

  async function applySnapshot(body, isCurrent) {
    state.scene = null;
    state.sceneName = "";
    state.panels = [];
    if (body.scene) await showScene(body.scene, isCurrent);
    if (!isCurrent()) return;
    for (const panel of body.panels || []) renderPanel(panel);
  }

  async function onDisplayMessage(message, source) {
    const isCurrent = () => socket === source && wantConnected;
    if (!isCurrent()) return;
    if (message.type === "snapshot") {
      await applySnapshot(message.body || {}, isCurrent);
    } else if (message.type === "show_scene") {
      await showScene(message.body, isCurrent);
    } else if (message.type === "render_panel") {
      renderPanel(message.body);
    } else if (message.type === "clear") {
      applyClear(message.body || {});
    } else {
      return;
    }
    if (!isCurrent()) return;
    await bumpPaint();
    if (!isCurrent()) return;
    rememberSeq(message.seq, message.type === "snapshot");
    emit();
    if (message.type !== "snapshot") {
      send({ v: 1, type: "ack", request_id: message.request_id, seq: message.seq, body: {} });
    }
  }

  function stopConnection(text, forget = true) {
    wantConnected = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = 0;
    pairing?.abort();
    pairing = null;
    if (forget) sessionToken = "";
    const previous = socket;
    socket = null;
    previous?.close(1000, "bye");
    if (assetWaiter) {
      assetWaiter.reject(new Error("stopped"));
      assetWaiter = null;
    }
    setStatus(text, false);
    updateButtons();
  }

  function scheduleReconnect() {
    if (!wantConnected || reconnectTimer) return;
    const steps = [1000, 2000, 4000, 8000, 16000, 30000];
    const base = steps[Math.min(reconnectAttempt, steps.length - 1)];
    reconnectAttempt += 1;
    setStatus("正在重连", false);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      openSocket();
    }, base * (0.8 + Math.random() * 0.4));
  }

  function openSocket() {
    if (!wantConnected || !sessionToken || socket) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const next = new WebSocket(`${protocol}//${location.host}/ws`);
    socket = next;
    let heartbeat = 0;
    let watchdog = 0;
    commands = Promise.resolve();
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => next.close(), 60_000);
    };
    setStatus("正在连接", false);
    updateButtons();
    next.addEventListener("open", () => {
      if (socket !== next) return;
      setStatus("正在验证配对", false);
      send({
        v: 1, type: "auth", request_id: "", seq: 0,
        body: { session_token: sessionToken, last_seq: lastSeq },
      });
      arm();
      heartbeat = setInterval(() => {
        if (socket === next) send({ v: 1, type: "ping", request_id: "", seq: 0, body: {} });
      }, 25_000);
    });
    next.addEventListener("message", (event) => {
      if (socket !== next) return;
      arm();
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "auth_ok") {
        reconnectAttempt = 0;
        setStatus("显示中", true);
        return;
      }
      if (message.type === "ping") {
        send({ v: 1, type: "pong", request_id: "", seq: 0, body: {} });
        return;
      }
      commands = commands.then(() => onDisplayMessage(message, next)).catch(() => {
        if (socket !== next) return;
        state.takeoverLabel = "重试显示";
        stopConnection("渲染失败，未确认显示；请检查模型后重试", false);
      });
    });
    next.addEventListener("close", (event) => {
      clearInterval(heartbeat);
      clearTimeout(watchdog);
      if (socket !== next) return;
      socket = null;
      if (event.code === 4401) {
        stopConnection("需要重新配对");
      } else if (event.code === 4410) {
        state.takeoverLabel = "切回此设备";
        stopConnection("已切换到另一设备", false);
      } else {
        scheduleReconnect();
      }
    });
  }

  async function connect(token) {
    if (pairing || wantConnected) return;
    const request = new AbortController();
    pairing = request;
    setStatus("正在配对", false);
    updateButtons();
    try {
      const response = await fetch("/api/device/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
        signal: request.signal,
      });
      if (!response.ok) {
        setStatus(response.status === 429 ? "配对受限，请稍后重试" : "配对口令错误", false);
        return;
      }
      const body = await response.json();
      if (pairing !== request) return;
      sessionToken = body.session_token;
      state.scene = null;
      state.sceneName = "";
      state.panels = [];
      lastSeq = 0;
      state.seq = 0;
      wantConnected = true;
      reconnectAttempt = 0;
      openSocket();
    } catch {
      if (!request.signal.aborted) setStatus("无法连接中继，请检查服务与 USB 转发", false);
    } finally {
      if (pairing === request) pairing = null;
      updateButtons();
    }
  }

  function adoptSession(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
    if (wantConnected && sessionToken === token && socket) return true;
    sessionToken = token;
    wantConnected = true;
    reconnectAttempt = 0;
    if (!socket) openSocket();
    updateButtons();
    return true;
  }

  function disconnectForTest() {
    if (socket) socket.close(4000, "test");
  }

  emit();
  return {
    subscribe,
    snapshot,
    connect,
    disconnect: () => stopConnection("未连接"),
    takeover() {
      wantConnected = true;
      reconnectAttempt = 0;
      openSocket();
    },
    select,
    notePaint,
    assetReady,
    assetFailed,
    adoptSession,
    disconnectForTest,
  };
}
