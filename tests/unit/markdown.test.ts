import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  stripMarkdownNoise,
  parseConstitution,
  parseTasksFile,
} from "../../src/utils/markdown.js";

describe("Markdown Utilities (src/utils/markdown.ts)", () => {
  const currentWorkspace = process.cwd();
  const mockRepoPath = path.join(currentWorkspace, "tests/fixtures/mock-repo");

  describe("stripMarkdownNoise", () => {
    it("strips HTML comments from markdown text", () => {
      const raw = "# Title\n<!-- This is an internal comment -->\nContent here.\n<!-- Multi-line\ncomment -->";
      const stripped = stripMarkdownNoise(raw);
      expect(stripped).not.toContain("This is an internal comment");
      expect(stripped).not.toContain("Multi-line");
      expect(stripped).toContain("# Title");
      expect(stripped).toContain("Content here.");
    });

    it("strips shield and badge markdown images and badge links", () => {
      const raw = [
        "# My Project",
        "[![Build Status](https://img.shields.io/github/actions/workflow/status/owner/repo/ci.yml)](https://github.com/owner/repo/actions)",
        "![Coverage Badge](https://codecov.io/gh/owner/repo/branch/main/graph/badge.svg)",
        "![npm version](https://badge.fury.io/js/my-pkg.svg)",
        "Actual documentation paragraph that should be retained.",
      ].join("\n");

      const stripped = stripMarkdownNoise(raw);
      expect(stripped).not.toContain("img.shields.io");
      expect(stripped).not.toContain("codecov.io");
      expect(stripped).not.toContain("badge.fury.io");
      expect(stripped).toContain("Actual documentation paragraph that should be retained.");
    });

    it("collapses runs of 3 or more newlines into exactly 2 newlines", () => {
      const raw = "Paragraph 1\n\n\n\n\nParagraph 2\n\n\n\nParagraph 3";
      const stripped = stripMarkdownNoise(raw);
      expect(stripped).toBe("Paragraph 1\n\nParagraph 2\n\nParagraph 3");
    });

    it("trims trailing whitespace on lines", () => {
      const raw = "Line with trailing spaces   \nAnother line  ";
      const stripped = stripMarkdownNoise(raw);
      expect(stripped).toBe("Line with trailing spaces\nAnother line");
    });

    it("truncates content when maxChars is provided", () => {
      const raw = "A".repeat(500);
      const stripped = stripMarkdownNoise(raw, 100);
      expect(stripped.length).toBeLessThanOrEqual(150);
      expect(stripped).toContain("[Content truncated");
    });
  });

  describe("parseConstitution", () => {
    it("parses custom forbidden regex rules from constitution bullet lists", async () => {
      const constitutionPath = path.join(
        mockRepoPath,
        ".specify/memory/constitution.md"
      );
      const result = await parseConstitution(constitutionPath);

      expect(result.rules.length).toBeGreaterThanOrEqual(3);

      const noEvalRule = result.rules.find((r) => r.id === "NO_EVAL");
      expect(noEvalRule).toBeDefined();
      expect(noEvalRule?.pattern).toBe("eval\\(");
      expect(noEvalRule?.regex?.test("eval('bad code')")).toBe(true);
      expect(noEvalRule?.description).toContain("prohibited");

      const noVarRule = result.rules.find((r) => r.id === "NO_VAR");
      expect(noVarRule).toBeDefined();
      expect(noVarRule?.regex?.test("var x = 1;")).toBe(true);
      expect(noVarRule?.regex?.test("const x = 1;")).toBe(false);

      const noDebuggerRule = result.rules.find((r) => r.id === "NO_DEBUGGER");
      expect(noDebuggerRule).toBeDefined();
      expect(noDebuggerRule?.regex?.test("debugger;")).toBe(true);
    });

    it("parses raw content cleanly", async () => {
      const constitutionPath = path.join(
        mockRepoPath,
        ".specify/memory/constitution.md"
      );
      const result = await parseConstitution(constitutionPath);
      expect(result.rawContent).toContain("# Mock Project Constitution");
    });
  });

  describe("parseTasksFile", () => {
    it("parses task items, extracts relative paths, and verifies disk presence", async () => {
      const tasksPath = path.join(
        mockRepoPath,
        "specs/001-sample-feature/tasks.md"
      );
      const specPath = path.join(
        mockRepoPath,
        "specs/001-sample-feature/spec.md"
      );

      const result = await parseTasksFile(
        mockRepoPath,
        "001-sample-feature",
        specPath,
        tasksPath
      );

      expect(result.featureId).toBe("001-sample-feature");
      expect(result.totalTasks).toBe(4);
      expect(result.completedTasks).toBe(2);
      expect(result.pendingTasks).toBe(2);
      expect(result.tasks).toHaveLength(4);

      // T001 references `src/existing.ts` which exists on disk in mock-repo
      const t001 = result.tasks.find((t) => t.id === "T001");
      expect(t001).toBeDefined();
      expect(t001?.status).toBe("completed");
      expect(t001?.referencedFiles).toContain("src/existing.ts");
      expect(t001?.fileExistence["src/existing.ts"]).toBe(true);

      // T004 references `tests/missing.test.ts` which does NOT exist on disk
      const t004 = result.tasks.find((t) => t.id === "T004");
      expect(t004).toBeDefined();
      expect(t004?.status).toBe("pending");
      expect(t004?.referencedFiles).toContain("tests/missing.test.ts");
      expect(t004?.fileExistence["tests/missing.test.ts"]).toBe(false);

      // Because some tasks are pending and some files missing, isValid should be false
      expect(result.isValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("Architectural & Stream Purity Constraints", () => {
    it("does not write anything to stdout during markdown operations", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write");
      const consoleLogSpy = vi.spyOn(console, "log");

      stripMarkdownNoise("<!-- test --> text");
      const constitutionPath = path.join(
        mockRepoPath,
        ".specify/memory/constitution.md"
      );
      await parseConstitution(constitutionPath);

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it("does not import external protocol SDK in markdown.ts", async () => {
      const markdownSrc = await fs.readFile(
        path.join(currentWorkspace, "src/utils/markdown.ts"),
        "utf-8"
      );
      expect(markdownSrc).not.toContain("@modelcontextprotocol" + "/sdk");
    });
  });
});
