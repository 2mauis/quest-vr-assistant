import { Component, Suspense, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Container, Text } from "@react-three/uikit";
import { useXR } from "@react-three/xr";
import { Raycaster, Vector2 } from "three";
import { placement } from "./anchors.js";

function Placed({ spec, children }) {
  const pose = placement(spec.anchor, spec.pose);
  return (
    <group
      position={pose.position}
      rotation={pose.rotation}
      scale={pose.scale}
      userData={{ targetId: spec.targetId }}
    >
      {children}
    </group>
  );
}

function OrbitPreset() {
  const ref = useRef(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y += 0.01;
  });
  return (
    <group ref={ref}>
      <mesh position={[1.1, 1.2, 0]}>
        <boxGeometry args={[0.4, 0.4, 0.4]} />
        <meshStandardMaterial color="#3aa0ff" roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[-0.9, 1.5, 0.4]}>
        <sphereGeometry args={[0.28, 24, 16]} />
        <meshStandardMaterial color="#ffcc55" roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0.2, 0.9, -0.6]}>
        <torusGeometry args={[0.28, 0.08, 12, 24]} />
        <meshStandardMaterial color="#66e0c2" roughness={0.4} metalness={0.2} />
      </mesh>
    </group>
  );
}

function Preset({ name }) {
  if (name === "grid") return <gridHelper args={[4, 8, "#335577", "#223344"]} />;
  if (name === "orbit") return <OrbitPreset />;
  if (name === "crystal") {
    return (
      <mesh position={[0, 1.3, 0]}>
        <icosahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color="#88ddff" metalness={0.85} roughness={0.15} />
      </mesh>
    );
  }
  return (
    <group>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.55, 0.7, 0.25, 24]} />
        <meshStandardMaterial color="#243044" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[0.7, 0.7, 0.7]} />
        <meshStandardMaterial color="#ff5a1f" emissive="#ff5a1f" emissiveIntensity={0.55} roughness={0.35} />
      </mesh>
    </group>
  );
}

function RemoteModel({ url, generation, session }) {
  const gltf = useGLTF(url);
  useEffect(() => {
    session.assetReady(generation);
  }, [session, generation, gltf]);
  return <primitive object={gltf.scene} />;
}

class PanelError extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

class ModelError extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.session.assetFailed(this.props.generation);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function PanelCard({ panel }) {
  const pose = placement(panel.anchor, panel.pose);
  const title = (panel.title || "信息").slice(0, 40);
  return (
    <group position={pose.position} rotation={pose.rotation} scale={pose.scale} userData={{ targetId: panel.panel_id }}>
      <mesh>
        <planeGeometry args={[1.4, 0.7]} />
        <meshBasicMaterial color="#081020" transparent opacity={0.92} />
      </mesh>
      <Suspense fallback={null}>
        <PanelError>
          <Container
            width={140}
            height={70}
            padding={8}
            flexDirection="column"
            backgroundColor="#081020"
            borderColor="#7fd0ff"
            borderWidth={1}
          >
            <Text fontSize={8} color="#d7f3ff">{title}</Text>
            <Text fontSize={5} color="#d7f3ff">{panel.text}</Text>
          </Container>
        </PanelError>
      </Suspense>
    </group>
  );
}

function PointerSelect({ session }) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    const ray = new Raycaster();
    const pointer = new Vector2();
    const onClick = (event) => {
      if (gl.xr.isPresenting) return;
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(scene.children, true)[0];
      let object = hit?.object;
      while (object && !object.userData.targetId) object = object.parent;
      if (object) session.select(object.userData.targetId);
    };
    gl.domElement.addEventListener("click", onClick);
    return () => gl.domElement.removeEventListener("click", onClick);
  }, [camera, gl, scene, session]);
  return null;
}

function Backdrop() {
  const session = useXR((value) => value.session);
  const mode = useXR((value) => value.mode);
  const scene = useThree((value) => value.scene);
  useEffect(() => {
    scene.background = session && mode === "immersive-ar" ? null : scene.background;
    if (!(session && mode === "immersive-ar")) {
      scene.background = scene.userData.desktopBackground || scene.background;
    }
  }, [session, mode, scene]);
  return null;
}

export function Stage({ session, view }) {
  const presenting = useXR((value) => Boolean(value.session));
  useFrame(() => {
    session.notePaint(view.paintGeneration);
  });
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[2, 4, 3]} intensity={1.4} />
      <Backdrop />
      <PointerSelect session={session} />
      <OrbitControls target={[0, 1, 0]} enabled={!presenting} />
      {view.scene?.preset ? (
        <Placed spec={view.scene}>
          <Preset name={view.scene.preset} />
        </Placed>
      ) : null}
      {view.scene?.modelUrl ? (
        <Placed spec={view.scene}>
          <ModelError key={view.scene.generation} generation={view.scene.generation} session={session}>
            <Suspense fallback={null}>
              <RemoteModel url={view.scene.modelUrl} generation={view.scene.generation} session={session} />
            </Suspense>
          </ModelError>
        </Placed>
      ) : null}
      {view.panels.map((panel) => <PanelCard key={panel.key} panel={panel} />)}
    </>
  );
}
