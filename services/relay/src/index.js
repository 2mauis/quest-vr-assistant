import { loadConfig, ConfigError } from "./config.js";
import { createApp } from "./app.js";

const config = (() => {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
})();

const app = createApp(config);
let started;
try {
  started = await app.start();
} catch (error) {
  process.stderr.write("服务未能监听端口\n");
  process.exit(1);
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown();
});
process.on("SIGINT", () => {
  shutdown();
});

void started;
