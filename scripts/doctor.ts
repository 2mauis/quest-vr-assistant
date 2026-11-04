import { execFileSync } from "node:child_process";
import { statfsSync } from "node:fs";
function check(name: string, command: string, args: string[], hint: string, predicate = (_s: string) => true) {
  try {
    const result = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    if (!predicate(result)) throw new Error("not ready");
    console.log(`PASS ${name}`);
  } catch {
    console.log(`FAIL ${name}: ${hint}`);
    process.exitCode = 1;
  }
}
check(
  "adb authorized device",
  "adb",
  ["devices"],
  "Connect exactly one device and accept USB authorization",
  (s) => s.split("\n").filter((l) => /\tdevice$/.test(l.trim())).length === 1,
);
check(
  "device model",
  "adb",
  ["shell", "getprop", "ro.product.model"],
  "Check device selection",
  (s) => s.trim().length > 0,
);
check("MQDH", "pgrep", ["-if", "(Meta Quest Developer Hub|Oculus Developer Hub)"], "Open MQDH and Cast");
check("GitHub authentication", "gh", ["auth", "status"], "Sign in manually");
check("ffmpeg", "ffmpeg", ["-version"], "Install ffmpeg");
const disk = statfsSync(".");
if (disk.bavail * disk.bsize < 2 * 1024 ** 3) {
  console.log("FAIL disk: free at least 2 GiB");
  process.exitCode = 1;
} else console.log("PASS disk");
try {
  const url = new URL(process.env.QUEST_RELAY_URL ?? "http://localhost:8787/healthz");
  if (url.hostname !== "localhost") throw new Error("localhost required");
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const body = (await response.json()) as { ready?: boolean };
  if (!response.ok || body.ready !== true) throw new Error("not ready");
  console.log("PASS relay health");
} catch {
  console.log("FAIL relay: start relay; set QUEST_RELAY_URL to its localhost healthz URL");
  process.exitCode = 1;
}
console.log(
  "MANUAL: microphone; accessibility; screen/system audio recording; Screen context; per-app Computer Use consent; Voice login; Cast readability. 待实机验证。",
);
