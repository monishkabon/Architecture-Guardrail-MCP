/**
 * Active Branch Spec Resource Handler (T012) for spec-guard-mcp.
 * Detects current branch or latest feature folder and bundles spec.md, plan.md, and tasks.md into a token-lean Markdown payload.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateWorkspacePath, resolveSafeSubpath } from "../utils/workspace.js";
import { getCurrentBranch } from "../utils/git.js";
import { stripTokenNoise } from "../utils/markdown.js";
import {
  MAX_RESOURCE_CHARS,
  DEFAULT_SPECS_DIR,
} from "../config/defaults.js";

export const ACTIVE_SPEC_RESOURCE_URI = "spec://branch/current";

/**
 * Safely reads and cleans an optional Markdown artifact within a feature directory.
 */
async function readOptionalArtifact(
  workspaceRoot: string,
  featureDir: string,
  filename: string
): Promise<string | null> {
  try {
    const fullPath = path.join(featureDir, filename);
    const relativeToRoot = path.relative(workspaceRoot, fullPath);
    const safePath = resolveSafeSubpath(workspaceRoot, relativeToRoot);
    const content = await fs.readFile(safePath, "utf-8");
    return stripTokenNoise(content);
  } catch {
    return null;
  }
}

/**
 * Retrieves the token-optimized content for the Active Branch Spec Resource.
 * Pure helper exportable for unit tests and prompt workflow templates.
 *
 * @param workspacePath Optional explicit target workspace path
 * @returns MCP resource content payload with uri, mimeType, and bundled Markdown text
 */
export async function getActiveSpecResourceContent(
  workspacePath?: string
): Promise<{ uri: string; mimeType: string; text: string }> {
  const targetWorkspace =
    workspacePath ?? process.env.SPEC_GUARD_WORKSPACE ?? process.cwd();

  const wsMetadata = await validateWorkspacePath(targetWorkspace);

  if (!wsMetadata.specsPath) {
    const diagnostic = [
      "# Spec Guard Diagnostic: Specs Directory Unavailable",
      "",
      `**Resource**: \`${ACTIVE_SPEC_RESOURCE_URI}\``,
      `**Workspace Root**: \`${wsMetadata.rootPath || targetWorkspace}\``,
      "**Status**: Specifications directory not found.",
      "",
      "### Diagnostic Details",
      `Checked candidate path: \`${DEFAULT_SPECS_DIR}\``,
      "",
      "### Suggested Remediation",
      "Run `specify init` or create a `specs/` directory to store feature specifications.",
    ].join("\n");

    return {
      uri: ACTIVE_SPEC_RESOURCE_URI,
      mimeType: "text/markdown",
      text: diagnostic,
    };
  }

  // 1. Detect branch name (safe fallback if non-git)
  let branch = "unknown";
  try {
    branch = await getCurrentBranch(wsMetadata.rootPath);
  } catch {
    branch = "unknown";
  }

  // 2. Discover feature subdirectories in specsPath
  let subdirs: string[] = [];
  try {
    const entries = await fs.readdir(wsMetadata.specsPath, { withFileTypes: true });
    subdirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    subdirs = [];
  }

  if (subdirs.length === 0) {
    const diagnostic = [
      "# Spec Guard Diagnostic: No Feature Specifications Found",
      "",
      `**Resource**: \`${ACTIVE_SPEC_RESOURCE_URI}\``,
      `**Workspace Root**: \`${wsMetadata.rootPath}\``,
      `**Specs Directory**: \`${wsMetadata.specsPath}\``,
      "**Status**: No feature directories found under `specs/`.",
      "",
      "### Suggested Remediation",
      "Use `/speckit-specify <feature description>` to create your first feature specification directory.",
    ].join("\n");

    return {
      uri: ACTIVE_SPEC_RESOURCE_URI,
      mimeType: "text/markdown",
      text: diagnostic,
    };
  }

  // 3. Match feature directory by branch name or fallback
  const cleanBranch = branch.replace(/^(?:feature|feat|bugfix)\//, "");
  let matchedDir: string | undefined;

  const isGeneric = ["main", "master", "head", "unknown", ""].includes(cleanBranch.toLowerCase());
  if (!isGeneric) {
    // Exact directory match
    matchedDir = subdirs.find((d) => d === branch || d === cleanBranch);

    // Prefix match (e.g. numeric prefix or substring prefix)
    if (!matchedDir) {
      const numericPrefix = cleanBranch.match(/^(\d{3,})/)?.[1];
      matchedDir = subdirs.find((d) => {
        if (d.startsWith(cleanBranch)) return true;
        if (numericPrefix && d.startsWith(numericPrefix)) return true;
        return false;
      });
    }
  }

  // Fallback: Latest feature directory sorted descending alphabetically
  if (!matchedDir) {
    const sorted = [...subdirs].sort((a, b) => b.localeCompare(a));
    matchedDir = sorted[0];
  }

  const featureDir = path.join(wsMetadata.specsPath, matchedDir);

  // 4. Read available artifacts
  const specText = await readOptionalArtifact(wsMetadata.rootPath, featureDir, "spec.md");
  const planText = await readOptionalArtifact(wsMetadata.rootPath, featureDir, "plan.md");
  const tasksText = await readOptionalArtifact(wsMetadata.rootPath, featureDir, "tasks.md");

  // 5. Combine under standard Markdown section headers
  const bundled = [
    `# Active Feature: ${matchedDir} (Branch: ${branch})`,
    "",
    "## Specification",
    specText ?? "*No specification document found.*",
    "",
    "## Implementation Plan",
    planText ?? "*No implementation plan found.*",
    "",
    "## Task Checklist",
    tasksText ?? "*No task checklist found.*",
  ].join("\n");

  const truncatedContent = stripTokenNoise(bundled, MAX_RESOURCE_CHARS);

  return {
    uri: ACTIVE_SPEC_RESOURCE_URI,
    mimeType: "text/markdown",
    text: truncatedContent,
  };
}

/**
 * Registers the Active Branch Spec Resource on the given McpServer instance.
 *
 * @param server McpServer instance
 */
export function registerActiveSpecResource(server: McpServer): void {
  server.resource(
    "active-branch-spec",
    ACTIVE_SPEC_RESOURCE_URI,
    {
      description: "Active branch specification, implementation plan, and tasks",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const ws = uri.searchParams?.get("workspacePath") ?? undefined;
      const content = await getActiveSpecResourceContent(ws);
      return { contents: [content] };
    }
  );

  server.resource(
    "active-branch-spec-template",
    new ResourceTemplate(`${ACTIVE_SPEC_RESOURCE_URI}{?workspacePath}`, { list: undefined, complete: {} }),
    {
      description: "Active branch specification, implementation plan, and tasks with workspacePath query",
      mimeType: "text/markdown",
    },
    async (_uri, variables) => {
      const rawWs = variables.workspacePath as string | undefined;
      const ws = rawWs ? decodeURIComponent(rawWs) : undefined;
      const content = await getActiveSpecResourceContent(ws);
      return { contents: [content] };
    }
  );
}
