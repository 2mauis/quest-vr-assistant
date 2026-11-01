#!/usr/bin/env python3
"""Verify the assembled debug APK, then export only the intended CI artifacts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent


def verify_preset(data):
    magic, version, length, json_size, chunk_type = struct.unpack("<5I", data[:20])
    if (magic, version, length, chunk_type) != (0x46546C67, 2, len(data), 0x4E4F534A):
        raise RuntimeError("Invalid preset GLB")
    document = json.loads(data[20:20 + json_size])
    if not document["nodes"] or any("uri" in buffer for buffer in document["buffers"]):
        raise RuntimeError("Preset must contain a self-contained scene")
    binary_size, binary_type = struct.unpack_from("<2I", data, 20 + json_size)
    binary = data[28 + json_size:]
    if binary_type != 0x004E4942 or binary_size != len(binary):
        raise RuntimeError("Invalid preset binary chunk")
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            index = primitive.get("indices", -1)
            if not 0 <= index < len(document["accessors"]):
                raise RuntimeError("Preset requires a valid index accessor for Spatial SDK")
            accessor = document["accessors"][index]
            if accessor["type"] != "SCALAR" or accessor["componentType"] != 5125 or accessor["count"] % 3:
                raise RuntimeError("Invalid preset triangle indices")
            view = document["bufferViews"][accessor["bufferView"]]
            offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            end = offset + 4 * accessor["count"]
            if view["buffer"] != 0 or end > len(binary) or end > view.get("byteOffset", 0) + view["byteLength"]:
                raise RuntimeError("Preset index buffer out of bounds")
            count = document["accessors"][primitive["attributes"]["POSITION"]]["count"]
            indices = struct.unpack_from("<" + "I" * accessor["count"], binary, offset)
            if not indices or max(indices) >= count:
                raise RuntimeError("Preset vertex index out of bounds")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.commit):
        parser.error("commit must be a full Git commit hash")
    tools = Path(os.environ["ANDROID_HOME"]) / "build-tools/35.0.0"
    apk = ROOT / "app/build/outputs/apk/debug/app-debug.apk"
    probe = ROOT.parent / "tunnel-probe/build/quest-tunnel-probe.apk"

    def certificate(path):
        result = subprocess.run([str(tools / "apksigner"), "verify", "--verbose", "--print-certs", str(path)],
                                check=True, text=True, capture_output=True)
        found = re.search(r"Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})", result.stdout)
        if not found: raise RuntimeError("Signing certificate digest missing")
        return found.group(1)

    signer = certificate(apk)
    if signer != certificate(probe): raise RuntimeError("Native and probe APK signing identities differ")
    subprocess.run([str(tools / "zipalign"), "-c", "-P", "16", "4", str(apk)], check=True)
    metadata = json.loads((apk.parent / "output-metadata.json").read_text())
    if metadata["applicationId"] != "com.example.questvr.tunnelprobe":
        raise RuntimeError("Unexpected application ID")
    with zipfile.ZipFile(apk) as bundle, zipfile.ZipFile(probe) as probe_bundle:
        names = bundle.namelist()
        if any(name.endswith((".keystore", ".jks", ".token", ".env")) for name in names):
            raise RuntimeError("Private file included in APK")
        native = "lib/arm64-v8a/libcloudflared_probe.so"
        native_hash = hashlib.sha256(bundle.read(native)).hexdigest()
        if native_hash != hashlib.sha256(probe_bundle.read(native)).hexdigest():
            raise RuntimeError("Probe native component differs from its source APK")
        if not any(name.startswith("assets/third_party/") for name in names):
            raise RuntimeError("Native component license notices missing")
        for preset in ("grid", "orbit", "crystal", "pedestal"):
            verify_preset(bundle.read("assets/presets/" + preset + ".glb"))
        web_url = os.environ.get("QVR_WEB_START_URL", "https://app.example.com/")
        dex_files = [name for name in names if re.fullmatch(r"classes\d*\.dex", name)]
        if not any(web_url.encode("ascii") in bundle.read(name) for name in dex_files):
            raise RuntimeError("Configured web entry not found in APK")

    output = ROOT / "build/artifact"
    output.mkdir(parents=True, exist_ok=True)
    destination = output / "quest-assistant-debug.apk"
    shutil.copyfile(apk, destination)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    result = {
        "commit": args.commit,
        "application_id": metadata["applicationId"],
        "version_name": metadata["elements"][0]["versionName"],
        "version_code": metadata["elements"][0]["versionCode"],
        "apk_sha256": digest,
        "certificate_sha256": signer,
        "native_component_sha256": native_hash,
        "abi": "arm64-v8a",
        "self_contained_presets": 4,
        "web_entry": "placeholder" if web_url == "https://app.example.com/" else "configured",
        "signing": "debug; compare the certificate with the installed APK before updating",
        "device_validation": "not_run",
    }
    (output / "build-result.json").write_text(json.dumps(result, indent=2) + "\n")
    (output / "SHA256SUMS").write_text(digest + "  " + destination.name + "\n")
    print("APK signature, alignment, embedded component, four presets and web entry verified.")
    print("Artifact: build/artifact/quest-assistant-debug.apk")


if __name__ == "__main__":
    main()
