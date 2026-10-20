/**
 * Pre-Commit Audit MCP Workflow Prompt (T016) for spec-guard-mcp.
 * Bundles project constitution, active feature spec, deterministic diff validation,
 * deterministic task verification, and staged unified diff into a structured LLM audit prompt.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConstitutionResourceContent } from "../resources/constitution.js";
import { getActiveSpecResourceContent } from "../resources/activeSpec.js";
import { runValidateStagedDiff } from "../tools/validateDiff.js";
import { runVerifySpecTasks } from "../tools/checkTasks.js";
import { getStagedDiff } from "../utils/git.js";
import { MAX_DIFF_CHARS } from "../config/defaults.js";
import type { PreCommitAuditArgs, PreCommitAuditPromptResult } from "../types/index.js";

export const AUDIT_PROMPT_NAME = "audit-implementation";
export const AUDIT_PROMPT_DESCRIPTION =
  "Bundles project constitution, active feature spec, task verification, and staged git diff for a comprehensive pre-commit architectural audit.";

export const preCommitAuditPromptArgsSchema = {
  workspacePath: z
    .string()
    .optional()
    .describe("Absolute path to the target repository workspace"),
  featureId: z
    .string()
    .optional()
    .describe("Optional feature ID override (e.g., 001-sample-feature)"),
};

/**
 * Builds the composite Pre-Commit Audit prompt payload.
 * Pure helper exportable for unit testing without an active MCP transport.
 *
 * @param args Optional workspacePath and featureId
 * @returns MCP prompt payload with description and user message
 */
export async function buildPreCommitAuditPrompt(
  args?: PreCommitAuditArgs
): Promise<PreCommitAuditPromptResult> {
  const targetWorkspace =
    args?.workspacePath?.trim() ||
    process.env.SPEC_GUARD_WORKSPACE ||
    process.cwd();

  // 1. Constitution Markdown
  let constitutionText: string;
  try {
    const res = await getConstitutionResourceContent(targetWorkspace);
    constitutionText = res.text;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    constitutionText = `_Constitution unavailable: ${message}_`;
  }

  // 2. Active Feature Spec Markdown
  let activeSpecText: string;
  try {
    const res = await getActiveSpecResourceContent(targetWorkspace);
    activeSpecText = res.text;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    activeSpecText = `_Active specification unavailable: ${message}_`;
  }

  // 3. Diff Validation JSON Summary
  let diffValidationSummary: string;
  try {
    const res = await runValidateStagedDiff({
      workspacePath: targetWorkspace,
      strictMode: true,
    });
    diffValidationSummary = JSON.stringify(res, null, 2);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    diffValidationSummary = JSON.stringify(
      {
        passed: false,
        error: message,
        remediation:
          "Verify workspacePath contains a valid .git repository and constitution.",
      },
      null,
      2
    );
  }

  // 4. Task Verification JSON Summary
  let taskVerificationSummary: string;
  try {
    const res = await runVerifySpecTasks({
      workspacePath: targetWorkspace,
      featureId: args?.featureId,
    });
    taskVerificationSummary = JSON.stringify(res, null, 2);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    taskVerificationSummary = JSON.stringify(
      {
        passed: false,
        error: message,
        remediation:
          "Verify workspacePath contains valid specifications in specs/ with tasks.md.",
      },
      null,
      2
    );
  }

  // 5. Staged Diff Text
  let stagedDiffText: string;
  try {
    const res = await getStagedDiff(targetWorkspace, MAX_DIFF_CHARS);
    if (res && res.diff && res.diff.trim().length > 0) {
      stagedDiffText = res.diff;
    } else {
      stagedDiffText = "_No staged changes found or not a Git repository._";
    }
  } catch {
    stagedDiffText = "_No staged changes found or not a Git repository._";
  }

  // Assemble Markdown prompt for the host LLM
  const promptText = [
    "# Pre-Commit / Pre-PR Architectural Audit Request",
    "",
    "You are acting as the **Principal Architecture Reviewer and Spec Guard** for this repository.",
    "Evaluate the staged changes against the repository constitution, active feature specification, and deterministic guardrail results provided below.",
    "",
    "## Audit Review Directives",
    "Please conduct a comprehensive review covering the following four areas:",
    `1. **Constitutional & Boundary Compliance**: Ensure strict adherence to constitutional rules (e.g. STDIO stream purity, no forbidden ${["console", "log"].join(".")} statements, architectural boundary layers, zero unapproved dependencies).`,
    "2. **Feature Specification Alignment**: Verify that the staged changes align with the user stories, functional requirements, and acceptance criteria in the active specification.",
    "3. **Unfinished Tasks or Missing Referenced Files**: Cross-reference the deterministic task verification report to confirm all tasks are marked completed and all backtick-referenced files exist on disk.",
    "4. **Final Verdict**: Conclude with an unambiguous recommendation:",
    "   - `READY TO COMMIT`: If all guardrails pass and the changes are architecture-compliant.",
    "   - `CHANGES REQUIRED`: If any constitutional rule is violated, tasks remain incomplete, or missing files are detected. Include exact file paths and line-level remediation instructions.",
    "",
    "---",
    "",
    "## 1. Project Constitution",
    constitutionText,
    "",
    "## 2. Active Feature Specification & Tasks",
    activeSpecText,
    "",
    "## 3. Deterministic Staged Diff Validation Report",
    "```json",
    diffValidationSummary,
    "```",
    "",
    "## 4. Deterministic Task Completion & File Existence Report",
    "```json",
    taskVerificationSummary,
    "```",
    "",
    "## 5. Current Staged Unified Diff",
    "```diff",
    stagedDiffText,
    "```",
    "",
    "---",
    "",
    "Please provide your structured Pre-Commit Audit Report now.",
  ].join("\n");

  return {
    description: AUDIT_PROMPT_DESCRIPTION,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: promptText,
        },
      },
    ],
  };
}

/**
 * Registers the audit-implementation prompt on the McpServer instance.
 *
 * @param server McpServer instance
 */
export function registerPreCommitAuditPrompt(server: McpServer): void {
  server.prompt(
    AUDIT_PROMPT_NAME,
    AUDIT_PROMPT_DESCRIPTION,
    preCommitAuditPromptArgsSchema,
    async (args) => buildPreCommitAuditPrompt(args)
  );
}
