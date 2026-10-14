import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_SERVER_CONFIG } from "./config/index.js";
import { registerPingTool } from "./tools/ping.js";
import type { ServerConfig } from "./types/index.js";

export function createMcpServer(customConfig?: Partial<ServerConfig>): McpServer {
  const config = { ...DEFAULT_SERVER_CONFIG, ...customConfig };

  const server = new McpServer({
    name: config.name,
    version: config.version,
  });

  // Register foundational tools
  registerPingTool(server);

  return server;
}
