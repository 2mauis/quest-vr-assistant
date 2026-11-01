import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { setupXR } from "./xr.js";

const ANCHORS = {
  world: { x: 0, y: 0, z: 0 },
  floor: { x: 0, y: 0, z: 0 },
  head: { x: 0, y: 1.6, z: 0 },
  front: { x: 0, y: 1.2, z: -1.2 },
  left: { x: -1.2, y: 1.2, z: -0.6 },
  right: { x: 1.2, y: 1.2, z: -0.6 },
};

const canvas = document.querySelector("#view");
const statusNode = document.querySelector("#status");
const tokenInput = document.querySelector("#token");
const connectButton = document.querySelector("#connect");
const disconnectButton = document.querySelector("#disconnect");
const takeoverButton = document.querySelector("#takeover");
const xrButton = document.querySelector("#xr");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.xr.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b14);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
camera.position.set(0, 1.6, 4.2);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2, 4, 3);
scene.add(key);
const content = new THREE.Group();
scene.add(content);
const loader = new GLTFLoader();
let sceneObject = null;
const panelObjects = new Map();
let socket = null;
let sessionToken = "";
let wantConnected = false;
let reconnectAttempt = 0;
let reconnectTimer = 0;
let pairing = null;
// A reloaded page has no rendered state, even if storage contains an old cursor.
let lastSeq = 0;
const frameWaiters = new Set();
let assetOrigins = [];
const assetConfig = fetch("/api/display/config").then((response) => response.json()).then((config) => {
  assetOrigins = config.asset_origins || [];
}).catch(() => {});

function resize() {
  if (renderer.xr.isPresenting) return;
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function setStatus(text, connected) {
  statusNode.textContent = text;
  document.body.dataset.connected = connected ? "1" : "0";
}

function place(object, anchorName, pose) {
  const anchor = ANCHORS[anchorName] || ANCHORS.world;
  object.position.set(
    anchor.x + pose.position.x,
    anchor.y + pose.position.y,
    anchor.z + pose.position.z,
  );
  object.rotation.set(
    THREE.MathUtils.degToRad(pose.rotation.x),
    THREE.MathUtils.degToRad(pose.rotation.y),
    THREE.MathUtils.degToRad(pose.rotation.z),
  );
  object.scale.setScalar(pose.scale);
}

function rememberSeq(seq, reset = false) {
  if (!Number.isInteger(seq) || seq < 0 || (!reset && seq < lastSeq)) return;
  lastSeq = seq;
  document.body.dataset.seq = String(lastSeq);
}

function publishCounts() {
  document.body.dataset.panels = String(panelObjects.size);
}

function clearSceneObject() {
  if (!sceneObject) return;
  disposeObject(sceneObject);
  sceneObject = null;
  document.body.dataset.scene = "";
}

function clearPanels() {
  for (const object of panelObjects.values()) disposeObject(object);
  panelObjects.clear();
  publishCounts();
}

function disposeObject(object) {
  object.removeFromParent();
  const resources = new Set();
  object.traverse((child) => {
    if (child.geometry) resources.add(child.geometry);
    for (const material of [].concat(child.material || [])) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) resources.add(value);
      }
      resources.add(material);
    }
  });
  for (const resource of resources) resource.dispose();
}

function makePreset(preset) {
  if (preset === "grid") return new THREE.GridHelper(4, 8, 0x335577, 0x223344);
  if (preset === "orbit") {
    const group = new THREE.Group();
    const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), material(0x3aa0ff));
    box.position.set(1.1, 1.2, 0);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), material(0xffcc55));
    sphere.position.set(-0.9, 1.5, 0.4);
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 12, 24), material(0x66e0c2));
    torus.position.set(0.2, 0.9, -0.6);
    group.add(box, sphere, torus);
    group.userData.spin = true;
    return group;
  }
  if (preset === "crystal") {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.7, 0),
      new THREE.MeshStandardMaterial({ color: 0x88ddff, metalness: 0.85, roughness: 0.15 }),
    );
    mesh.position.set(0, 1.3, 0);
    return mesh;
  }
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.25, 24),
    new THREE.MeshStandardMaterial({ color: 0x243044, metalness: 0.4, roughness: 0.5 }),
  );
  base.position.set(0, 0.12, 0);
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0xff5a1f, emissiveIntensity: 0.55, roughness: 0.35 }),
  );
  cube.position.set(0, 0.75, 0);
  group.add(base, cube);
  return group;
}

async function showScene(body, isCurrent) {
  const holder = new THREE.Group();
  place(holder, body.anchor, body.pose);
  holder.userData.targetId = body.preset || "model";
  if (body.preset) {
    holder.add(makePreset(body.preset));
    holder.userData.spin = body.preset === "orbit";
  } else {
    await assetConfig;
    if (!isCurrent()) return;
    if (!allowedModelUrl(body.model_url)) throw new Error("model_origin");
    const gltf = await loader.loadAsync(body.model_url);
    holder.add(gltf.scene);
  }
  if (!isCurrent()) {
    disposeObject(holder);
    return;
  }
  clearSceneObject();
  document.body.dataset.scene = body.preset || "model";
  content.add(holder);
  sceneObject = holder;
}

function panelTexture(title, text) {
  const panel = document.createElement("canvas");
  panel.width = 1024;
  panel.height = 512;
  const context = panel.getContext("2d");
  context.fillStyle = "rgba(8, 16, 32, 0.92)";
  context.fillRect(0, 0, panel.width, panel.height);
  context.strokeStyle = "#7fd0ff";
  context.lineWidth = 8;
  context.strokeRect(16, 16, panel.width - 32, panel.height - 32);
  context.fillStyle = "#d7f3ff";
  context.font = "48px sans-serif";
  context.fillText((title || "信息").slice(0, 40), 48, 96);
  context.font = "32px sans-serif";
  const words = text.split(/\s+/);
  let line = "";
  let y = 170;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > 900) {
      context.fillText(line, 48, y);
      line = word;
      y += 44;
      if (y > 460) break;
    } else {
      line = next;
    }
  }
  if (line && y <= 460) context.fillText(line, 48, y);
  const texture = new THREE.CanvasTexture(panel);
  texture.needsUpdate = true;
  return texture;
}

function renderPanel(body) {
  const existing = panelObjects.get(body.panel_id);
  if (existing) disposeObject(existing);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.7),
    new THREE.MeshBasicMaterial({ map: panelTexture(body.title, body.text), transparent: true }),
  );
  mesh.userData.targetId = body.panel_id;
  place(mesh, body.anchor, body.pose);
  content.add(mesh);
  panelObjects.set(body.panel_id, mesh);
  publishCounts();
}

function applyClear(body) {
  if (body.scope === "all" || body.scope === "scene") clearSceneObject();
  if (body.scope === "all") clearPanels();
  if (body.scope === "panel" && body.panel_id) {
    const existing = panelObjects.get(body.panel_id);
    if (existing) disposeObject(existing);
    panelObjects.delete(body.panel_id);
    publishCounts();
  }
}

async function applySnapshot(body, isCurrent) {
  clearSceneObject();
  clearPanels();
  if (body.scene) await showScene(body.scene, isCurrent);
  if (!isCurrent()) return;
  for (const panel of body.panels || []) renderPanel(panel);
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

function waitForRender(ws) {
  return new Promise((resolve) => {
    const finish = () => {
      frameWaiters.delete(finish);
      ws.removeEventListener("close", finish);
      resolve();
    };
    frameWaiters.add(finish);
    ws.addEventListener("close", finish, { once: true });
  });
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
  // Serialize commands through a rendered frame, including asynchronous models.
  // Later ACKs are cumulative on the relay and must never skip a failed render.
  await waitForRender(source);
  if (!isCurrent()) return;
  rememberSeq(message.seq, message.type === "snapshot");
  if (message.type !== "snapshot") {
    send({ v: 1, type: "ack", request_id: message.request_id, seq: message.seq, body: {} });
  }
}

function updateButtons() {
  connectButton.disabled = Boolean(pairing) || wantConnected;
  tokenInput.disabled = connectButton.disabled;
  disconnectButton.disabled = !pairing && !wantConnected;
  takeoverButton.hidden = !sessionToken || wantConnected || Boolean(pairing);
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
  let commands = Promise.resolve();
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
      takeoverButton.textContent = "重试显示";
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
      takeoverButton.textContent = "切回此设备";
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
    tokenInput.value = "";
    clearSceneObject();
    clearPanels();
    rememberSeq(0, true);
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

document.querySelector("#hud").addEventListener("submit", (event) => {
  event.preventDefault();
  connect(tokenInput.value);
});

disconnectButton.addEventListener("click", () => stopConnection("未连接"));
takeoverButton.addEventListener("click", () => {
  wantConnected = true;
  reconnectAttempt = 0;
  openSocket();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !wantConnected) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = 0;
    openSocket();
  }
  send({ v: 1, type: "ping", request_id: "", seq: 0, body: {} });
});

const ray = new THREE.Raycaster();
function selectTarget() {
  if (document.body.dataset.connected !== "1") return;
  const hit = ray.intersectObjects(content.children, true)[0];
  let object = hit?.object;
  while (object && !object.userData.targetId) object = object.parent;
  if (!object) return;
  send({
    v: 1, type: "interaction", request_id: `select_${crypto.randomUUID()}`, seq: 0,
    body: { kind: "select", target_id: object.userData.targetId },
  });
}

canvas.addEventListener("click", (event) => {
  if (renderer.xr.isPresenting) return;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  ray.setFromCamera(pointer, camera);
  selectTarget();
});

for (let index = 0; index < 2; index += 1) {
  const controller = renderer.xr.getController(index);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -5)]),
    new THREE.LineBasicMaterial({ color: 0x7fd0ff }),
  );
  controller.add(line);
  controller.addEventListener("select", () => {
    if (!renderer.xr.isPresenting || !controller.visible) return;
    controller.updateWorldMatrix(true, false);
    ray.setFromXRController(controller);
    selectTarget();
  });
  scene.add(controller);
}

setupXR({
  xr: navigator.xr, renderer, scene, controls,
  button: xrButton,
  mode: document.querySelector("#xr-mode"),
  status: document.querySelector("#xr-status"),
});

window.__display = {
  disconnectForTest() {
    if (socket) socket.close(4000, "test");
  },
};

resize();
window.addEventListener("resize", resize);
renderer.setAnimationLoop(() => {
  if (sceneObject?.userData.spin) sceneObject.rotation.y += 0.01;
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
  if (renderer.xr.getSession()?.visibilityState !== "hidden") {
    for (const finish of frameWaiters) finish();
  }
});
