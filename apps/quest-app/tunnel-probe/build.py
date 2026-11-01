#!/usr/bin/env python3
"""Build a debug-only, ARM64 probe using the Android SDK's standard CLI tools.

Inputs are explicit local toolchain/source directories; no credentials or installs.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "build"
REVISION = "872b241f94871665c1c157adefcf90c11f0ead96"


def run(*args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def main():
    source = Path(os.environ["QVR_CLOUDFLARED_SOURCE_DIR"]).resolve()
    sdk = Path(os.environ["ANDROID_HOME"]).resolve()
    java = Path(os.environ["JAVA_HOME"]) / "bin"
    tools = sdk / "build-tools/35.0.0"
    platform = sdk / "platforms/android-34/android.jar"
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise SystemExit("cloudflared source must be the pinned revision")
    patches = sorted((ROOT / "native").glob("*.go"))
    dirty = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain"], text=True).splitlines()
    allowed = {"?? cmd/cloudflared/" + path.name for path in patches}
    if any(line not in allowed for line in dirty):
        raise SystemExit("use an isolated upstream source checkout; unrelated modifications found")
    OUT.mkdir(exist_ok=True)
    web_url = os.environ.get("QVR_WEB_START_URL", "https://app.example.com/")
    parsed = urlsplit(web_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise SystemExit("QVR_WEB_START_URL must be an HTTPS URL without credentials, using port 443")
    generated = OUT / "generated/com/example/questvr/tunnelprobe/WebBuildConfig.java"
    generated.parent.mkdir(parents=True, exist_ok=True)
    generated.write_text("package com.example.questvr.tunnelprobe;\nfinal class WebBuildConfig {\n"
                         "    static final String START_URL = " + json.dumps(web_url) + ";\n}\n")
    for patch in patches:
        shutil.copyfile(patch, source / "cmd/cloudflared" / patch.name)
    native = OUT / "libcloudflared_probe.so"
    env = dict(os.environ, GOOS="linux", GOARCH="arm64", CGO_ENABLED="0", GOENV="off",
               GOTOOLCHAIN="go1.27.3", GOCACHE=str(OUT / "go-cache"), GOMODCACHE=str(OUT / "go-modules"))
    run("go", "build", "-mod=readonly", "-tags", "quest_probe", "-trimpath", "-ldflags",
        "-X main.Version=2026.10.7-quest-app-probe -X main.BuildType=quest-app-probe",
        "-o", native, "./cmd/cloudflared", cwd=source, env=env)
    classes = OUT / "classes"
    dex = OUT / "dex"
    for folder in (classes, dex):
        if folder.exists(): shutil.rmtree(folder)
        folder.mkdir()
    run(tools / "aapt2", "link", "-I", platform, "--manifest", ROOT / "AndroidManifest.xml", "-o", OUT / "unsigned.apk")
    bootclasspath = os.pathsep.join(str(p) for p in (platform, tools / "core-lambda-stubs.jar"))
    run(java / "javac", "-encoding", "UTF-8", "-source", "8", "-target", "8", "-Xlint:-options", "-bootclasspath", bootclasspath,
        "-d", classes, *sorted((ROOT / "src").rglob("*.java")), generated)
    run(tools / "d8", "--min-api", "28", "--lib", platform, "--output", dex, *sorted(classes.rglob("*.class")))
    # Collect notices from the actual pinned dependency graph, including replacements.
    raw = subprocess.check_output(["go", "list", "-mod=readonly", "-tags", "quest_probe", "-deps", "-json",
                                   "./cmd/cloudflared"], cwd=source, env=env, text=True)
    modules = {"cloudflared": source}
    decoder = json.JSONDecoder()
    while raw.strip():
        item, end = decoder.raw_decode(raw.lstrip())
        raw = raw.lstrip()[end:]
        module = item.get("Module", {})
        module = module.get("Replace", module)
        if "Dir" in module and not module.get("Main"):
            modules[module["Path"] + "@" + module.get("Version", "local")] = Path(module["Dir"])
    licenses = []
    for name, directory in modules.items():
        for path in sorted(directory.rglob("*")):
            if path.is_file() and ".git" not in path.parts and path.name.upper().startswith(("LICENSE", "NOTICE", "COPYING")):
                licenses.append((path, name + "/" + str(path.relative_to(directory))))
    go_root = Path(subprocess.check_output(["go", "env", "GOROOT"], text=True, env=env).strip())
    inputs = {"cloudflared_revision": revision, "go": "1.27.3", "target_api": 34, "build_tools": "35.0.0",
              "native_sha256": hashlib.sha256(native.read_bytes()).hexdigest(),
              "patch_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in patches}}
    with zipfile.ZipFile(OUT / "unsigned.apk", "a", compression=zipfile.ZIP_DEFLATED) as apk:
        apk.write(dex / "classes.dex", "classes.dex")
        apk.write(native, "lib/arm64-v8a/libcloudflared_probe.so")
        for asset in sorted((ROOT / "assets").rglob("*")):
            if asset.is_file(): apk.write(asset, "assets/" + asset.relative_to(ROOT / "assets").as_posix())
        for license_file, destination in licenses:
            apk.write(license_file, "assets/third_party/" + destination)
        apk.write(go_root / "LICENSE", "assets/third_party/go/LICENSE")
        apk.writestr("assets/probe-build.json", json.dumps(inputs, indent=2))
    run(tools / "zipalign", "-f", "-P", "16", "4", OUT / "unsigned.apk", OUT / "aligned.apk")
    key = OUT / "debug.keystore"
    if not key.exists():
        run(java / "keytool", "-genkeypair", "-keystore", key, "-storepass", "android", "-keypass", "android",
            "-alias", "probe", "-keyalg", "RSA", "-keysize", "2048", "-validity", "365",
            "-dname", "CN=Quest Tunnel Probe")
        key.chmod(0o600)
    apk = OUT / "quest-tunnel-probe.apk"
    run(tools / "apksigner", "sign", "--ks", key, "--ks-pass", "pass:android", "--key-pass", "pass:android",
        "--out", apk, OUT / "aligned.apk")
    run(tools / "apksigner", "verify", "--verbose", apk)
    run(tools / "zipalign", "-c", "-P", "16", "4", apk)
    inputs["apk_sha256"] = hashlib.sha256(apk.read_bytes()).hexdigest()
    inputs["third_party_notice_files"] = len(licenses) + 1
    (OUT / "build-result.json").write_text(json.dumps(inputs, indent=2) + "\n")
    print(json.dumps(inputs, indent=2))


if __name__ == "__main__":
    main()
