import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { ToolResult } from "../../../shared/protocol/index.ts";
import { toolDefinitions, type JsonSchema } from "./tool-schemas.ts";

export const MODERN_PROTOCOL = "2026-07-28";
export const LEGACY_PROTOCOL = "2025-11-25";
export const SERVER_INFO = { name: "vr-mcp-server", version: "0.1.0" } as const;
export const INSTRUCTIONS =
  "Tools show_scene, render_panel, and clear update one paired display. delivered is true only after that display acknowledges the sequence. A queued result has not been shown. This server is not a dialogue API.";

export interface ToolOutcome {
  isError: boolean;
  payload: ToolResult;
}

/** Implemented by the relay hub; it validates, queues and waits for the display ACK. */
export interface ToolCaller {
  call(name: string, args: unknown): Promise<ToolOutcome>;
}

/**
 * Publishes `jsonSchema` in tools/list without letting the SDK reject calls.
 * Rejections must come from the relay as a `ToolResult` with an `error_code`,
 * which an SDK-level schema failure would replace with a free-text error.
 */
function advertiseOnly(jsonSchema: JsonSchema): StandardSchemaWithJSON<Record<string, unknown>> {
  return {
    "~standard": {
      version: 1,
      vendor: "quest-vr-assistant",
      validate: (value) => ({ value: value as Record<string, unknown> }),
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  };
}

export function createToolServer(caller: ToolCaller): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    supportedProtocolVersions: [MODERN_PROTOCOL, LEGACY_PROTOCOL],
  });
  for (const tool of toolDefinitions) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: advertiseOnly(tool.inputSchema) },
      async (args) => {
        const outcome = await caller.call(tool.name, args);
        return {
          content: [{ type: "text", text: JSON.stringify(outcome.payload) }],
          structuredContent: { ...outcome.payload },
          isError: outcome.isError,
        };
      },
    );
  }
  return server;
}
