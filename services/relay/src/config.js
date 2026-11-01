import { safeEqual } from "./security.js";

const SECRET_MIN = 32;
const BODY_LIMIT = 256 * 1024;

export class ConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError("missing_env", `缺少环境变量 ${name}`);
  }
  return value;
}

function secret(env, name) {
  const value = required(env, name);
  if (value !== value.trim() || value.includes("PLACEHOLDER") || value.length < SECRET_MIN) {
    throw new ConfigError("invalid_secret", `环境变量 ${name} 无效：必须是至少 ${SECRET_MIN} 个字符的非占位秘密`);
  }
  return value;
}

function portValue(env, name) {
  const raw = required(env, name);
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
  }
  const port = Number(raw);
  if (port > 65535) {
    throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
  }
  return port;
}

function hostValue(env, name) {
  const value = required(env, name);
  if (value !== "localhost") {
    throw new ConfigError("invalid_env", `环境变量 ${name} 只能是 localhost`);
  }
  return value;
}

function isIpHostname(hostname) {
  if (hostname.includes(":")) return true;
  return /^\d+(\.\d+){3}$/.test(hostname);
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError("invalid_env", "环境变量 PUBLIC_BASE_URL 无效");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError("invalid_env", "环境变量 PUBLIC_BASE_URL 无效");
  }
  if (isIpHostname(url.hostname)) {
    throw new ConfigError("invalid_env", "环境变量 PUBLIC_BASE_URL 无效");
  }
  if (url.protocol === "http:" && url.hostname !== "localhost") {
    throw new ConfigError("invalid_env", "环境变量 PUBLIC_BASE_URL 无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("invalid_env", "环境变量 PUBLIC_BASE_URL 无效");
  }
  return url.toString().replace(/\/$/, "");
}

function parseOriginList(raw, name) {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.map((item) => {
    if (item === "*" || item.includes("*")) {
      throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
    }
    let url;
    try {
      url = new URL(item);
    } catch {
      throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
    }
    if (isIpHostname(url.hostname)) {
      throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
    }
    if (url.protocol === "http:" && url.hostname !== "localhost") {
      throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
    }
    return url.origin;
  });
}

function integer(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ConfigError("invalid_env", `环境变量 ${name} 无效`);
  }
  return value;
}

export function loadConfig(env) {
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
  const logLevel = env.LOG_LEVEL || "info";
  if (!["error", "info", "debug"].includes(logLevel)) {
    throw new ConfigError("invalid_env", "环境变量 LOG_LEVEL 无效");
  }
  return {
    host: hostValue(env, "HOST"),
    port,
    tunnelHost: hostValue(env, "TUNNEL_HOST"),
    tunnelPort,
    publicBaseUrl: validateBaseUrl(required(env, "PUBLIC_BASE_URL")),
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
    logLevel,
    bodyLimit: BODY_LIMIT,
  };
}
