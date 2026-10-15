/**
 * Pure read-only Git subprocess wrapper for spec-guard-mcp.
 * Strictly uses promisified child_process.execFile("git", [...args], { cwd: workspacePath })
 * exclusively (zero shell interpolation) and enforces zero external protocol imports.
 */

import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { MAX_DIFF_CHARS } from "../config/defaults.js";
import type { GitDiffResult } from "../types/index.js";

const execFile = promisify(execFileCallback);

/**
 * Retrieves the active Git branch name for a validated workspace directory.
 * Uses `git rev-parse --abbrev-ref HEAD` with fallback to `git branch --show-current`
 * and graceful fallback to "HEAD" for detached or unborn branch states.
 */
export async function getCurrentBranch(workspacePath: string): Promise<string> {
  // 1. Primary query: git rev-parse --abbrev-ref HEAD
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: workspacePath,
    });
    const ref = stdout.trim();
    if (ref.length > 0) {
      return ref;
    }
  } catch {
    // If unborn branch (no commits yet), rev-parse --abbrev-ref HEAD might fail
  }

  // 2. Fallback query: git branch --show-current
  try {
    const { stdout } = await execFile("git", ["branch", "--show-current"], {
      cwd: workspacePath,
    });
    const branch = stdout.trim();
    if (branch.length > 0) {
      return branch;
    }
  } catch {
    // Fall back to alternative queries if show-current fails
  }

  // 3. Fallback: symbolic-ref
  try {
    const { stdout } = await execFile("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: workspacePath,
    });
    const symRef = stdout.trim();
    if (symRef.length > 0) {
      return symRef;
    }
  } catch {
    // Fall back to HEAD
  }

  return "HEAD";
}

/**
 * Retrieves an array of staged file paths relative to the repository root
 * using `git diff --cached --name-only`.
 */
export async function getStagedFiles(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFile("git", ["diff", "--cached", "--name-only"], {
      cwd: workspacePath,
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Retrieves modified, deleted, and untracked file paths in the working tree
 * using `git status --porcelain`.
 */
export async function getWorkingTreeFiles(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFile("git", ["status", "--porcelain"], {
      cwd: workspacePath,
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        // Porcelain format is: XY <path> or XY "<path>" (or old -> new for renames)
        const rawPath = line.substring(2).trim();
        const unquoted = rawPath.replace(/^"|"$/g, "");
        if (unquoted.includes(" -> ")) {
          const parts = unquoted.split(" -> ");
          return parts[parts.length - 1];
        }
        return unquoted;
      });
  } catch {
    return [];
  }
}

/**
 * Backwards compatibility alias for getWorkingTreeFiles.
 */
export const getWorkingTreeStatus = getWorkingTreeFiles;

/**
 * Retrieves the unified staged git diff and list of staged file paths.
 * Truncates diff output at MAX_DIFF_CHARS (15,000) and sets truncated = true when exceeded.
 */
export async function getStagedDiff(
  workspacePath: string,
  maxChars: number = MAX_DIFF_CHARS
): Promise<GitDiffResult & { stagedFiles: string[] }> {
  let stagedFiles: string[] = [];
  try {
    const { stdout: filesStdout } = await execFile(
      "git",
      ["diff", "--cached", "--name-only"],
      { cwd: workspacePath }
    );
    stagedFiles = filesStdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    stagedFiles = [];
  }

  try {
    const { stdout: diffStdout } = await execFile(
      "git",
      ["diff", "--cached", "-U3"],
      {
        cwd: workspacePath,
        maxBuffer: 15 * 1024 * 1024,
      }
    );

    if (diffStdout.length > maxChars) {
      const truncatedDiff =
        diffStdout.slice(0, maxChars) +
        "\n\n[Diff truncated: exceeded character limit]";
      return {
        diff: truncatedDiff,
        truncated: true,
        stagedFiles,
      };
    }

    return {
      diff: diffStdout,
      truncated: false,
      stagedFiles,
    };
  } catch {
    return {
      diff: "",
      truncated: false,
      stagedFiles: [],
    };
  }
}
