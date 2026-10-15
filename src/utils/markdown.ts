/**
 * Pure Markdown & Spec parser utilities for spec-guard-mcp.
 * Implements token noise reduction, constitution rule parsing,
 * and task artifact verification with disk presence checking.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import matter from "gray-matter";
import type {
  ForbiddenPatternRule,
  ParsedConstitution,
  TaskItem,
  TaskVerificationResult,
} from "../types/index.js";

/**
 * Strips HTML comments, shield/status badges, and excessive blank lines from Markdown text
 * to optimize context token efficiency for LLM consumption.
 */
export function stripMarkdownNoise(raw: string, maxChars?: number): string {
  if (!raw) {
    return "";
  }

  // 1. Strip HTML comments (<!-- ... -->)
  let cleaned = raw.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Strip shield / status badges
  // 2a. Badges wrapped in links: [![alt](image-url)](link-url)
  cleaned = cleaned.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "");

  // 2b. Standalone badge images: ![alt](badge-url)
  cleaned = cleaned.replace(
    /!\[[^\]]*\]\([^)]*(?:badge|shields\.io|codecov|travis-ci|circleci|actions\/workflow)[^)]*\)/gi,
    ""
  );

  // 3. Trim trailing whitespace per line
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // 4. Collapse runs of 3 or more newlines into exactly 2 newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // 5. Truncate if maxChars specified
  if (maxChars !== undefined && maxChars > 0 && cleaned.length > maxChars) {
    return (
      cleaned.slice(0, maxChars) +
      "\n\n[Content truncated: exceeded character limit]"
    );
  }

  return cleaned;
}

/**
 * Parses custom forbidden regex rules from a constitution.md bullet list.
 * Expected syntax: `- \`RULE_ID\`: \`REGEX\` — Description`
 */
export async function parseConstitution(
  filePath: string
): Promise<ParsedConstitution> {
  const content = await fs.readFile(filePath, "utf-8");
  const parsed = matter(content);

  const rules: ForbiddenPatternRule[] = [];
  // Match lines like: - `RULE_ID`: `REGEX` — Description
  // Tolerates bullets: - or *, and separators: em-dash (—), en-dash (–), or hyphen (-)
  const ruleRegex = /^[\s* -]*[-*]\s+`([^`]+)`:\s+`([^`]+)`\s*(?:[—–-]|--)\s*(.+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = ruleRegex.exec(parsed.content)) !== null) {
    const id = match[1].trim();
    const pattern = match[2].trim();
    const description = match[3].trim();

    let compiledRegex: RegExp | undefined;
    try {
      compiledRegex = new RegExp(pattern);
    } catch {
      // Invalid regular expression syntax in constitution
    }

    rules.push({
      id,
      pattern,
      regex: compiledRegex,
      description,
      severity: "error",
    });
  }

  return {
    rules,
    rawContent: parsed.content,
    frontmatter: Object.keys(parsed.data).length > 0 ? parsed.data : undefined,
  };
}

/**
 * Parses tasks.md, extracts checklist items, identifies backtick-quoted relative file paths,
 * and checks their actual existence on disk inside workspacePath.
 */
export async function parseTasksFile(
  workspacePath: string,
  featureId: string,
  _specPath: string | null,
  tasksPath: string
): Promise<TaskVerificationResult> {
  const resolvedTasksPath = path.isAbsolute(tasksPath)
    ? tasksPath
    : path.resolve(workspacePath, tasksPath);

  const content = await fs.readFile(resolvedTasksPath, "utf-8");
  const lines = content.split("\n");

  const taskRegex = /^[\s* -]*[-*]\s+\[([ xX])\]\s*(.*)$/;
  const pathRegex = /`([a-zA-Z0-9_\-\./]+(?:\.[a-zA-Z0-9]+|\/|[a-zA-Z0-9_\-]+))`(?:\s|\b|$)/g;

  const tasks: TaskItem[] = [];
  const warnings: string[] = [];

  let completedTasks = 0;
  let pendingTasks = 0;
  let allFilesExist = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = taskRegex.exec(line);
    if (!match) {
      continue;
    }

    const isCompleted = match[1].toLowerCase() === "x";
    const lineText = match[2].trim();
    const lineNumber = i + 1;

    if (isCompleted) {
      completedTasks++;
    } else {
      pendingTasks++;
    }

    // Extract task ID (e.g. T001, [T001], or sequential fallback)
    const idMatch = lineText.match(/\b(T\d+)\b/);
    const id = idMatch ? idMatch[1] : `T${String(tasks.length + 1).padStart(3, "0")}`;

    // Extract backtick-quoted relative file paths
    const referencedFiles: string[] = [];
    const fileExistence: Record<string, boolean> = {};

    let pathMatch: RegExpExecArray | null;
    while ((pathMatch = pathRegex.exec(lineText)) !== null) {
      const candidatePath = pathMatch[1].trim();
      // Only treat as relative path if it resembles a file or directory path
      if (
        candidatePath.includes("/") ||
        candidatePath.endsWith(".ts") ||
        candidatePath.endsWith(".js") ||
        candidatePath.endsWith(".json") ||
        candidatePath.endsWith(".md")
      ) {
        if (!referencedFiles.includes(candidatePath)) {
          referencedFiles.push(candidatePath);
        }
      }
    }

    // Check disk existence for each referenced file
    for (const relPath of referencedFiles) {
      const fullTarget = path.resolve(workspacePath, relPath);
      // Ensure path doesn't escape workspace
      const relativeToRoot = path.relative(workspacePath, fullTarget);
      if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        fileExistence[relPath] = false;
        allFilesExist = false;
        warnings.push(`Task ${id} references path outside workspace: ${relPath}`);
        continue;
      }

      try {
        await fs.stat(fullTarget);
        fileExistence[relPath] = true;
      } catch {
        fileExistence[relPath] = false;
        allFilesExist = false;
        warnings.push(`Task ${id} references missing file on disk: ${relPath}`);
      }
    }

    tasks.push({
      id,
      description: lineText,
      status: isCompleted ? "completed" : "pending",
      line: lineNumber,
      referencedFiles,
      fileExistence,
    });
  }

  if (pendingTasks > 0) {
    warnings.push(`${pendingTasks} task(s) remaining incomplete in ${featureId}`);
  }

  const isValid = tasks.length > 0 && pendingTasks === 0 && allFilesExist;

  return {
    featureId,
    totalTasks: tasks.length,
    completedTasks,
    pendingTasks,
    tasks,
    isValid,
    warnings,
  };
}
