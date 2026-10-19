/**
 * Feature Spec Scaffolder Tool (T015) for spec-guard-mcp.
 * Sanitizes featureName into kebab-case, auto-assigns next sequential 3-digit prefix,
 * enforces path traversal protection via resolveSafeSubpath, and generates
 * constitution-compliant spec.md and tasks.md templates.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateWorkspacePath, resolveSafeSubpath } from "../utils/workspace.js";
import type { FeatureScaffoldResult } from "../types/index.js";

export const SCAFFOLD_MODULE_TOOL_NAME = "init_feature_spec";
export const SCAFFOLD_MODULE_TOOL_DESCRIPTION =
  "Scaffolds a new sequential feature specification directory with compliant spec.md and tasks.md templates under specs/.";

export const scaffoldModuleInputSchema = z.object({
  workspacePath: z.string().describe("Absolute filesystem path to the workspace root directory."),
  featureName: z
    .string()
    .describe("Human-readable or kebab-case feature name (e.g. 'MCP Guardrail Tools'). Sanitized automatically."),
  summary: z.string().describe("Concise summary of the feature purpose and scope."),
  overwrite: z
    .boolean()
    .optional()
    .default(false)
    .describe("When true, allows overwriting existing spec.md and tasks.md templates."),
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runner function for feature specification scaffolding.
 * Exportable for direct unit testing and prompt workflows.
 */
export async function runInitFeatureSpec(args: {
  workspacePath: string;
  featureName: string;
  summary: string;
  overwrite?: boolean;
}): Promise<FeatureScaffoldResult> {
  const ws = await validateWorkspacePath(args.workspacePath);
  if (!ws.isValid) {
    throw new Error(ws.error || `Invalid workspace path: ${args.workspacePath}`);
  }

  // Ensure specs directory exists
  const specsDir = resolveSafeSubpath(ws.rootPath, "specs");
  await fs.mkdir(specsDir, { recursive: true });

  if (!args.featureName || typeof args.featureName !== "string") {
    throw new Error("Invalid featureName: must be a non-empty string");
  }

  if (
    args.featureName.includes("..") ||
    args.featureName.includes("/") ||
    args.featureName.includes("\\")
  ) {
    throw new Error(
      `Security Error: Path traversal or invalid path characters detected in featureName: ${args.featureName}`
    );
  }

  // Sanitize featureName to lowercase kebab-case
  const sanitizedName = args.featureName
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  if (!sanitizedName) {
    throw new Error("Invalid featureName: sanitized name is empty");
  }

  let featureId: string;
  if (/^\d{3}-/.test(sanitizedName)) {
    featureId = sanitizedName;
  } else {
    // Scan existing directories in specs/ for 3-digit prefixes
    let maxPrefix = 0;
    try {
      const entries = await fs.readdir(specsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const match = entry.name.match(/^(\d{3})-/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxPrefix) {
              maxPrefix = num;
            }
          }
        }
      }
    } catch {
      maxPrefix = 0;
    }

    const nextPrefix = String(maxPrefix + 1).padStart(3, "0");
    featureId = `${nextPrefix}-${sanitizedName}`;
  }

  const featureDir = resolveSafeSubpath(specsDir, featureId);
  const specPath = resolveSafeSubpath(featureDir, "spec.md");
  const tasksPath = resolveSafeSubpath(featureDir, "tasks.md");

  const specExists = await fileExists(specPath);
  const tasksExists = await fileExists(tasksPath);

  if ((specExists || tasksExists) && !args.overwrite) {
    throw new Error(
      `Feature specification already exists at '${featureDir}'. Pass overwrite: true to overwrite.`
    );
  }

  await fs.mkdir(featureDir, { recursive: true });

  const dateStr = new Date().toISOString().slice(0, 10);

  const specContent = [
    "---",
    `feature: ${featureId}`,
    "status: draft",
    `created: ${dateStr}`,
    "---",
    "",
    `# Feature Specification: ${featureId}`,
    "",
    "## Summary",
    args.summary,
    "",
    "## Architectural Guardrails",
    "- STDIO Stream Purity: All stdout output reserved exclusively for MCP JSON-RPC protocol.",
    "- Pure Core Engine: Utilities in src/utils/ must remain pure and free from protocol imports.",
    "",
    "## Acceptance Criteria",
    "- All functional requirements and edge cases implemented.",
    "- All tasks in tasks.md completed and verified with zero missing file references.",
    "",
  ].join("\n");

  const tasksContent = [
    `# Tasks: ${featureId}`,
    "",
    `**Input**: Feature specification from \`spec.md\``,
    "",
    "## Phase 1: Setup",
    "",
    "- [ ] T001 Initialize feature structure and configuration",
    "",
    "## Phase 2: Implementation",
    "",
    "- [ ] T002 Implement core functionality per spec.md",
    "",
    "## Phase 3: Verification",
    "",
    "- [ ] T003 [P] Add unit and integration tests",
    "",
  ].join("\n");

  await fs.writeFile(specPath, specContent, "utf-8");
  await fs.writeFile(tasksPath, tasksContent, "utf-8");

  return {
    created: true,
    featureId,
    featureDir,
    specPath,
    tasksPath,
    summary: `Feature specification '${featureId}' scaffolded successfully at '${featureDir}'.`,
  };
}

/**
 * Registers the init_feature_spec tool on the McpServer instance.
 */
export function registerScaffoldModuleTool(server: McpServer): void {
  server.tool(
    SCAFFOLD_MODULE_TOOL_NAME,
    SCAFFOLD_MODULE_TOOL_DESCRIPTION,
    scaffoldModuleInputSchema.shape,
    async (args) => {
      try {
        const result = await runInitFeatureSpec(args);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  passed: false,
                  error: message,
                  remediation:
                    "Verify workspacePath is a valid workspace and featureName contains valid characters.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
