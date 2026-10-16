/**
 * Project Constitution Resource Handler (T011) for spec-guard-mcp.
 * Exposes read-only, token-optimized constitution principles and forbidden pattern rules.
 */

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateWorkspacePath } from "../utils/workspace.js";
import { parseConstitutionFile, stripTokenNoise } from "../utils/markdown.js";
import {
  MAX_RESOURCE_CHARS,
  CANDIDATE_CONSTITUTION_PATHS,
} from "../config/defaults.js";

export const CONSTITUTION_RESOURCE_URI = "spec://project/constitution";

/**
 * Retrieves the token-optimized content for the Project Constitution Resource.
 * Pure helper exportable for unit tests and prompt workflow templates.
 *
 * @param workspacePath Optional explicit target workspace path
 * @returns MCP resource content payload with uri, mimeType, and clean Markdown text
 */
export async function getConstitutionResourceContent(
  workspacePath?: string
): Promise<{ uri: string; mimeType: string; text: string }> {
  const targetWorkspace =
    workspacePath ?? process.env.SPEC_GUARD_WORKSPACE ?? process.cwd();

  const wsMetadata = await validateWorkspacePath(targetWorkspace);

  if (!wsMetadata.constitutionPath) {
    const diagnostic = [
      "# Spec Guard Diagnostic: Constitution Unavailable",
      "",
      `**Resource**: \`${CONSTITUTION_RESOURCE_URI}\``,
      `**Workspace Root**: \`${wsMetadata.rootPath || targetWorkspace}\``,
      "**Status**: Constitution artifact not found.",
      "",
      "### Diagnostic Details",
      "Checked candidate paths:",
      ...CANDIDATE_CONSTITUTION_PATHS.map((p) => `- \`${p}\``),
      "",
      "### Suggested Remediation",
      "Create `.specify/memory/constitution.md` or `constitution.md` to define project architectural principles and forbidden patterns.",
    ].join("\n");

    return {
      uri: CONSTITUTION_RESOURCE_URI,
      mimeType: "text/markdown",
      text: diagnostic,
    };
  }

  try {
    const parsed = await parseConstitutionFile(wsMetadata.constitutionPath);

    const metadataHeader = [
      `> **Spec Guard Constitution Context** (Source: \`${parsed.frontmatter?.title ?? wsMetadata.constitutionPath}\` | Rules: ${parsed.rules.length})`,
      "",
    ].join("\n");

    const fullContent = `${metadataHeader}\n${parsed.cleanMarkdown}`;
    const truncatedContent = stripTokenNoise(fullContent, MAX_RESOURCE_CHARS);

    return {
      uri: CONSTITUTION_RESOURCE_URI,
      mimeType: "text/markdown",
      text: truncatedContent,
    };
  } catch (error) {
    const diagnostic = [
      "# Spec Guard Diagnostic: Error Reading Constitution",
      "",
      `**Resource**: \`${CONSTITUTION_RESOURCE_URI}\``,
      `**Target File**: \`${wsMetadata.constitutionPath}\``,
      `**Error**: ${error instanceof Error ? error.message : String(error)}`,
      "",
      "### Suggested Remediation",
      "Verify file permissions and that the constitution Markdown file contains valid content.",
    ].join("\n");

    return {
      uri: CONSTITUTION_RESOURCE_URI,
      mimeType: "text/markdown",
      text: diagnostic,
    };
  }
}

/**
 * Registers the Project Constitution Resource on the given McpServer instance.
 *
 * @param server McpServer instance
 */
export function registerConstitutionResource(server: McpServer): void {
  server.resource(
    "project-constitution",
    CONSTITUTION_RESOURCE_URI,
    {
      description: "Project constitution and architectural guardrails",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const ws = uri.searchParams?.get("workspacePath") ?? undefined;
      const content = await getConstitutionResourceContent(ws);
      return { contents: [content] };
    }
  );

  server.resource(
    "project-constitution-query",
    new ResourceTemplate(`${CONSTITUTION_RESOURCE_URI}{?workspacePath}`, { list: undefined, complete: {} }),
    {
      description: "Project constitution and architectural guardrails with workspacePath query",
      mimeType: "text/markdown",
    },
    async (_uri, variables) => {
      const rawWs = variables.workspacePath as string | undefined;
      const ws = rawWs ? decodeURIComponent(rawWs) : undefined;
      const content = await getConstitutionResourceContent(ws);
      return { contents: [content] };
    }
  );
}
