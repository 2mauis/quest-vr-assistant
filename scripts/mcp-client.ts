// Official MCP client helper shared by the demo and the delivered check.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { ToolResult } from "../shared/protocol/index.ts";

export interface ToolCallRecord extends ToolResult {
  name: string;
  isError: boolean;
}

export async function connectMcp(endpoint: URL, bearer: string, clientName: string): Promise<Client> {
  const client = new Client(
    { name: clientName, version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: () => Promise.resolve(bearer) },
  });
  await client.connect(transport);
  return client;
}

function isToolResult(value: unknown): value is ToolResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.request_id === "string" &&
    typeof record.status === "string" &&
    typeof record.seq === "number" &&
    typeof record.delivered === "boolean"
  );
}

export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolCallRecord> {
  const result = await client.callTool({ name, arguments: args });
  if (!isToolResult(result.structuredContent)) throw new Error(`${name} returned no structured result`);
  return { name, isError: result.isError === true, ...result.structuredContent };
}

/** Request ids must be unique per relay run; reusing one returns the earlier result. */
export function runId(): string {
  return Date.now().toString(36);
}
