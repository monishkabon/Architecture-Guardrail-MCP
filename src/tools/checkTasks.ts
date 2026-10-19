/**
 * Spec Task Verifier Tool (T014) for spec-guard-mcp.
 * Parses tasks.md in the specified or detected feature directory,
 * verifying task completion checkboxes and checking on-disk presence for all referenced files.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateWorkspacePath, resolveSafeSubpath } from "../utils/workspace.js";
import { getCurrentBranch } from "../utils/git.js";
import { parseTasksFile } from "../utils/markdown.js";
import type { TaskItem, TaskVerificationResult } from "../types/index.js";

export const CHECK_TASKS_TOOL_NAME = "verify_spec_tasks";
export const CHECK_TASKS_TOOL_DESCRIPTION =
  "Parses tasks.md in the specified or detected feature directory, verifying task completion checkboxes and checking on-disk presence for all referenced files.";

export const checkTasksInputSchema = z.object({
  workspacePath: z.string().describe("Absolute filesystem path to the workspace root directory."),
  featureId: z
    .string()
    .optional()
    .describe(
      "Optional feature directory name under specs/ (e.g. '001-sample-feature'). If omitted, resolves via current Git branch or latest feature directory."
    ),
});

/**
 * Runner function for task and file presence verification.
 * Exportable for direct unit testing and prompt workflows.
 */
export async function runVerifySpecTasks(args: {
  workspacePath: string;
  featureId?: string;
}): Promise<TaskVerificationResult> {
  const ws = await validateWorkspacePath(args.workspacePath);
  if (!ws.isValid) {
    throw new Error(ws.error || `Invalid workspace path: ${args.workspacePath}`);
  }

  if (!ws.specsPath) {
    throw new Error(`Specifications directory not found: ${ws.rootPath}`);
  }

  let resolvedFeatureId: string;
  let featureDir: string;

  if (args.featureId) {
    featureDir = resolveSafeSubpath(ws.specsPath, args.featureId);
    try {
      const stat = await fs.stat(featureDir);
      if (!stat.isDirectory()) {
        throw new Error(`Target feature path is not a directory: ${args.featureId}`);
      }
    } catch {
      throw new Error(`Feature directory not found: ${args.featureId}`);
    }
    resolvedFeatureId = args.featureId;
  } else {
    let branch = "unknown";
    try {
      branch = await getCurrentBranch(ws.rootPath);
    } catch {
      branch = "unknown";
    }

    let subdirs: string[] = [];
    try {
      const entries = await fs.readdir(ws.specsPath, { withFileTypes: true });
      subdirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch {
      subdirs = [];
    }

    if (subdirs.length === 0) {
      throw new Error(`No feature directories found under specs/ in: ${ws.rootPath}`);
    }

    const cleanBranch = branch.replace(/^(?:feature|feat|bugfix)\//, "");
    let matchedDir: string | undefined;

    const isGeneric = ["main", "master", "head", "unknown", ""].includes(
      cleanBranch.toLowerCase()
    );
    if (!isGeneric) {
      matchedDir = subdirs.find((d) => d === branch || d === cleanBranch);
      if (!matchedDir) {
        const numericPrefix = cleanBranch.match(/^(\d{3,})/)?.[1];
        matchedDir = subdirs.find((d) => {
          if (d.startsWith(cleanBranch)) return true;
          if (numericPrefix && d.startsWith(numericPrefix)) return true;
          return false;
        });
      }
    }

    if (!matchedDir) {
      const sorted = [...subdirs].sort((a, b) => b.localeCompare(a));
      matchedDir = sorted[0];
    }

    resolvedFeatureId = matchedDir;
    featureDir = path.join(ws.specsPath, matchedDir);
  }

  const tasksPath = resolveSafeSubpath(featureDir, "tasks.md");
  try {
    const stat = await fs.stat(tasksPath);
    if (!stat.isFile()) {
      throw new Error(`tasks.md is not a file: ${tasksPath}`);
    }
  } catch {
    throw new Error(`tasks.md not found in feature directory: ${resolvedFeatureId}`);
  }

  // Parse tasks and check file existence on disk
  const tasks = (await parseTasksFile(tasksPath, ws.rootPath)) as TaskItem[];

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const pendingTasks = totalTasks - completedTasks;

  const allMissingFiles: string[] = [];
  const warnings: string[] = [];

  for (const t of tasks) {
    if (t.missingFiles && t.missingFiles.length > 0) {
      for (const m of t.missingFiles) {
        if (!allMissingFiles.includes(m)) {
          allMissingFiles.push(m);
        }
        warnings.push(`Task ${t.id} references missing file on disk: ${m}`);
      }
    }
  }

  if (pendingTasks > 0) {
    warnings.push(`${pendingTasks} task(s) remaining incomplete in ${resolvedFeatureId}`);
  }

  const missingFilesCount = allMissingFiles.length;
  const passed =
    totalTasks > 0 &&
    pendingTasks === 0 &&
    tasks.every((t) => !t.missingFiles || t.missingFiles.length === 0);

  const summary = passed
    ? `All ${totalTasks} task(s) in feature '${resolvedFeatureId}' are completed and all referenced files exist on disk.`
    : `Task verification failed for feature '${resolvedFeatureId}': ${completedTasks}/${totalTasks} completed, ${pendingTasks} pending, ${missingFilesCount} missing file reference(s).`;

  return {
    featureId: resolvedFeatureId,
    totalTasks,
    completedTasks,
    pendingTasks,
    missingFilesCount,
    tasks,
    isValid: passed,
    passed,
    warnings,
    summary,
  };
}

/**
 * Registers the verify_spec_tasks tool on the McpServer instance.
 */
export function registerCheckTasksTool(server: McpServer): void {
  server.tool(
    CHECK_TASKS_TOOL_NAME,
    CHECK_TASKS_TOOL_DESCRIPTION,
    checkTasksInputSchema.shape,
    async (args) => {
      try {
        const result = await runVerifySpecTasks(args);
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
                    "Verify workspacePath contains valid specifications in specs/ with tasks.md.",
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
