import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

// The relay and the Tunnel are separate processes. This launcher never changes
// DNS, remote ingress, credentials, the relay, or a running Quick Tunnel.
/**
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {{ command: string, args: string[], env: Record<string, string | undefined> }}
 */
export function namedTunnelPlan(env) {
  let endpoint;
  try {
    endpoint = new URL(env.MCP_PUBLIC_URL ?? "");
  } catch {
    throw new Error("MCP_PUBLIC_URL 必须是正式 HTTPS /mcp 地址");
  }
  const host = endpoint.hostname;
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/mcp" ||
    endpoint.port ||
    !host.includes(".") ||
    host.endsWith(".") ||
    host.includes(":") ||
    isIP(host) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "trycloudflare.com" ||
    host.endsWith(".trycloudflare.com")
  ) {
    throw new Error("MCP_PUBLIC_URL 必须是固定域名的 HTTPS /mcp 地址，不含查询、片段或认证信息");
  }
  const tokenFile = env.TUNNEL_TOKEN_FILE;
  if (!tokenFile || !isAbsolute(tokenFile)) {
    throw new Error("TUNNEL_TOKEN_FILE 必须指向私有令牌文件的绝对路径");
  }
  try {
    const info = lstatSync(tokenFile);
    if (
      !info.isFile() ||
      info.size === 0 ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && info.uid !== process.getuid())
    ) {
      throw new Error("unsafe token file");
    }
    accessSync(tokenFile, constants.R_OK);
  } catch {
    throw new Error("Tunnel 令牌文件必须可读、非空、归当前用户所有且不向其他用户开放");
  }
  const protocol = env.TUNNEL_TRANSPORT_PROTOCOL || "http2";
  if (!["auto", "http2", "quic"].includes(protocol)) {
    throw new Error("TUNNEL_TRANSPORT_PROTOCOL 仅支持 auto、http2 或 quic");
  }
  // TUNNEL_HOST / PORT mean different things to the relay and cloudflared.
  // The connector needs its token file, not application or management secrets.
  const dropped = new Set([
    "TUNNEL_HOST",
    "TUNNEL_PORT",
    "TUNNEL_TOKEN",
    "MCP_PUBLIC_URL",
    "MCP_BEARER_SECRET",
    "DEVICE_PAIRING_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_ZONE_ID",
    "CF_API_TOKEN",
    "CF_API_KEY",
  ]);
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !dropped.has(key)));
  return {
    command: "cloudflared",
    args: ["tunnel", "--protocol", protocol, "--no-autoupdate", "run", "--token-file", tokenFile],
    env: childEnv,
  };
}

function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--check")) {
    throw new Error("用法：node scripts/start-named-tunnel.mjs [--check]");
  }
  const plan = namedTunnelPlan(process.env);
  if (process.argv.includes("--check")) {
    console.log("具名 Tunnel 本地配置检查通过；尚未验证云端路由或公网连接");
    return;
  }
  const child = spawn(plan.command, plan.args, { env: plan.env, stdio: "inherit" });
  const terminate = () => child.kill("SIGTERM");
  const interrupt = () => child.kill("SIGINT");
  process.on("SIGTERM", terminate);
  process.on("SIGINT", interrupt);
  const cleanup = () => {
    process.off("SIGTERM", terminate);
    process.off("SIGINT", interrupt);
  };
  child.once("error", () => {
    cleanup();
    console.error("cloudflared 未能启动，请检查安装及执行权限");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    cleanup();
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
