import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import {
  getCurrentBranch,
  getStagedFiles,
  getWorkingTreeStatus,
  getStagedDiff,
} from "../../src/utils/git.js";
import { MAX_DIFF_CHARS } from "../../src/config/defaults.js";

const execFile = promisify(execFileCallback);

describe("Git Wrapper Utilities (src/utils/git.ts)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-test-repo-"));
    // Initialize a clean git repository
    await execFile("git", ["init", "-b", "main"], { cwd: tempDir });
    await execFile("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await execFile("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("getCurrentBranch", () => {
    it("returns branch name in an empty repo before any commits (unborn branch)", async () => {
      const branch = await getCurrentBranch(tempDir);
      expect(branch).toBe("main");
    });

    it("returns branch name after an initial commit", async () => {
      await fs.writeFile(path.join(tempDir, "initial.txt"), "hello world\n");
      await execFile("git", ["add", "initial.txt"], { cwd: tempDir });
      await execFile("git", ["commit", "-m", "Initial commit"], { cwd: tempDir });

      const branch = await getCurrentBranch(tempDir);
      expect(branch).toBe("main");
    });

    it("returns newly created branch name after switching", async () => {
      await fs.writeFile(path.join(tempDir, "initial.txt"), "hello world\n");
      await execFile("git", ["add", "initial.txt"], { cwd: tempDir });
      await execFile("git", ["commit", "-m", "Initial commit"], { cwd: tempDir });
      await execFile("git", ["checkout", "-b", "feature/core-engine"], { cwd: tempDir });

      const branch = await getCurrentBranch(tempDir);
      expect(branch).toBe("feature/core-engine");
    });

    it("returns HEAD or fallback in detached HEAD state", async () => {
      await fs.writeFile(path.join(tempDir, "initial.txt"), "hello world\n");
      await execFile("git", ["add", "initial.txt"], { cwd: tempDir });
      await execFile("git", ["commit", "-m", "Initial commit"], { cwd: tempDir });
      await execFile("git", ["checkout", "--detach"], { cwd: tempDir });

      const branch = await getCurrentBranch(tempDir);
      expect(branch).toMatch(/HEAD/i);
    });
  });

  describe("getStagedFiles", () => {
    it("returns empty array when nothing is staged", async () => {
      const staged = await getStagedFiles(tempDir);
      expect(staged).toEqual([]);
    });

    it("returns staged file paths relative to repository root", async () => {
      await fs.writeFile(path.join(tempDir, "file1.ts"), "export const a = 1;\n");
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "src/file2.ts"), "export const b = 2;\n");

      await execFile("git", ["add", "file1.ts", "src/file2.ts"], { cwd: tempDir });

      const staged = await getStagedFiles(tempDir);
      expect(staged).toHaveLength(2);
      expect(staged).toContain("file1.ts");
      expect(staged).toContain("src/file2.ts");
    });
  });

  describe("getWorkingTreeStatus", () => {
    it("returns empty array in clean repository", async () => {
      const status = await getWorkingTreeStatus(tempDir);
      expect(status).toEqual([]);
    });

    it("returns untracked and modified file paths", async () => {
      // Commit one file
      await fs.writeFile(path.join(tempDir, "committed.txt"), "first line\n");
      await execFile("git", ["add", "committed.txt"], { cwd: tempDir });
      await execFile("git", ["commit", "-m", "Initial commit"], { cwd: tempDir });

      // Modify committed file without staging
      await fs.appendFile(path.join(tempDir, "committed.txt"), "second line\n");

      // Create an untracked file
      await fs.writeFile(path.join(tempDir, "untracked.ts"), "const x = 10;\n");

      const status = await getWorkingTreeStatus(tempDir);
      expect(status).toHaveLength(2);
      expect(status.some((f) => f.includes("committed.txt"))).toBe(true);
      expect(status.some((f) => f.includes("untracked.ts"))).toBe(true);
    });
  });

  describe("getStagedDiff", () => {
    it("returns empty diff and truncated=false when no files are staged", async () => {
      const result = await getStagedDiff(tempDir);
      expect(result.diff).toBe("");
      expect(result.truncated).toBe(false);
    });

    it("returns staged unified diff for staged changes", async () => {
      await fs.writeFile(path.join(tempDir, "hello.txt"), "console.error('safe');\n");
      await execFile("git", ["add", "hello.txt"], { cwd: tempDir });

      const result = await getStagedDiff(tempDir);
      expect(result.diff).toContain("+console.error('safe');");
      expect(result.truncated).toBe(false);
    });

    it("truncates diff when diff length exceeds maxChars", async () => {
      // Generate a large file with repetitive text
      const largeContent = "const line = 'x'.repeat(100);\n".repeat(200); // ~6000 chars
      await fs.writeFile(path.join(tempDir, "large.txt"), largeContent);
      await execFile("git", ["add", "large.txt"], { cwd: tempDir });

      const customLimit = 500;
      const result = await getStagedDiff(tempDir, customLimit);

      expect(result.truncated).toBe(true);
      expect(result.diff.length).toBeLessThanOrEqual(customLimit + 200); // custom limit + truncation notice
      expect(result.diff).toContain("[Diff truncated: exceeded");
    });

    it("defaults to MAX_DIFF_CHARS (15,000) when maxChars is omitted", async () => {
      const veryLargeContent = ("const line = " + "y".repeat(100) + ";\n").repeat(250); // >28,000 chars
      await fs.writeFile(path.join(tempDir, "huge.txt"), veryLargeContent);
      await execFile("git", ["add", "huge.txt"], { cwd: tempDir });

      const result = await getStagedDiff(tempDir);
      expect(result.truncated).toBe(true);
      expect(result.diff.length).toBeLessThanOrEqual(MAX_DIFF_CHARS + 200);
      expect(result.diff).toContain("[Diff truncated: exceeded");
    });
  });

  describe("Architectural & Stream Purity Constraints", () => {
    it("does not write anything to stdout during git operations", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write");
      const consoleLogSpy = vi.spyOn(console, "log");

      await getCurrentBranch(tempDir);
      await getStagedFiles(tempDir);
      await getWorkingTreeStatus(tempDir);
      await getStagedDiff(tempDir);

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it("does not import @modelcontextprotocol/sdk in git.ts", async () => {
      const gitSrc = await fs.readFile(
        path.join(process.cwd(), "src/utils/git.ts"),
        "utf-8"
      );
      expect(gitSrc).not.toContain("@modelcontextprotocol/sdk");
    });
  });
});
