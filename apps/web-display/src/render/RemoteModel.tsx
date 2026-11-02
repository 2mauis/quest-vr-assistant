import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { Texture, type Material, type Mesh, type Object3D } from "three";

const users = new Map<string, number>();

function disposeTree(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => materials.add(item));
    else if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) value.dispose();
    }
    material.dispose();
  }
}

/** Frees a URL from the loader cache, e.g. after it failed so a retry fetches again. */
export function forgetModel(url: string): void {
  if (!users.has(url)) useGLTF.clear(url);
}

/**
 * Shows a glTF model. Each mount renders its own clone; GPU resources and the
 * loader cache entry are released once no mounted instance uses the URL.
 */
export function RemoteModel({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const instance = useMemo(() => gltf.scene.clone(true), [gltf]);
  useEffect(() => {
    users.set(url, (users.get(url) ?? 0) + 1);
    return () => {
      const remaining = (users.get(url) ?? 1) - 1;
      if (remaining > 0) {
        users.set(url, remaining);
        return;
      }
      users.delete(url);
      disposeTree(gltf.scene);
      useGLTF.clear(url);
    };
  }, [url, gltf]);
  return <primitive object={instance} />;
}
