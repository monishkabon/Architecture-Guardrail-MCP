/**
 * Pure Markdown & Spec parser utilities for spec-guard-mcp.
 * Implements token noise reduction, constitution rule parsing,
 * and task artifact verification with disk presence checking.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import matter from "gray-matter";
import { resolveSafeSubpath } from "./workspace.js";
import type {
  ForbiddenPatternRule,
  ParsedConstitution,
  TaskItem,
  TaskVerificationResult,
} from "../types/index.js";

/**
 * Strips HTML comments (<!--[\s\S]*?-->), Markdown image badges (!\[[^\]]*\]\([^)]+\)),
 * and collapses 3+ consecutive newlines into exactly 2 to optimize context token efficiency.
 */
export function stripTokenNoise(rawMarkdown: string, maxChars?: number): string {
  if (!rawMarkdown) {
    return "";
  }

  // 1. Strip HTML comments (<!--[\s\S]*?-->)
  let cleaned = rawMarkdown.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Strip shield / status badges
  // 2a. Badges wrapped in links: [![alt](image-url)](link-url)
  cleaned = cleaned.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "");

  // 2b. Standalone badge images: ![alt](url)
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, "");

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
 * Backwards compatibility alias for stripTokenNoise.
 */
export const stripMarkdownNoise = stripTokenNoise;

/**
 * Parses YAML frontmatter, cleanMarkdown, protectedPaths, and custom forbidden
 * pattern rules under "## Forbidden Patterns" matching `- `([A-Z0-9_]+)`: `([^`]+)`\s*[—-]\s*(.+)`.
 */
export async function parseConstitutionFile(
  constitutionPath: string
): Promise<ParsedConstitution> {
  const content = await fs.readFile(constitutionPath, "utf-8");
  const parsed = matter(content);

  const cleanMarkdown = stripTokenNoise(parsed.content);

  // Extract protected paths from frontmatter or content if present
  let protectedPaths: string[] | undefined;
  if (parsed.data && Array.isArray(parsed.data.protectedPaths)) {
    protectedPaths = parsed.data.protectedPaths.map(String);
  } else if (parsed.data && typeof parsed.data.protectedPaths === "string") {
    protectedPaths = [parsed.data.protectedPaths];
  }

  const rules: ForbiddenPatternRule[] = [];

  // Scope rule parsing under "## Forbidden Patterns" heading if present (supporting optional numbering like "## 2. Forbidden Patterns")
  const headingMatch = /(?:^|\n)##\s+(?:\d+\.\s*)?Forbidden Patterns\s*\n([\s\S]*?)(?=(?:\n##\s+)|$)/i.exec(parsed.content);
  const targetSection = headingMatch ? headingMatch[1] : parsed.content;

  // Match: - `([A-Z0-9_]+)`: `([^`]+)`\s*[—-]\s*(.+)
  const ruleRegex = /^[\s* -]*[-*]\s+`([A-Z0-9_]+)`:\s+`([^`]+)`\s*(?:[—–-]|--)\s*(.+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = ruleRegex.exec(targetSection)) !== null) {
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
    cleanMarkdown,
    protectedPaths,
    frontmatter: Object.keys(parsed.data).length > 0 ? parsed.data : undefined,
  };
}

/**
 * Backwards compatibility alias for parseConstitutionFile.
 */
export const parseConstitution = parseConstitutionFile;

/**
 * Modern parser implementation returning TaskItem[].
 */
async function parseTasksModern(
  tasksFilePath: string,
  workspaceRoot: string
): Promise<TaskItem[]> {
  const resolvedTasksPath = path.isAbsolute(tasksFilePath)
    ? tasksFilePath
    : path.resolve(workspaceRoot, tasksFilePath);

  const content = await fs.readFile(resolvedTasksPath, "utf-8");
  const lines = content.split("\n");

  const taskRegex = /^[\s* -]*[-*]\s+\[([ xX])\]\s*(.*)$/;
  const pathRegex = /`([a-zA-Z0-9_\-\./]+(?:\.[a-zA-Z0-9]+|\/|[a-zA-Z0-9_\-]+))`(?:\s|\b|$)/g;

  const tasks: TaskItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = taskRegex.exec(line);
    if (!match) {
      continue;
    }

    const isCompleted = match[1].toLowerCase() === "x";
    const lineText = match[2].trim();
    const lineNumber = i + 1;

    // Extract task ID (e.g. T01, T001, [T001], or sequential fallback)
    const idMatch = lineText.match(/\b(T\d+)\b/);
    const id = idMatch ? idMatch[1] : `T${String(tasks.length + 1).padStart(3, "0")}`;

    // Extract backtick-quoted relative file paths containing / or a file extension
    const referencedFiles: string[] = [];
    const missingFiles: string[] = [];
    const fileExistence: Record<string, boolean> = {};

    let pathMatch: RegExpExecArray | null;
    while ((pathMatch = pathRegex.exec(lineText)) !== null) {
      const candidatePath = pathMatch[1].trim();
      if (
        candidatePath.includes("/") ||
        candidatePath.endsWith(".ts") ||
        candidatePath.endsWith(".js") ||
        candidatePath.endsWith(".json") ||
        candidatePath.endsWith(".md") ||
        candidatePath.endsWith(".txt") ||
        candidatePath.endsWith(".yml") ||
        candidatePath.endsWith(".yaml")
      ) {
        if (!referencedFiles.includes(candidatePath)) {
          referencedFiles.push(candidatePath);
        }
      }
    }

    // Check disk existence using resolveSafeSubpath
    for (const relPath of referencedFiles) {
      try {
        const fullTarget = resolveSafeSubpath(workspaceRoot, relPath);
        await fs.stat(fullTarget);
        fileExistence[relPath] = true;
      } catch {
        fileExistence[relPath] = false;
        missingFiles.push(relPath);
      }
    }

    tasks.push({
      id,
      description: lineText,
      status: isCompleted ? "completed" : "pending",
      line: lineNumber,
      referencedFiles,
      fileExistence,
      missingFiles,
    });
  }

  return tasks;
}

/**
 * Legacy parser returning TaskVerificationResult.
 */
async function parseTasksLegacy(
  workspacePath: string,
  featureId: string,
  _specPath: string | null,
  tasksPath: string
): Promise<TaskVerificationResult> {
  const tasks = await parseTasksModern(tasksPath, workspacePath);
  let completedTasks = 0;
  let pendingTasks = 0;
  let allFilesExist = true;
  const warnings: string[] = [];

  for (const t of tasks) {
    if (t.status === "completed") {
      completedTasks++;
    } else {
      pendingTasks++;
    }
    if (t.missingFiles && t.missingFiles.length > 0) {
      allFilesExist = false;
      for (const m of t.missingFiles) {
        warnings.push(`Task ${t.id} references missing file on disk: ${m}`);
      }
    }
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

/**
 * Overloaded parseTasksFile supporting:
 * 1. parseTasksFile(tasksFilePath, workspaceRoot): Promise<TaskItem[]>
 * 2. parseTasksFile(workspacePath, featureId, specPath, tasksPath): Promise<TaskVerificationResult>
 */
export async function parseTasksFile(
  tasksFilePath: string,
  workspaceRoot: string
): Promise<TaskItem[]>;
export async function parseTasksFile(
  workspacePath: string,
  featureId: string,
  specPath: string | null,
  tasksPath: string
): Promise<TaskVerificationResult>;
export async function parseTasksFile(
  arg1: string,
  arg2: string,
  arg3?: string | null,
  arg4?: string
): Promise<TaskItem[] | TaskVerificationResult> {
  if (arg3 !== undefined || arg4 !== undefined) {
    return parseTasksLegacy(arg1, arg2, arg3 ?? null, arg4 ?? "");
  }
  return parseTasksModern(arg1, arg2);
}
