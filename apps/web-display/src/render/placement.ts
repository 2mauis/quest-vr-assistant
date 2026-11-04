import type { Anchor, Pose, Vector3 } from "../../../../shared/protocol/index.ts";

/** Anchor origins in metres, relative to the local XR reference space. */
export const ANCHOR_ORIGINS: Record<Anchor, Vector3> = {
  world: { x: 0, y: 0, z: 0 },
  floor: { x: 0, y: 0, z: 0 },
  head: { x: 0, y: 1.6, z: 0 },
  front: { x: 0, y: 1.2, z: -1.2 },
  left: { x: -1.2, y: 1.2, z: -0.6 },
  right: { x: 1.2, y: 1.2, z: -0.6 },
};

export interface Placement {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

const DEGREES = Math.PI / 180;

export function placement(anchor: Anchor, pose: Pose): Placement {
  const origin = ANCHOR_ORIGINS[anchor];
  return {
    position: [origin.x + pose.position.x, origin.y + pose.position.y, origin.z + pose.position.z],
    rotation: [pose.rotation.x * DEGREES, pose.rotation.y * DEGREES, pose.rotation.z * DEGREES],
    scale: pose.scale,
  };
}
