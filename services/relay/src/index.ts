import { createApp } from "./app.ts";
import { ConfigError, loadConfig, type RelayConfig } from "./config.ts";

function exit(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let config: RelayConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) exit(error.message);
  throw error;
}

const app = createApp(config);
try {
  await app.start();
} catch {
  exit("服务未能监听端口");
}

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await app.close();
    process.exit(0);
  } catch {
    exit("服务未能正常关闭");
  }
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
