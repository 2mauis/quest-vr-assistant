import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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
const xrButton = document.querySelector("#xr");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
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
let lastSeq = Number(sessionStorage.getItem("vr-display-last-seq") || "0");
if (!Number.isInteger(lastSeq) || lastSeq < 0) lastSeq = 0;
let watchdog = 0;
let heartbeat = 0;
let assetOrigins = [];

function resize() {
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

function rememberSeq(seq) {
  if (!Number.isInteger(seq) || seq < lastSeq) return;
  lastSeq = seq;
  sessionStorage.setItem("vr-display-last-seq", String(lastSeq));
  document.body.dataset.seq = String(lastSeq);
}

function publishCounts() {
  document.body.dataset.panels = String(panelObjects.size);
}

function clearSceneObject() {
  if (!sceneObject) return;
  content.remove(sceneObject);
  sceneObject = null;
  document.body.dataset.scene = "";
}

function clearPanels() {
  for (const object of panelObjects.values()) content.remove(object);
  panelObjects.clear();
  publishCounts();
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

function showScene(body) {
  clearSceneObject();
  const holder = new THREE.Group();
  place(holder, body.anchor, body.pose);
  if (body.preset) {
    holder.add(makePreset(body.preset));
    holder.userData.spin = body.preset === "orbit";
    document.body.dataset.scene = body.preset;
    content.add(holder);
    sceneObject = holder;
    return;
  }
  if (!allowedModelUrl(body.model_url)) {
    document.body.dataset.scene = "rejected";
    return;
  }
  document.body.dataset.scene = "model";
  content.add(holder);
  sceneObject = holder;
  loader.load(body.model_url, (gltf) => {
    if (sceneObject !== holder) return;
    holder.add(gltf.scene);
  }, undefined, () => {
    document.body.dataset.scene = "error";
  });
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
  if (existing) content.remove(existing);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.7),
    new THREE.MeshBasicMaterial({ map: panelTexture(body.title, body.text), transparent: true }),
  );
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
    if (existing) content.remove(existing);
    panelObjects.delete(body.panel_id);
    publishCounts();
  }
}

function applySnapshot(body, seq) {
  clearSceneObject();
  clearPanels();
  if (body.scene) showScene(body.scene);
  for (const panel of body.panels || []) renderPanel(panel);
  rememberSeq(seq);
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
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function ack(message) {
  rememberSeq(message.seq);
  send({ v: 1, type: "ack", request_id: message.request_id || "", seq: message.seq, body: {} });
}

function onDisplayMessage(message) {
  if (message.type === "snapshot") {
    applySnapshot(message.body || {}, message.seq || 0);
    return;
  }
  if (message.type === "show_scene") {
    showScene(message.body);
    ack(message);
    return;
  }
  if (message.type === "render_panel") {
    renderPanel(message.body);
    ack(message);
    return;
  }
  if (message.type === "clear") {
    applyClear(message.body || {});
    ack(message);
    return;
  }
  if (message.type === "ping") {
    send({ v: 1, type: "pong", request_id: "", seq: 0, body: {} });
  }
}

function scheduleReconnect() {
  if (!wantConnected) return;
  const steps = [1000, 2000, 4000, 8000, 16000, 30000];
  const base = steps[Math.min(reconnectAttempt, steps.length - 1)];
  reconnectAttempt += 1;
  const delay = base * (0.8 + Math.random() * 0.4);
  setStatus("正在重连", false);
  setTimeout(openSocket, delay);
}

function openSocket() {
  if (!wantConnected || !sessionToken) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const next = new WebSocket(`${protocol}//${location.host}/ws`);
  socket = next;
  next.addEventListener("open", () => {
    reconnectAttempt = 0;
    setStatus("已连接", true);
    send({
      v: 1,
      type: "auth",
      request_id: "",
      seq: 0,
      body: { session_token: sessionToken, last_seq: lastSeq },
    });
    clearInterval(heartbeat);
    clearTimeout(watchdog);
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => next.close(), 60_000);
    };
    arm();
    heartbeat = setInterval(() => {
      send({ v: 1, type: "ping", request_id: "", seq: 0, body: {} });
    }, 25_000);
    next.addEventListener("message", () => arm());
  });
  next.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "auth_ok") {
      setStatus("显示中", true);
      disconnectButton.disabled = false;
      return;
    }
    onDisplayMessage(message);
  });
  next.addEventListener("close", (event) => {
    clearInterval(heartbeat);
    clearTimeout(watchdog);
    if (socket === next) socket = null;
    disconnectButton.disabled = true;
    if (event.code === 4401) {
      wantConnected = false;
      sessionToken = "";
      setStatus("需要重新配对", false);
      return;
    }
    scheduleReconnect();
  });
}

async function connect(token) {
  const response = await fetch("/api/device/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    setStatus(response.status === 429 ? "配对受限" : "配对失败", false);
    return;
  }
  const body = await response.json();
  sessionToken = body.session_token;
  tokenInput.value = "";
  wantConnected = true;
  reconnectAttempt = 0;
  openSocket();
}

document.querySelector("#hud").addEventListener("submit", (event) => {
  event.preventDefault();
  connect(tokenInput.value);
});

disconnectButton.addEventListener("click", () => {
  wantConnected = false;
  sessionToken = "";
  if (socket) socket.close(1000, "bye");
  setStatus("未连接", false);
});

canvas.addEventListener("click", (event) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObjects(content.children, true);
  if (hits.length === 0) return;
  send({
    v: 1,
    type: "interaction",
    request_id: `click${Date.now().toString(36)}`,
    seq: 0,
    body: { kind: "select", target_id: document.body.dataset.scene || "scene" },
  });
});

if (navigator.xr) {
  xrButton.disabled = false;
  xrButton.addEventListener("click", async () => {
    const modes = ["immersive-ar", "immersive-vr"];
    for (const mode of modes) {
      try {
        const session = await navigator.xr.requestSession(mode, { optionalFeatures: ["local-floor"] });
        await renderer.xr.setSession(session);
        controls.enabled = false;
        session.addEventListener("end", () => {
          controls.enabled = true;
        });
        return;
      } catch {
        // Try the next session mode exposed by this browser.
      }
    }
    setStatus("当前浏览器没有进入 WebXR", document.body.dataset.connected === "1");
  });
}

window.__display = {
  disconnectForTest() {
    if (socket) socket.close(4000, "test");
  },
};

resize();
window.addEventListener("resize", resize);
renderer.setAnimationLoop(() => {
  if (sceneObject?.userData.spin) sceneObject.rotation.y += 0.01;
  controls.update();
  renderer.render(scene, camera);
});

fetch("/api/display/config").then((response) => response.json()).then((config) => {
  assetOrigins = config.asset_origins || [];
}).catch(() => {
  assetOrigins = [];
});
