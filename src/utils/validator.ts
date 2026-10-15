/**
 * Deterministic Git Diff Validator for spec-guard-mcp.
 * Parses unified diff chunks, isolates added lines, and evaluates them
 * against default forbidden patterns, custom rules, and architectural boundaries.
 */

import { FORBIDDEN_STDOUT_PATTERNS } from "../config/defaults.js";
import type {
  AddedDiffLine,
  DiffValidationResult,
  DiffViolation,
  ForbiddenPatternRule,
} from "../types/index.js";

/**
 * Parses unified git diff text and extracts only newly added or modified lines (+),
 * tracking accurate target file line numbers and explicitly ignoring diff headers (+++ b/).
 */
export function extractAddedLinesFromDiff(rawDiff: string): AddedDiffLine[] {
  if (!rawDiff) {
    return [];
  }

  const lines = rawDiff.split("\n");
  const addedLines: AddedDiffLine[] = [];

  let currentFile = "";
  let currentLineNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header detection: diff --git a/path b/path
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?)\s+b\/(.+)$/);
      if (match) {
        currentFile = match[2].trim();
      }
      continue;
    }

    // New file header: +++ b/path (or +++ /dev/null for deleted files)
    if (line.startsWith("+++ ")) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.slice(6).trim();
      } else if (line.startsWith("+++ /dev/null")) {
        currentFile = "";
      }
      continue;
    }

    // Old file header: --- a/path
    if (line.startsWith("--- ")) {
      continue;
    }

    // Chunk header detection: @@ -oldStart,oldCount +newStart,newCount @@
    if (line.startsWith("@@ ")) {
      const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (hunkMatch) {
        currentLineNumber = parseInt(hunkMatch[1], 10);
      }
      continue;
    }

    // If no active file is tracked, skip
    if (!currentFile) {
      continue;
    }

    // Inspect additions vs context vs deletions
    if (line.startsWith("+")) {
      // Ignore triple-plus file headers if encountered
      if (line.startsWith("+++")) {
        continue;
      }

      addedLines.push({
        file: currentFile,
        line: currentLineNumber,
        content: line.slice(1),
      });
      currentLineNumber++;
    } else if (line.startsWith(" ")) {
      // Unchanged context line advances line number in target file
      currentLineNumber++;
    }
  }

  return addedLines;
}

/**
 * Evaluates added lines in git diff against default forbidden stdout emissions,
 * custom constitutional regex patterns, and architectural boundaries.
 */
export function validateDiffContent(params: {
  rawDiff: string;
  branch: string;
  customRules?: ForbiddenPatternRule[];
  truncated?: boolean;
}): DiffValidationResult {
  const addedLines = extractAddedLinesFromDiff(params.rawDiff);
  const violations: DiffViolation[] = [];

  const protocolSdkPackage = "@modelcontextprotocol" + "/sdk";

  for (const addedLine of addedLines) {
    const { file, line, content } = addedLine;

    // 1. Default forbidden patterns (stdout emissions in server codebase)
    for (const pattern of FORBIDDEN_STDOUT_PATTERNS) {
      if (content.includes(pattern)) {
        violations.push({
          ruleId: "FORBIDDEN_STDOUT",
          category: "Stream Purity",
          file,
          line,
          hunk: content,
          severity: "error",
          message: `Standard output emission forbidden (${pattern}). Use console.error() instead.`,
          remediation: `Replace ${pattern} with console.error() or route diagnostics to stderr.`,
        });
      }
    }

    // 2. Custom constitutional rules
    if (params.customRules && params.customRules.length > 0) {
      for (const rule of params.customRules) {
        const isMatch = rule.regex
          ? rule.regex.test(content)
          : content.includes(rule.pattern);

        if (isMatch) {
          violations.push({
            ruleId: rule.id,
            category: "Constitutional Rule",
            file,
            line,
            hunk: content,
            severity: rule.severity || "error",
            message: rule.description,
            remediation: `Adhere to rule ${rule.id}: ${rule.description}`,
          });
        }
      }
    }

    // 3. Architectural Boundary Guardrail:
    // Files inside src/utils/ must never import the protocol SDK
    const isUtilsFile =
      file.startsWith("src/utils/") || file.includes("/src/utils/");
    if (isUtilsFile && content.includes(protocolSdkPackage)) {
      violations.push({
        ruleId: "ARCHITECTURAL_BOUNDARY_UTILS",
        category: "Architectural Boundaries",
        file,
        line,
        hunk: content,
        severity: "error",
        message: `Core engine utilities in src/utils/ must remain pure and cannot import ${protocolSdkPackage}.`,
        remediation:
          "Move MCP protocol interaction to src/tools/, src/resources/, or src/server.ts, keeping src/utils/ framework-agnostic.",
      });
    }
  }

  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;

  return {
    isValid: errorCount === 0,
    violations,
    checkedLinesCount: addedLines.length,
    summary: {
      totalViolations: violations.length,
      errorCount,
      warningCount,
    },
    truncated: params.truncated ?? false,
  };
}
