import { isIpHostname } from "../../../shared/protocol/index.ts";
import type { LogLevel } from "./logger.ts";
import { safeEqual } from "./security.ts";

const SECRET_MIN = 32;
const BODY_LIMIT = 256 * 1024;
const LOG_LEVELS: readonly LogLevel[] = ["error", "info", "debug"];

export type Env = Readonly<Record<string, string | undefined>>;

export interface RelayConfig {
  host: "localhost";
  port: number;
  tunnelHost: "localhost";
  tunnelPort: number;
  publicBaseUrl: string;
  mcpBearerSecret: string;
  devicePairingToken: string;
  allowedOrigins: string[];
  assetAllowedOrigins: string[];
  sessionTtlMs: number;
  deviceGrantTtlMs: number;
  pairingTtlMs: number;
  pairingMaxAttempts: number;
  pairingRatePerMinute: number;
  queueMaxMessages: number;
  queueTtlMs: number;
  idempotencyTtlMs: number;
  ackWaitMs: number;
  mcpRatePerMinute: number;
  logLevel: LogLevel;
  bodyLimit: number;
}

export class ConfigError extends Error {
  readonly code: "missing_env" | "invalid_secret" | "invalid_env";

  constructor(code: ConfigError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function invalid(name: string): ConfigError {
  return new ConfigError("invalid_env", `环境变量 ${name} 无效`);
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError("missing_env", `缺少环境变量 ${name}`);
  }
  return value;
}

function secret(env: Env, name: string): string {
  const value = required(env, name);
  if (value !== value.trim() || value.includes("PLACEHOLDER") || value.length < SECRET_MIN) {
    throw new ConfigError("invalid_secret", `环境变量 ${name} 无效：必须是至少 ${SECRET_MIN} 个字符的非占位秘密`);
  }
  return value;
}

function portValue(env: Env, name: string): number {
  const raw = required(env, name);
  if (!/^\d+$/.test(raw) || Number(raw) > 65535) throw invalid(name);
  return Number(raw);
}

function hostValue(env: Env, name: string): "localhost" {
  const value = required(env, name);
  if (value !== "localhost") throw new ConfigError("invalid_env", `环境变量 ${name} 只能是 localhost`);
  return value;
}

/** http only for localhost, otherwise https; never an IP literal or credentials. */
function httpUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(name);
  }
  if (url.username || url.password || url.search || url.hash || isIpHostname(url.hostname)) throw invalid(name);
  if (url.protocol === "http:" && url.hostname !== "localhost") throw invalid(name);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw invalid(name);
  return url;
}

function parseOriginList(raw: string | undefined, name: string): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.map((item) => {
    if (item.includes("*")) throw invalid(name);
    const url = httpUrl(item, name);
    if (url.pathname !== "/") throw invalid(name);
    return url.origin;
  });
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw invalid(name);
  const value = Number(raw);
  if (value < min || value > max) throw invalid(name);
  return value;
}

function logLevel(env: Env): LogLevel {
  const value = env.LOG_LEVEL || "info";
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (!level) throw invalid("LOG_LEVEL");
  return level;
}

export function loadConfig(env: Env): RelayConfig {
  const mcpBearerSecret = secret(env, "MCP_BEARER_SECRET");
  const devicePairingToken = secret(env, "DEVICE_PAIRING_TOKEN");
  if (safeEqual(mcpBearerSecret, devicePairingToken)) {
    throw new ConfigError("invalid_secret", "MCP_BEARER_SECRET 与 DEVICE_PAIRING_TOKEN 必须不同");
  }
  const port = portValue(env, "PORT");
  const tunnelPort = portValue(env, "TUNNEL_PORT");
  if (port !== 0 && tunnelPort !== 0 && port === tunnelPort) {
    throw new ConfigError("invalid_env", "PORT 与 TUNNEL_PORT 必须不同");
  }
  const level = logLevel(env);
  return {
    host: hostValue(env, "HOST"),
    port,
    tunnelHost: hostValue(env, "TUNNEL_HOST"),
    tunnelPort,
    publicBaseUrl: httpUrl(required(env, "PUBLIC_BASE_URL"), "PUBLIC_BASE_URL").toString().replace(/\/$/, ""),
    mcpBearerSecret,
    devicePairingToken,
    allowedOrigins: parseOriginList(env.ALLOWED_ORIGINS, "ALLOWED_ORIGINS"),
    assetAllowedOrigins: parseOriginList(env.ASSET_ALLOWED_ORIGINS, "ASSET_ALLOWED_ORIGINS"),
    sessionTtlMs: integer(env, "SESSION_TTL_SECONDS", 900, 60, 86400) * 1000,
    deviceGrantTtlMs: integer(env, "DEVICE_GRANT_TTL_SECONDS", 90 * 86400, 3600, 365 * 86400) * 1000,
    pairingTtlMs: integer(env, "PAIRING_TTL_SECONDS", 600, 60, 86400) * 1000,
    pairingMaxAttempts: integer(env, "PAIRING_MAX_ATTEMPTS", 5, 1, 20),
    pairingRatePerMinute: integer(env, "PAIRING_RATE_PER_MINUTE", 5, 1, 60),
    queueMaxMessages: integer(env, "QUEUE_MAX_MESSAGES", 100, 1, 100),
    queueTtlMs: integer(env, "QUEUE_TTL_SECONDS", 300, 1, 3600) * 1000,
    idempotencyTtlMs: integer(env, "IDEMPOTENCY_TTL_SECONDS", 300, 1, 3600) * 1000,
    ackWaitMs: integer(env, "ACK_WAIT_MS", 2000, 50, 10000),
    mcpRatePerMinute: integer(env, "MCP_RATE_PER_MINUTE", 60, 1, 600),
    logLevel: level,
    bodyLimit: BODY_LIMIT,
  };
}
