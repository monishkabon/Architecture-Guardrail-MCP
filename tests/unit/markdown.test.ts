import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  stripTokenNoise,
  stripMarkdownNoise,
  parseConstitutionFile,
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

    it("strips HTML comments, badges, and collapses whitespace using stripTokenNoise", () => {
      const raw = [
        "# My Project <!-- comment -->",
        "![Badge](https://img.shields.io/badge/status-active-green)",
        "",
        "",
        "",
        "Main paragraph.",
      ].join("\n");
      const stripped = stripTokenNoise(raw);
      expect(stripped).not.toContain("<!-- comment -->");
      expect(stripped).not.toContain("shields.io");
      expect(stripped).toBe("# My Project\n\nMain paragraph.");
    });
  });

  describe("parseConstitution & parseConstitutionFile", () => {
    it("parses custom forbidden regex rules including NO_RAW_SQL_DROP from constitution.md", async () => {
      const constitutionPath = path.join(
        mockRepoPath,
        ".specify/memory/constitution.md"
      );
      const result = await parseConstitutionFile(constitutionPath);

      expect(result.rules.length).toBeGreaterThanOrEqual(4);

      const noDropRule = result.rules.find((r) => r.id === "NO_RAW_SQL_DROP");
      expect(noDropRule).toBeDefined();
      expect(noDropRule?.pattern).toBe("DROP\\s+TABLE");
      expect(noDropRule?.regex?.test("DROP TABLE users;")).toBe(true);
      expect(noDropRule?.regex?.test("SELECT * FROM users;")).toBe(false);
      expect(noDropRule?.description).toContain("prohibited");

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

    it("extracts YAML frontmatter when present in markdown files", async () => {
      const tempConstitution = path.join(mockRepoPath, ".specify/memory/temp-frontmatter.md");
      const sample = [
        "---",
        "title: Test Constitution",
        "version: 1.2.3",
        "---",
        "# Title",
        "",
        "## Forbidden Patterns",
        "- `NO_ALERT`: `alert\\(` — Browser alert is forbidden",
      ].join("\n");

      await fs.writeFile(tempConstitution, sample, "utf-8");
      try {
        const result = await parseConstitution(tempConstitution);
        expect(result.frontmatter).toBeDefined();
        expect(result.frontmatter?.title).toBe("Test Constitution");
        expect(result.frontmatter?.version).toBe("1.2.3");
        expect(result.rules).toHaveLength(1);
        expect(result.rules[0].id).toBe("NO_ALERT");
      } finally {
        await fs.rm(tempConstitution, { force: true });
      }
    });

    it("parses custom ForbiddenPatternRule items exclusively under ## Forbidden Patterns heading", async () => {
      const tempConstitution = path.join(mockRepoPath, ".specify/memory/temp-heading.md");
      const sample = [
        "# Constitution",
        "",
        "## 1. Other Section",
        "- `OTHER_RULE`: `not_a_forbidden_rule` — Should be ignored",
        "",
        "## Forbidden Patterns",
        "- `REAL_RULE`: `real_pattern` — Should be parsed",
      ].join("\n");

      await fs.writeFile(tempConstitution, sample, "utf-8");
      try {
        const result = await parseConstitution(tempConstitution);
        expect(result.rules).toHaveLength(1);
        expect(result.rules[0].id).toBe("REAL_RULE");
        expect(result.rules.find((r) => r.id === "OTHER_RULE")).toBeUndefined();
      } finally {
        await fs.rm(tempConstitution, { force: true });
      }
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

    it("parses tasks.md with 2 arguments (tasksPath, workspaceRoot) and detects src/existing.ts vs src/missing.ts", async () => {
      const tasksPath = path.join(
        mockRepoPath,
        "specs/001-sample-feature/tasks.md"
      );

      const items = await parseTasksFile(tasksPath, mockRepoPath);
      expect(items.length).toBeGreaterThanOrEqual(3);

      const existingTask = items.find((t) => t.referencedFiles.includes("src/existing.ts"));
      expect(existingTask).toBeDefined();
      expect(existingTask?.fileExistence["src/existing.ts"]).toBe(true);
      expect(existingTask?.missingFiles).not.toContain("src/existing.ts");

      const missingTask = items.find((t) => t.referencedFiles.includes("src/missing.ts"));
      expect(missingTask).toBeDefined();
      expect(missingTask?.fileExistence["src/missing.ts"]).toBe(false);
      expect(missingTask?.missingFiles).toContain("src/missing.ts");
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
