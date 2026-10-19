/**
 * Staged Diff Validator Tool (T013) for spec-guard-mcp.
 * Validates git staged additions against forbidden stdout emissions,
 * architectural boundary rules, and repository constitution patterns.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateWorkspacePath } from "../utils/workspace.js";
import { parseConstitutionFile } from "../utils/markdown.js";
import { getCurrentBranch, getStagedDiff } from "../utils/git.js";
import { evaluateUnifiedDiff } from "../utils/validator.js";
import type { DiffValidationResult, ForbiddenPatternRule } from "../types/index.js";

export const VALIDATE_DIFF_TOOL_NAME = "validate_staged_diff";
export const VALIDATE_DIFF_TOOL_DESCRIPTION =
  "Validates git staged additions against forbidden stdout emissions, architectural boundary rules, and repository constitution patterns.";

export const validateDiffInputSchema = z.object({
  workspacePath: z.string().describe("Absolute filesystem path to the workspace root directory."),
  strictMode: z
    .boolean()
    .optional()
    .describe("When true (default), any violation (including warnings) fails validation."),
});

/**
 * Runner function for staged diff validation.
 * Exportable for direct unit testing and prompt workflows.
 */
export async function runValidateStagedDiff(args: {
  workspacePath: string;
  strictMode?: boolean;
}): Promise<DiffValidationResult> {
  const ws = await validateWorkspacePath(args.workspacePath);
  if (!ws.isValid) {
    throw new Error(ws.error || `Invalid workspace path: ${args.workspacePath}`);
  }

  let customRules: ForbiddenPatternRule[] | undefined;
  if (ws.constitutionPath) {
    try {
      const parsedConst = await parseConstitutionFile(ws.constitutionPath);
      customRules = parsedConst.rules;
    } catch {
      customRules = undefined;
    }
  }

  let branch = "unknown";
  try {
    branch = await getCurrentBranch(ws.rootPath);
  } catch {
    branch = "unknown";
  }

  const stagedDiffResult = await getStagedDiff(ws.rootPath);

  const evalResult = evaluateUnifiedDiff({
    diff: stagedDiffResult.diff,
    branch,
    customRules,
    truncated: stagedDiffResult.truncated,
  });

  const isStrict = args.strictMode !== false;
  let passed = evalResult.passed ?? evalResult.isValid;

  if (isStrict && evalResult.violations.length > 0) {
    passed = false;
  }

  let summaryText = evalResult.summaryText;
  if (!passed && evalResult.summary.errorCount === 0 && evalResult.summary.warningCount > 0) {
    summaryText = `Diff validation failed in strict mode with ${evalResult.summary.warningCount} warning(s) across ${evalResult.checkedLinesCount} added lines.`;
  }

  return {
    ...evalResult,
    passed,
    isValid: passed,
    summaryText,
  };
}

/**
 * Registers the validate_staged_diff tool on the McpServer instance.
 */
export function registerValidateDiffTool(server: McpServer): void {
  server.tool(
    VALIDATE_DIFF_TOOL_NAME,
    VALIDATE_DIFF_TOOL_DESCRIPTION,
    validateDiffInputSchema.shape,
    async (args) => {
      try {
        const result = await runValidateStagedDiff(args);
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
                    "Verify workspacePath contains a valid .git repository and constitution.",
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
