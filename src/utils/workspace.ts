import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { WorkspaceMetadata } from "../types/index.js";
import {
  DEFAULT_SPECIFY_DIR,
  CANDIDATE_CONSTITUTION_PATHS,
  CANDIDATE_SPECS_DIRS,
} from "../config/defaults.js";

/**
 * Safely resolves a subpath within a workspace root, throwing an error if traversal
 * attempts to escape the root boundary.
 *
 * @param workspaceRoot Normalized path to the workspace root directory
 * @param subPath Relative path within the workspace
 * @returns Canonical absolute path strictly inside workspaceRoot
 * @throws Error if subpath attempts directory traversal outside workspaceRoot
 */
export function resolveSafeSubpath(workspaceRoot: string, subPath: string): string {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("Invalid workspace root provided: must be a non-empty string");
  }
  if (typeof subPath !== "string") {
    throw new Error("Invalid subpath provided: must be a string");
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(resolvedRoot, subPath);

  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Security Error: Path traversal detected - path escapes workspace root: ${subPath}`
    );
  }

  return resolvedTarget;
}

/**
 * Helper to check if a file or directory exists at the given path.
 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to check if a directory exists at the given path.
 */
async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Validates a target workspace path, resolving canonical paths, checking git and
 * specify markers, locating active constitution and specs directories, and
 * collecting warnings for uninitialized states.
 *
 * Guaranteed pure utility: emits zero bytes to stdout.
 *
 * @param rawPath Raw filesystem path to the workspace root
 * @returns Resolved WorkspaceMetadata
 */
export async function validateWorkspacePath(rawPath: string): Promise<WorkspaceMetadata> {
  if (!rawPath || typeof rawPath !== "string") {
    return {
      rootPath: "",
      hasGit: false,
      hasSpecify: false,
      specifyPath: null,
      constitutionPath: null,
      specsPath: null,
      isValid: false,
      error: "Workspace path must be a non-empty string",
      warnings: [],
    };
  }

  const rootPath = path.resolve(rawPath);
  const warnings: string[] = [];

  // 1. Verify existence & is directory
  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) {
      return {
        rootPath,
        hasGit: false,
        hasSpecify: false,
        specifyPath: null,
        constitutionPath: null,
        specsPath: null,
        isValid: false,
        error: `Workspace path exists but is not a directory: ${rootPath}`,
        warnings,
      };
    }
  } catch {
    return {
      rootPath,
      hasGit: false,
      hasSpecify: false,
      specifyPath: null,
      constitutionPath: null,
      specsPath: null,
      isValid: false,
      error: `Workspace path does not exist: ${rootPath}`,
      warnings,
    };
  }

  // 2. Check for .git marker (file or dir, e.g. git worktrees or normal repo)
  const gitDirPath = path.join(rootPath, ".git");
  const hasGit = await pathExists(gitDirPath);

  // 3. Check for .specify directory
  const specifyDirPath = path.join(rootPath, DEFAULT_SPECIFY_DIR);
  const hasSpecify = await isDirectory(specifyDirPath);
  const specifyPath = hasSpecify ? specifyDirPath : null;

  // 4. Validate workspace initialization status
  const isValid = hasGit || hasSpecify;
  if (!isValid) {
    warnings.push(
      `Workspace directory '${rootPath}' is uninitialized: missing both .git and .specify landmarks.`
    );
  }

  // 5. Discover active constitution file
  let constitutionPath: string | null = null;
  for (const candidate of CANDIDATE_CONSTITUTION_PATHS) {
    const candidatePath = path.join(rootPath, candidate);
    if (await pathExists(candidatePath)) {
      constitutionPath = candidatePath;
      break;
    }
  }

  if (isValid && !constitutionPath) {
    warnings.push(
      `Active constitution artifact not found. Checked: ${CANDIDATE_CONSTITUTION_PATHS.join(", ")}`
    );
  }

  // 6. Discover specs directory
  let specsPath: string | null = null;
  for (const candidate of CANDIDATE_SPECS_DIRS) {
    const candidatePath = path.join(rootPath, candidate);
    if (await isDirectory(candidatePath)) {
      specsPath = candidatePath;
      break;
    }
  }

  if (isValid && !specsPath) {
    warnings.push(
      `Specifications directory not found. Checked: ${CANDIDATE_SPECS_DIRS.join(", ")}`
    );
  }

  return {
    rootPath,
    hasGit,
    hasSpecify,
    specifyPath,
    constitutionPath,
    specsPath,
    isValid,
    warnings,
  };
}
