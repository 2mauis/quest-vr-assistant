import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

export class BodyReadError extends Error {
  readonly statusCode: 400 | 413;
  readonly code: "payload_too_large" | "request_aborted";

  constructor(code: BodyReadError["code"]) {
    super(code);
    this.code = code;
    this.statusCode = code === "payload_too_large" ? 413 : 400;
  }
}

/** Reads at most `limit` bytes; settles exactly once even when the client disconnects. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(new BodyReadError("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", fail);
    req.on("close", () => fail(new BodyReadError("request_aborted")));
  });
}

export function securityHeaders(extra: OutgoingHttpHeaders = {}): OutgoingHttpHeaders {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  };
}

export function writeBytes(
  res: ServerResponse,
  status: number,
  body: Buffer | string,
  headers: OutgoingHttpHeaders = {},
): void {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { ...securityHeaders(headers), "content-length": raw.length });
  res.end(raw);
}

export function writeJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: OutgoingHttpHeaders = {},
): void {
  writeBytes(res, status, JSON.stringify(value), {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
}

export function writeEmpty(res: ServerResponse, status: number, headers: OutgoingHttpHeaders = {}): void {
  writeBytes(res, status, "", headers);
}

/** Rejects a WebSocket upgrade on the raw socket before any handshake. */
export function rejectUpgrade(socket: Duplex, status: 403 | 404): void {
  const reason = status === 403 ? "Forbidden" : "Not Found";
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
  socket.destroy();
}
