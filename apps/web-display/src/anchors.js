export const ANCHORS = {
  world: { x: 0, y: 0, z: 0 },
  floor: { x: 0, y: 0, z: 0 },
  head: { x: 0, y: 1.6, z: 0 },
  front: { x: 0, y: 1.2, z: -1.2 },
  left: { x: -1.2, y: 1.2, z: -0.6 },
  right: { x: 1.2, y: 1.2, z: -0.6 },
};

export function placement(anchorName, pose) {
  const anchor = ANCHORS[anchorName] || ANCHORS.world;
  const position = pose?.position || { x: 0, y: 0, z: 0 };
  const rotation = pose?.rotation || { x: 0, y: 0, z: 0 };
  return {
    position: [anchor.x + position.x, anchor.y + position.y, anchor.z + position.z],
    rotation: [
      (rotation.x * Math.PI) / 180,
      (rotation.y * Math.PI) / 180,
      (rotation.z * Math.PI) / 180,
    ],
    scale: pose?.scale ?? 1,
  };
}
