/**
 * Pure read-only Git subprocess wrapper for spec-guard-mcp.
 * Strictly uses execFile with argument arrays (zero shell interpolation)
 * and enforces zero external protocol imports.
 */

import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { MAX_DIFF_CHARS } from "../config/defaults.js";
import type { GitDiffResult } from "../types/index.js";

const execFile = promisify(execFileCallback);

/**
 * Retrieves the active Git branch name for a validated workspace directory.
 * Gracefully handles unborn branches (no commits yet) and detached HEAD states.
 */
export async function getCurrentBranch(workspacePath: string): Promise<string> {
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

  try {
    const { stdout } = await execFile("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: workspacePath,
    });
    const symRef = stdout.trim();
    if (symRef.length > 0) {
      return symRef;
    }
  } catch {
    // Fall back
  }

  return "HEAD";
}

/**
 * Retrieves an array of staged file paths relative to the repository root.
 */
export async function getStagedFiles(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFile("git", ["diff", "--name-only", "--cached"], {
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
 * Retrieves modified, deleted, and untracked file paths in the working tree.
 */
export async function getWorkingTreeStatus(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFile("git", ["status", "--porcelain=v1"], {
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
 * Retrieves the unified staged git diff, safely truncated to maxChars.
 * Appends a prominent notice and sets truncated: true if the threshold is exceeded.
 */
export async function getStagedDiff(
  workspacePath: string,
  maxChars: number = MAX_DIFF_CHARS
): Promise<GitDiffResult> {
  try {
    const { stdout } = await execFile("git", ["diff", "--cached", "-U3"], {
      cwd: workspacePath,
      maxBuffer: 15 * 1024 * 1024,
    });

    if (stdout.length > maxChars) {
      const truncatedDiff =
        stdout.slice(0, maxChars) +
        "\n\n[Diff truncated: exceeded character limit]";
      return {
        diff: truncatedDiff,
        truncated: true,
      };
    }

    return {
      diff: stdout,
      truncated: false,
    };
  } catch {
    return {
      diff: "",
      truncated: false,
    };
  }
}
