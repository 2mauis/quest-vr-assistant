import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { Preset } from "../../../../shared/protocol/index.ts";

function OrbitPreset() {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.6;
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

function Pedestal() {
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

/** Built-in scenes drawn from primitives; there are no preset asset files. */
export function PresetScene({ preset }: { preset: Preset }) {
  switch (preset) {
    case "grid":
      return <gridHelper args={[4, 8, "#335577", "#223344"]} />;
    case "orbit":
      return <OrbitPreset />;
    case "crystal":
      return (
        <mesh position={[0, 1.3, 0]}>
          <icosahedronGeometry args={[0.7, 0]} />
          <meshStandardMaterial color="#88ddff" metalness={0.85} roughness={0.15} />
        </mesh>
      );
    case "pedestal":
      return <Pedestal />;
  }
}
