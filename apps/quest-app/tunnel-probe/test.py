#!/usr/bin/env python3
"""Exercise real loopback sockets, strict routing, nonce binding and shutdown."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent
java = Path(os.environ["JAVA_HOME"]) / "bin"
with tempfile.TemporaryDirectory(prefix="quest-health-test-") as output:
    subprocess.run([str(java / "javac"), "-d", output,
                    str(root / "src/com/example/questvr/tunnelprobe/HealthServer.java"),
                    str(root / "test/HealthServerTest.java")], check=True)
    subprocess.run([str(java / "java"), "-cp", output,
                    "com.example.questvr.tunnelprobe.HealthServerTest"], check=True)
