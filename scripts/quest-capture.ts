import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  copyFileSync,
  openSync,
  closeSync,
  rmdirSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { captureOptions } from "./workflow/logic.ts";
let options: ReturnType<typeof captureOptions>;
try {
  options = captureOptions(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "invalid capture options");
  process.exit(2);
}
const missing = ["adb", "ffmpeg"].filter((tool) => {
  try {
    execFileSync(tool, ["-version"], { stdio: "ignore" });
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
});
if (missing.length) {
  console.error(
    `quest-capture: missing ${missing.join(", ")} on PATH; install it and run npm run doctor first (待实机验证)`,
  );
  process.exit(2);
}
const dir = path.resolve(".debug-evidence", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(dir, { recursive: true, mode: 0o700 });
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: "pipe", timeout: 240_000 });
let failure: unknown;
let failed = false;
const cleanup = (action: () => void) => {
  try {
    action();
  } catch (error) {
    failure = failed ? new AggregateError([failure, error], "Capture failed; cleanup also failed") : error;
    failed = true;
  }
};
try {
  const relayFile = process.env.QUEST_RELAY_LOG;
  const offset = relayFile ? statSync(relayFile).size : 0;
  const start = new Date().toISOString();
  const fd = openSync(path.join(dir, "logcat.txt"), "w", 0o600);
  const log = spawn("adb", ["logcat", "-v", "epoch", "-T", "1"], { stdio: ["ignore", fd, "ignore"] });
  log.on("error", () => {
    process.exitCode = 1;
  });
  try {
    const video = path.join(dir, "capture.mp4");
    if (options.source === "adb") {
      const remote = `/sdcard/qva-capture-${Date.now()}.mp4`;
      let captureFailed = false;
      let captureError: unknown;
      try {
        run("adb", ["shell", "screenrecord", "--time-limit", String(options.seconds), remote]);
        run("adb", ["pull", remote, video]);
      } catch (error) {
        captureFailed = true;
        captureError = error;
      }
      try {
        run("adb", ["shell", "rm", "-f", remote]);
      } catch (error) {
        if (captureFailed) throw new AggregateError([captureError, error], "Capture and remote cleanup failed");
        throw error;
      }
      if (captureFailed) throw captureError;
    } else {
      const captures =
        process.env.QUEST_MQDH_CAPTURES ?? path.join(homedir(), "Library/Application Support/odh/captures");
      const latest = readdirSync(captures)
        .filter((f) => f.endsWith(".mp4"))
        .map((f) => path.join(captures, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      if (!latest || Date.now() - statSync(latest).mtimeMs > 300_000)
        throw new Error("Record and finish a fresh MQDH clip first");
      copyFileSync(latest, video);
    }
    run("ffmpeg", [
      "-y",
      "-i",
      video,
      "-t",
      String(options.seconds),
      "-vf",
      options.filter,
      path.join(dir, "frame-%04d.jpg"),
    ]);
    run("ffmpeg", [
      "-y",
      "-framerate",
      "2",
      "-i",
      path.join(dir, "frame-%04d.jpg"),
      "-vf",
      `scale=320:-1,tile=4x${Math.ceil((options.seconds * 2) / 4)}`,
      "-frames:v",
      "1",
      path.join(dir, "contact-sheet.jpg"),
    ]);
  } catch (error) {
    failure = error;
    failed = true;
  } finally {
    cleanup(() => {
      log.kill("SIGTERM");
    });
    cleanup(() => closeSync(fd));
    if (relayFile) cleanup(() => writeFileSync(path.join(dir, "relay.log"), readFileSync(relayFile).subarray(offset)));
    cleanup(() =>
      writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify(
          {
            start,
            end: new Date().toISOString(),
            ...options,
            status: "待实机验证",
            relayLog: relayFile ? "captured" : "not configured",
            mqdhLogWindow:
              options.source === "mqdh"
                ? "processing window only; recording logs must be collected separately"
                : undefined,
          },
          null,
          2,
        ),
      ),
    );
    console.log(dir);
  }
} catch (error) {
  failure = failed ? new AggregateError([failure, error], "Capture setup or cleanup failed") : error;
  failed = true;
}
if (failed) {
  cleanup(() => {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  });
  throw failure;
}
