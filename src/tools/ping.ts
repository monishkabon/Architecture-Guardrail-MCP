import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../config/index.js";
import type { HealthStatusPayload } from "../types/index.js";

export const PING_TOOL_NAME = "ping_spec_guard";
export const PING_TOOL_DESCRIPTION =
  "Basic health-check ping tool so developers can verify protocol connectivity and server responsiveness in MCP Inspector.";

export const pingInputSchema = z.object({});

export async function handlePing(): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const payload: HealthStatusPayload = {
    status: "ok",
    server: SERVER_NAME,
    version: SERVER_VERSION,
    timestamp: new Date().toISOString(),
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

export function registerPingTool(server: McpServer): void {
  server.tool(PING_TOOL_NAME, PING_TOOL_DESCRIPTION, pingInputSchema.shape, async () => {
    return handlePing();
  });
}
