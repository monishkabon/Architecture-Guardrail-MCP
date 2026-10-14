import { describe, it, expect, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { validateWorkspacePath, resolveSafeSubpath } from "../../src/utils/workspace.js";

describe("Workspace Utilities (src/utils/workspace.ts)", () => {
  const currentWorkspace = process.cwd();

  describe("resolveSafeSubpath", () => {
    it("safely resolves a valid subpath within workspace root", () => {
      const resolved = resolveSafeSubpath(currentWorkspace, "src/index.ts");
      expect(resolved).toBe(path.join(currentWorkspace, "src/index.ts"));
    });

    it("safely normalizes inner relative segments that remain within workspace root", () => {
      const resolved = resolveSafeSubpath(currentWorkspace, "src/../src/index.ts");
      expect(resolved).toBe(path.join(currentWorkspace, "src/index.ts"));
    });

    it("throws a security error when attempting traversal outside workspace root with ..", () => {
      expect(() => {
        resolveSafeSubpath(currentWorkspace, "../escaped.txt");
      }).toThrow(/traversal|escapes workspace/i);
    });

    it("throws a security error on deep traversal attacks", () => {
      expect(() => {
        resolveSafeSubpath(currentWorkspace, "sub/../../../../etc/passwd");
      }).toThrow(/traversal|escapes workspace/i);
    });

    it("throws when workspace root itself is empty or invalid", () => {
      expect(() => {
        resolveSafeSubpath("", "sub/file.txt");
      }).toThrow();
    });
  });

  describe("validateWorkspacePath", () => {
    it("validates the current repository containing .git and .specify", async () => {
      const metadata = await validateWorkspacePath(currentWorkspace);

      expect(metadata.isValid).toBe(true);
      expect(metadata.rootPath).toBe(path.resolve(currentWorkspace));
      expect(metadata.hasGit).toBe(true);
      expect(metadata.hasSpecify).toBe(true);
      expect(metadata.specifyPath).toBe(path.join(metadata.rootPath, ".specify"));
      expect(metadata.constitutionPath).toBe(
        path.join(metadata.rootPath, ".specify/memory/constitution.md")
      );
      expect(metadata.specsPath).toBe(path.join(metadata.rootPath, "specs"));
      expect(metadata.error).toBeUndefined();
    });

    it("resolves relative path '.' to absolute path correctly", async () => {
      const metadata = await validateWorkspacePath(".");
      expect(metadata.isValid).toBe(true);
      expect(metadata.rootPath).toBe(path.resolve("."));
    });

    it("returns isValid=false with error for non-existent path", async () => {
      const nonExistent = path.join(currentWorkspace, "non-existent-directory-xyz");
      const metadata = await validateWorkspacePath(nonExistent);

      expect(metadata.isValid).toBe(false);
      expect(metadata.error).toBeDefined();
      expect(metadata.error).toMatch(/does not exist/i);
    });

    it("returns isValid=false when target path is a file rather than a directory", async () => {
      const filePath = path.join(currentWorkspace, "package.json");
      const metadata = await validateWorkspacePath(filePath);

      expect(metadata.isValid).toBe(false);
      expect(metadata.error).toBeDefined();
      expect(metadata.error).toMatch(/not a directory/i);
    });

    it("returns isValid=false with warning for directory lacking both .git and .specify", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uninitialized-repo-"));
      try {
        const metadata = await validateWorkspacePath(tempDir);
        expect(metadata.isValid).toBe(false);
        expect(metadata.hasGit).toBe(false);
        expect(metadata.hasSpecify).toBe(false);
        expect(metadata.warnings.some((w) => /uninitialized|missing/i.test(w))).toBe(true);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("recognizes a workspace with only .git as valid", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-only-repo-"));
      try {
        await fs.mkdir(path.join(tempDir, ".git"));
        const metadata = await validateWorkspacePath(tempDir);

        expect(metadata.isValid).toBe(true);
        expect(metadata.hasGit).toBe(true);
        expect(metadata.hasSpecify).toBe(false);
        expect(metadata.specifyPath).toBeNull();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("recognizes a workspace with only .specify as valid", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "specify-only-repo-"));
      try {
        await fs.mkdir(path.join(tempDir, ".specify"));
        const metadata = await validateWorkspacePath(tempDir);

        expect(metadata.isValid).toBe(true);
        expect(metadata.hasGit).toBe(false);
        expect(metadata.hasSpecify).toBe(true);
        expect(metadata.specifyPath).toBe(path.join(tempDir, ".specify"));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("falls back to root constitution.md if .specify/memory/constitution.md is absent", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fallback-constitution-repo-"));
      try {
        await fs.mkdir(path.join(tempDir, ".specify"));
        await fs.writeFile(path.join(tempDir, "constitution.md"), "# Root Constitution");

        const metadata = await validateWorkspacePath(tempDir);
        expect(metadata.isValid).toBe(true);
        expect(metadata.constitutionPath).toBe(path.join(tempDir, "constitution.md"));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("never emits any data to stdout preserving STDIO purity", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write");
      const consoleLogSpy = vi.spyOn(console, "log");

      await validateWorkspacePath(currentWorkspace);

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });

  describe("Architectural Constraints (Constitution Section 3)", () => {
    it("does not import @modelcontextprotocol/sdk in workspace.ts", async () => {
      const workspaceSrc = await fs.readFile(
        path.join(currentWorkspace, "src/utils/workspace.ts"),
        "utf-8"
      );
      expect(workspaceSrc).not.toContain("@modelcontextprotocol/sdk");
    });
  });

  describe("SpecKit Defaults & Configuration (src/config/)", () => {
    it("exports standard candidate paths, token limits, and forbidden stdout patterns", async () => {
      const config = await import("../../src/config/index.js");

      expect(config.DEFAULT_SPECIFY_DIR).toBe(".specify");
      expect(config.DEFAULT_SPECS_DIR).toBe("specs");
      expect(config.MAX_DIFF_CHARS).toBe(15000);
      expect(config.MAX_FILE_PREVIEW_CHARS).toBe(10000);
      expect(config.CANDIDATE_CONSTITUTION_PATHS).toContain(".specify/memory/constitution.md");
      expect(config.CANDIDATE_CONSTITUTION_PATHS).toContain("constitution.md");
      expect(config.DEFAULT_SPECKIT_CONFIG.maxDiffChars).toBe(15000);
      expect(config.FORBIDDEN_STDOUT_PATTERNS.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Mock Repository Fixture (tests/fixtures/mock-repo/)", () => {
    it("validates mock-repo fixture with constitution, specs, and git marker", async () => {
      const mockRepoPath = path.join(currentWorkspace, "tests/fixtures/mock-repo");
      const metadata = await validateWorkspacePath(mockRepoPath);

      expect(metadata.isValid).toBe(true);
      expect(metadata.hasGit).toBe(true);
      expect(metadata.hasSpecify).toBe(true);
      expect(metadata.specifyPath).toBe(path.join(mockRepoPath, ".specify"));
      expect(metadata.constitutionPath).toBe(
        path.join(mockRepoPath, ".specify/memory/constitution.md")
      );
      expect(metadata.specsPath).toBe(path.join(mockRepoPath, "specs"));
      expect(metadata.warnings.length).toBe(0);

      // Verify fixture files exist and are readable
      const specContent = await fs.readFile(
        path.join(mockRepoPath, "specs/001-sample-feature/spec.md"),
        "utf-8"
      );
      expect(specContent).toContain("# Feature Specification: Sample Feature");

      const tasksContent = await fs.readFile(
        path.join(mockRepoPath, "specs/001-sample-feature/tasks.md"),
        "utf-8"
      );
      expect(tasksContent).toContain("- [X] T001");
      expect(tasksContent).toContain("- [ ] T004");

      const existingCode = await fs.readFile(
        path.join(mockRepoPath, "src/existing.ts"),
        "utf-8"
      );
      expect(existingCode).toContain("parseSampleRecord");
    });
  });
});
