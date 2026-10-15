import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  extractAddedLinesFromDiff,
  evaluateUnifiedDiff,
  validateDiffContent,
} from "../../src/utils/validator.js";
import type { ForbiddenPatternRule } from "../../src/types/index.js";

describe("Diff Validator Utilities (src/utils/validator.ts)", () => {
  const sampleDiff = `diff --git a/src/utils/sample.ts b/src/utils/sample.ts
index 1234567..89abcdef 100644
--- a/src/utils/sample.ts
+++ b/src/utils/sample.ts
@@ -10,4 +10,6 @@ export function sample() {
   const a = 1;
-  const b = 2;
+  const b = 3;
+  console.log("debug message");
+  return a + b;
 }
diff --git a/src/models/user.ts b/src/models/user.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/models/user.ts
@@ -0,0 +1,3 @@
+export interface User {
+  id: string;
+}
`;

  describe("extractAddedLinesFromDiff", () => {
    it("extracts only added lines and ignores diff headers like +++ b/", () => {
      const added = extractAddedLinesFromDiff(sampleDiff);

      // Should have 3 added lines from sample.ts and 3 added lines from user.ts = 6 lines
      expect(added).toHaveLength(6);

      // Verify no header line starting with +++ b/ was included
      const headerLine = added.find((l) => l.content.startsWith("++ b/") || l.content.startsWith("+ b/"));
      expect(headerLine).toBeUndefined();

      // Verify lines from sample.ts
      const sampleLines = added.filter((l) => l.file === "src/utils/sample.ts");
      expect(sampleLines).toHaveLength(3);
      expect(sampleLines[0].line).toBe(11);
      expect(sampleLines[0].content).toBe("  const b = 3;");
      expect(sampleLines[1].line).toBe(12);
      expect(sampleLines[1].content).toBe('  console.log("debug message");');
      expect(sampleLines[2].line).toBe(13);
      expect(sampleLines[2].content).toBe("  return a + b;");

      // Verify lines from user.ts
      const userLines = added.filter((l) => l.file === "src/models/user.ts");
      expect(userLines).toHaveLength(3);
      expect(userLines[0].line).toBe(1);
      expect(userLines[0].content).toBe("export interface User {");
      expect(userLines[1].line).toBe(2);
      expect(userLines[1].content).toBe("  id: string;");
      expect(userLines[2].line).toBe(3);
      expect(userLines[2].content).toBe("}");
    });

    it("returns empty array for empty diff or diff with only deletions", () => {
      const deletionDiff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,1 @@
-line1
-line2
 context
`;
      const added = extractAddedLinesFromDiff(deletionDiff);
      expect(added).toHaveLength(0);
    });
  });

  describe("validateDiffContent", () => {
    it("detects default forbidden stdout patterns (console.log)", () => {
      const result = validateDiffContent({
        rawDiff: sampleDiff,
        branch: "main",
      });

      expect(result.isValid).toBe(false);
      expect(result.summary.errorCount).toBeGreaterThanOrEqual(1);

      const stdoutViolation = result.violations.find((v) => v.ruleId === "FORBIDDEN_STDOUT");
      expect(stdoutViolation).toBeDefined();
      expect(stdoutViolation?.file).toBe("src/utils/sample.ts");
      expect(stdoutViolation?.line).toBe(12);
      expect(stdoutViolation?.hunk).toContain("console.log");
      expect(stdoutViolation?.category).toBe("Stream Purity");
    });

    it("detects architectural boundary violation when importing @modelcontextprotocol/sdk inside src/utils/", () => {
      const mcpImportInUtilsDiff = `diff --git a/src/utils/helper.ts b/src/utils/helper.ts
new file mode 100644
--- /dev/null
+++ b/src/utils/helper.ts
@@ -0,0 +1,2 @@
+import { Server } from "@modelcontextprotocol/sdk/server/index.js";
+export const helper = 1;
`;

      const result = evaluateUnifiedDiff({
        diff: mcpImportInUtilsDiff,
        branch: "feature/test",
      });

      expect(result.isValid).toBe(false);
      expect(result.passed).toBe(false);
      const boundaryViolation = result.violations.find((v) => v.ruleId === "BOUNDARY_NO_MCP_SDK_IN_UTILS");
      expect(boundaryViolation).toBeDefined();
      expect(boundaryViolation?.file).toBe("src/utils/helper.ts");
      expect(boundaryViolation?.line).toBe(1);
      expect(boundaryViolation?.severity).toBe("error");
      expect(boundaryViolation?.message).toContain("src/utils/");
      expect(result.summaryText).toContain("Diff validation failed");
    });

    it("detects child_process.exec violations in DEFAULT_FORBIDDEN_PATTERNS with exact line number", () => {
      const execDiff = `diff --git a/src/runner.ts b/src/runner.ts
--- a/src/runner.ts
+++ b/src/runner.ts
@@ -10,3 +10,4 @@
  const a = 1;
+ child_process.exec("rm -rf /");
  const b = 2;
`;

      const result = evaluateUnifiedDiff({
        diff: execDiff,
        branch: "main",
      });

      expect(result.isValid).toBe(false);
      expect(result.passed).toBe(false);
      const execViolation = result.violations.find((v) => v.hunk?.includes("child_process.exec"));
      expect(execViolation).toBeDefined();
      expect(execViolation?.line).toBe(11);
      expect(execViolation?.file).toBe("src/runner.ts");
    });

    it("detects custom NO_RAW_SQL_DROP rule violations with exact line number", () => {
      const customRules: ForbiddenPatternRule[] = [
        {
          id: "NO_RAW_SQL_DROP",
          pattern: "DROP\\s+TABLE",
          regex: /DROP\s+TABLE/,
          description: "Direct SQL DROP statements are prohibited",
          severity: "error",
        },
      ];

      const dropDiff = `diff --git a/src/db.ts b/src/db.ts
--- a/src/db.ts
+++ b/src/db.ts
@@ -20,2 +20,4 @@
  const query = "SELECT * FROM users";
+ const dropQuery = "DROP TABLE users";
+ await db.run(dropQuery);
`;

      const result = evaluateUnifiedDiff({
        diff: dropDiff,
        branch: "main",
        customRules,
      });

      expect(result.isValid).toBe(false);
      expect(result.passed).toBe(false);
      const dropViolation = result.violations.find((v) => v.ruleId === "NO_RAW_SQL_DROP");
      expect(dropViolation).toBeDefined();
      expect(dropViolation?.file).toBe("src/db.ts");
      expect(dropViolation?.line).toBe(21);
      expect(dropViolation?.message).toContain("DROP statements are prohibited");
    });

    it("permits @modelcontextprotocol/sdk import outside src/utils/ (e.g. in src/server.ts)", () => {
      const mcpImportInServerDiff = `diff --git a/src/server.ts b/src/server.ts
--- a/src/server.ts
+++ b/src/server.ts
@@ -1,2 +1,3 @@
+import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 export const server = new McpServer();
`;

      const result = evaluateUnifiedDiff({
        diff: mcpImportInServerDiff,
        branch: "main",
      });

      // No boundary violation should occur outside src/utils/
      const boundaryViolation = result.violations.find((v) => v.ruleId === "BOUNDARY_NO_MCP_SDK_IN_UTILS");
      expect(boundaryViolation).toBeUndefined();
      expect(result.isValid).toBe(true);
      expect(result.passed).toBe(true);
    });

    it("evaluates custom constitution regex rules", () => {
      const customRules: ForbiddenPatternRule[] = [
        {
          id: "NO_EVAL",
          pattern: "eval\\(",
          regex: /eval\(/,
          description: "Dangerous eval() is forbidden",
          severity: "error",
        },
      ];

      const evalDiff = `diff --git a/src/calc.ts b/src/calc.ts
--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,2 +1,3 @@
+const res = eval("2 + 2");
 return res;
`;

      const result = evaluateUnifiedDiff({
        diff: evalDiff,
        branch: "main",
        customRules,
      });

      expect(result.isValid).toBe(false);
      expect(result.passed).toBe(false);
      const evalViolation = result.violations.find((v) => v.ruleId === "NO_EVAL");
      expect(evalViolation).toBeDefined();
      expect(evalViolation?.file).toBe("src/calc.ts");
      expect(evalViolation?.line).toBe(1);
      expect(evalViolation?.message).toContain("eval()");
    });

    it("returns isValid=true and passed=true for completely compliant diff", () => {
      const cleanDiff = `diff --git a/src/clean.ts b/src/clean.ts
--- a/src/clean.ts
+++ b/src/clean.ts
@@ -1,2 +1,4 @@
+export function add(a: number, b: number): number {
+  return a + b;
+}
`;

      const result = evaluateUnifiedDiff({
        diff: cleanDiff,
        branch: "main",
      });

      expect(result.isValid).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.summary.errorCount).toBe(0);
      expect(result.checkedLinesCount).toBe(3);
      expect(result.summaryText).toContain("Diff validation passed with 0 violations");
    });
  });

  describe("Architectural & Stream Purity Constraints", () => {
    it("does not write anything to stdout during diff validation", () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write");
      const consoleLogSpy = vi.spyOn(console, "log");

      validateDiffContent({ rawDiff: sampleDiff, branch: "main" });

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it("does not import external protocol SDK in validator.ts", async () => {
      const validatorSrc = await fs.readFile(
        path.join(process.cwd(), "src/utils/validator.ts"),
        "utf-8"
      );
      expect(validatorSrc).not.toContain("@modelcontextprotocol" + "/sdk");
    });
  });
});
