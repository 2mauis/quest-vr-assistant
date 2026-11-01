#!/usr/bin/env python3
"""Generate self-contained glTF 2 presets; no network assets or editor installation."""
import json
import math
from pathlib import Path
import struct
import sys


def box():
    v = [(x, y, z) for z in (-.5, .5) for y in (-.5, .5) for x in (-.5, .5)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return [tuple(v[i] for i in t) for a, b, c, d in faces for t in ((a, b, c), (a, c, d))]


def surface(fn, nu=24, nv=12):
    tris = []
    for i in range(nu):
        for j in range(nv):
            a, b, c, d = fn(i/nu, j/nv), fn((i+1)/nu, j/nv), fn((i+1)/nu, (j+1)/nv), fn(i/nu, (j+1)/nv)
            tris += [(a, b, c), (a, c, d)]
    return tris


def crystal():
    v = [(0, .7, 0), (0, -.7, 0), (.5, 0, 0), (0, 0, .5), (-.5, 0, 0), (0, 0, -.5)]
    return [tuple(v[x] for x in t) for i in range(4) for t in ((0, 2+i, 2+(i+1)%4), (1, 2+(i+1)%4, 2+i))]


def write_glb(path, shapes):
    binary = bytearray()
    document = dict(asset={"version": "2.0", "generator": "Quest Assistant presets"}, scene=0,
                    scenes=[{"nodes": list(range(len(shapes)))}], nodes=[], meshes=[], materials=[],
                    accessors=[], bufferViews=[], buffers=[])
    for triangles, color, position, scale in shapes:
        positions, normals = [], []
        for a, b, c in triangles:
            u, v = [b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)]
            n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            length = math.sqrt(sum(x*x for x in n))
            if length < 1e-9: continue
            positions.extend([a, b, c]); normals.extend([[x/length for x in n]]*3)
        accessor_ids = []
        for values in (positions, normals):
            start = len(binary)
            for value in values: binary.extend(struct.pack('<3f', *value))
            view = len(document['bufferViews'])
            document['bufferViews'].append(dict(buffer=0, byteOffset=start, byteLength=len(binary)-start, target=34962))
            accessor_ids.append(len(document['accessors']))
            document['accessors'].append(dict(bufferView=view, componentType=5126, count=len(values), type='VEC3',
                min=[min(v[i] for v in values) for i in range(3)], max=[max(v[i] for v in values) for i in range(3)]))
        index = len(document['meshes'])
        # Spatial SDK's native loader requires an index accessor, even for triangle soup.
        start = len(binary)
        for vertex in range(len(positions)): binary.extend(struct.pack('<I', vertex))
        view = len(document['bufferViews'])
        document['bufferViews'].append(dict(buffer=0, byteOffset=start, byteLength=len(binary)-start, target=34963))
        indices = len(document['accessors'])
        document['accessors'].append(dict(bufferView=view, componentType=5125, count=len(positions), type='SCALAR',
            min=[0], max=[len(positions)-1]))
        document['materials'].append(dict(pbrMetallicRoughness=dict(baseColorFactor=[*color, 1], metallicFactor=.25, roughnessFactor=.4), doubleSided=True))
        document['meshes'].append(dict(primitives=[dict(attributes=dict(POSITION=accessor_ids[0], NORMAL=accessor_ids[1]), indices=indices, material=index)]))
        document['nodes'].append(dict(mesh=index, translation=position, scale=scale))
    document['buffers'] = [dict(byteLength=len(binary))]
    body = json.dumps(document, separators=(',', ':')).encode()
    body += b' ' * (-len(body) % 4)
    binary += b'\0' * (-len(binary) % 4)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, 28+len(body)+len(binary)) +
        struct.pack('<II', len(body), 0x4E4F534A) + body + struct.pack('<II', len(binary), 0x004E4942) + binary)


def main():
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    cube = box()
    sphere = surface(lambda u, v: (.28*math.cos(u*2*math.pi)*math.sin(v*math.pi), .28*math.cos(v*math.pi), .28*math.sin(u*2*math.pi)*math.sin(v*math.pi)))
    torus = surface(lambda u, v: ((.28+.08*math.cos(v*2*math.pi))*math.cos(u*2*math.pi), (.28+.08*math.cos(v*2*math.pi))*math.sin(u*2*math.pi), .08*math.sin(v*2*math.pi)))
    grid = []
    for i in range(9):
        t = -2+i*.5
        grid += [(cube, [.2, .4, .55], [t, 0, 0], [.012, .012, 4]), (cube, [.2, .4, .55], [0, 0, t], [4, .012, .012])]
    presets = dict(grid=grid,
        orbit=[(cube, [.23, .63, 1], [1.1, 1.2, 0], [.4]*3), (sphere, [1, .8, .33], [-.9, 1.5, .4], [1]*3), (torus, [.4, .88, .76], [.2, .9, -.6], [1]*3)],
        crystal=[(crystal(), [.53, .87, 1], [0, 0, 0], [1]*3)],
        pedestal=[(cube, [.14, .19, .27], [0, .12, 0], [1.1, .25, 1.1]), (cube, [1, .35, .12], [0, .75, 0], [.7]*3)])
    for name, shapes in presets.items(): write_glb(out / (name+'.glb'), shapes)


if __name__ == '__main__': main()
