import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_SERVER_CONFIG } from "./config/index.js";
import { registerPingTool } from "./tools/ping.js";
import { registerValidateDiffTool } from "./tools/validateDiff.js";
import { registerCheckTasksTool } from "./tools/checkTasks.js";
import { registerScaffoldModuleTool } from "./tools/scaffoldModule.js";
import { registerConstitutionResource } from "./resources/constitution.js";
import { registerActiveSpecResource } from "./resources/activeSpec.js";
import { registerPreCommitAuditPrompt } from "./prompts/preCommitAudit.js";
import type { ServerConfig } from "./types/index.js";

export function createMcpServer(customConfig?: Partial<ServerConfig>): McpServer {
  const config = { ...DEFAULT_SERVER_CONFIG, ...customConfig };

  const server = new McpServer({
    name: config.name,
    version: config.version,
  });

  // Register foundational tools
  registerPingTool(server);

  // Register Phase 5 MCP Tools
  registerValidateDiffTool(server);
  registerCheckTasksTool(server);
  registerScaffoldModuleTool(server);

  // Register Phase 4 MCP Resources
  registerConstitutionResource(server);
  registerActiveSpecResource(server);

  // Register Phase 6 MCP Workflow Prompts
  registerPreCommitAuditPrompt(server);

  return server;
}

/**
 * Backward compatibility alias for createMcpServer.
 */
export const createServer = createMcpServer;
