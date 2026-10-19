import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/server.js";
import { runValidateStagedDiff } from "../../src/tools/validateDiff.js";
import { runVerifySpecTasks } from "../../src/tools/checkTasks.js";
import { runInitFeatureSpec } from "../../src/tools/scaffoldModule.js";

const execFile = promisify(execFileCallback);

describe("Phase 5 MCP Tools", () => {
  const currentWorkspace = process.cwd();
  const mockRepoPath = path.join(currentWorkspace, "tests/fixtures/mock-repo");

  describe("Spec Task Verifier Tool (T014 - runVerifySpecTasks)", () => {
    it("detects completed task with existing.ts, pending task with missing.ts flagged, and sets passed to false on mock-repo", async () => {
      const result = await runVerifySpecTasks({
        workspacePath: mockRepoPath,
        featureId: "001-sample-feature",
      });

      expect(result).toBeDefined();
      expect(result.featureId).toBe("001-sample-feature");
      expect(result.totalTasks).toBeGreaterThanOrEqual(2);
      expect(result.completedTasks).toBeGreaterThanOrEqual(1);
      expect(result.pendingTasks).toBeGreaterThanOrEqual(1);
      expect(result.passed).toBe(false);
      expect(result.isValid).toBe(false);

      // Verify task referencing src/existing.ts has fileExistence true
      const existingTask = result.tasks.find((t) =>
        t.referencedFiles.includes("src/existing.ts")
      );
      expect(existingTask).toBeDefined();
      expect(existingTask?.fileExistence["src/existing.ts"]).toBe(true);

      // Verify task referencing src/missing.ts has missingFiles flagged
      const missingTask = result.tasks.find((t) =>
        t.referencedFiles.includes("src/missing.ts")
      );
      expect(missingTask).toBeDefined();
      expect(missingTask?.missingFiles).toContain("src/missing.ts");
      expect(missingTask?.fileExistence["src/missing.ts"]).toBe(false);

      expect(result.missingFilesCount).toBeGreaterThanOrEqual(1);
      expect(result.warnings.some((w) => w.includes("missing.ts"))).toBe(true);
      expect(result.summary).toContain("Task verification failed");
    });

    it("resolves target feature via fallback when featureId is not provided", async () => {
      const result = await runVerifySpecTasks({
        workspacePath: mockRepoPath,
      });

      expect(result).toBeDefined();
      expect(result.featureId).toBe("001-sample-feature");
    });

    it("throws a descriptive error when target featureId does not exist", async () => {
      await expect(
        runVerifySpecTasks({
          workspacePath: mockRepoPath,
          featureId: "999-non-existent",
        })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("Staged Diff Validator Tool (T013 - runValidateStagedDiff)", () => {
    let tempGitDir: string;

    beforeEach(async () => {
      tempGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-test-git-"));
      await execFile("git", ["init", "-b", "main"], { cwd: tempGitDir });
      await execFile("git", ["config", "user.name", "Tool Tester"], { cwd: tempGitDir });
      await execFile("git", ["config", "user.email", "tool@example.com"], { cwd: tempGitDir });

      // Create .specify/memory/constitution.md with custom rule
      const constDir = path.join(tempGitDir, ".specify/memory");
      await fs.mkdir(constDir, { recursive: true });
      const constitutionContent = [
        "# Constitution",
        "",
        "## Forbidden Patterns",
        "- `NO_RAW_SQL_DROP`: `DROP\\s+TABLE` - Dropping tables directly is forbidden.",
        "- `NO_STDOUT_CONSOLE_LOG`: `console\\.log` - stdout logging is forbidden.",
      ].join("\n");
      await fs.writeFile(path.join(constDir, "constitution.md"), constitutionContent, "utf-8");

      // Initial commit
      await fs.writeFile(path.join(tempGitDir, "README.md"), "# Temp Repo\n");
      await execFile("git", ["add", "."], { cwd: tempGitDir });
      await execFile("git", ["commit", "-m", "Initial commit"], { cwd: tempGitDir });
    });

    afterEach(async () => {
      if (tempGitDir) {
        await fs.rm(tempGitDir, { recursive: true, force: true });
      }
    });

    it("validates clean staged diff as passed: true with 0 violations", async () => {
      await fs.writeFile(path.join(tempGitDir, "clean.ts"), "export const safe = 42;\n");
      await execFile("git", ["add", "clean.ts"], { cwd: tempGitDir });

      const result = await runValidateStagedDiff({
        workspacePath: tempGitDir,
      });

      expect(result).toBeDefined();
      expect(result.passed).toBe(true);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.summary.errorCount).toBe(0);
    });

    it("detects console.log forbidden pattern in staged diff and sets passed: false", async () => {
      await fs.writeFile(
        path.join(tempGitDir, "bad.ts"),
        'export function bad() {\n  console.log("bad");\n}\n'
      );
      await execFile("git", ["add", "bad.ts"], { cwd: tempGitDir });

      const result = await runValidateStagedDiff({
        workspacePath: tempGitDir,
      });

      expect(result).toBeDefined();
      expect(result.passed).toBe(false);
      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(1);

      const hasStdoutViolation = result.violations.some(
        (v) => v.ruleId === "FORBIDDEN_STDOUT" || v.ruleId === "NO_STDOUT_CONSOLE_LOG"
      );
      expect(hasStdoutViolation).toBe(true);
    });

    it("detects architectural boundary violation when src/utils imports MCP SDK", async () => {
      const utilsDir = path.join(tempGitDir, "src/utils");
      await fs.mkdir(utilsDir, { recursive: true });
      await fs.writeFile(
        path.join(utilsDir, "leaky.ts"),
        'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\n'
      );
      await execFile("git", ["add", "src/utils/leaky.ts"], { cwd: tempGitDir });

      const result = await runValidateStagedDiff({
        workspacePath: tempGitDir,
      });

      expect(result.passed).toBe(false);
      const boundaryViolation = result.violations.find(
        (v) => v.ruleId === "BOUNDARY_NO_MCP_SDK_IN_UTILS"
      );
      expect(boundaryViolation).toBeDefined();
    });

    it("handles empty staged diff gracefully", async () => {
      const result = await runValidateStagedDiff({
        workspacePath: tempGitDir,
      });

      expect(result.passed).toBe(true);
      expect(result.checkedLinesCount).toBe(0);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("Feature Spec Scaffolder Tool (T015 - runInitFeatureSpec)", () => {
    let tempWsDir: string;

    beforeEach(async () => {
      tempWsDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-test-ws-"));
      // Initialize git landmark
      await execFile("git", ["init", "-b", "main"], { cwd: tempWsDir });
    });

    afterEach(async () => {
      if (tempWsDir) {
        await fs.rm(tempWsDir, { recursive: true, force: true });
      }
    });

    it("scaffolds feature with 001 prefix, then auto-increments to 002 for the next feature", async () => {
      const firstResult = await runInitFeatureSpec({
        workspacePath: tempWsDir,
        featureName: "User Profile Auth",
        summary: "Authentication and authorization for user profiles",
      });

      expect(firstResult.created).toBe(true);
      expect(firstResult.featureId).toBe("001-user-profile-auth");
      expect(await fs.stat(firstResult.specPath)).toBeDefined();
      expect(await fs.stat(firstResult.tasksPath)).toBeDefined();

      // Check spec content
      const specContent = await fs.readFile(firstResult.specPath, "utf-8");
      expect(specContent).toContain("feature: 001-user-profile-auth");
      expect(specContent).toContain("Authentication and authorization for user profiles");
      expect(specContent).toContain("## Architectural Guardrails");

      // Check tasks content
      const tasksContent = await fs.readFile(firstResult.tasksPath, "utf-8");
      expect(tasksContent).toContain("# Tasks: 001-user-profile-auth");
      expect(tasksContent).toContain("- [ ] T001");

      // Scaffold second feature
      const secondResult = await runInitFeatureSpec({
        workspacePath: tempWsDir,
        featureName: "Order History Dashboard",
        summary: "Displays historical user orders and receipts",
      });

      expect(secondResult.created).toBe(true);
      expect(secondResult.featureId).toBe("002-order-history-dashboard");
    });

    it("prevents overwriting existing files when overwrite is false", async () => {
      await runInitFeatureSpec({
        workspacePath: tempWsDir,
        featureName: "001-existing-feature",
        summary: "First version",
      });

      await expect(
        runInitFeatureSpec({
          workspacePath: tempWsDir,
          featureName: "001-existing-feature",
          summary: "Second attempt",
          overwrite: false,
        })
      ).rejects.toThrow(/already exists/i);
    });

    it("allows overwriting existing files when overwrite is true", async () => {
      await runInitFeatureSpec({
        workspacePath: tempWsDir,
        featureName: "001-overwrite-feature",
        summary: "First version",
      });

      const updated = await runInitFeatureSpec({
        workspacePath: tempWsDir,
        featureName: "001-overwrite-feature",
        summary: "Updated version",
        overwrite: true,
      });

      expect(updated.created).toBe(true);
      const specContent = await fs.readFile(updated.specPath, "utf-8");
      expect(specContent).toContain("Updated version");
    });

    it("rejects path traversal attempts outside specs directory", async () => {
      await expect(
        runInitFeatureSpec({
          workspacePath: tempWsDir,
          featureName: "../../../etc/passwd",
          summary: "Attack attempt",
        })
      ).rejects.toThrow();
    });
  });

  describe("MCP Server Tool Registration & Stream Purity (T010 / US4)", () => {
    let client: Client;
    let serverTransport: InMemoryTransport;
    let clientTransport: InMemoryTransport;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      stdoutSpy = vi.spyOn(process.stdout, "write");

      const server = createMcpServer();
      [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
    });

    afterEach(async () => {
      stdoutSpy.mockRestore();
      await client.close();
    });

    it("lists all registered tools including Phase 5 tools", async () => {
      const response = await client.listTools();
      const toolNames = response.tools.map((t) => t.name);

      expect(toolNames).toContain("ping_spec_guard");
      expect(toolNames).toContain("validate_staged_diff");
      expect(toolNames).toContain("verify_spec_tasks");
      expect(toolNames).toContain("init_feature_spec");
    });

    it("calls verify_spec_tasks and returns structured JSON text content", async () => {
      const response = await client.callTool({
        name: "verify_spec_tasks",
        arguments: {
          workspacePath: mockRepoPath,
          featureId: "001-sample-feature",
        },
      });

      expect(response.content).toBeDefined();
      expect(response.content[0].type).toBe("text");
      const text = (response.content[0] as { type: "text"; text: string }).text;
      const parsed = JSON.parse(text);
      expect(parsed.featureId).toBe("001-sample-feature");
      expect(parsed.passed).toBe(false);

      // Verify stream purity: stdout untouched outside protocol
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it("handles invalid tool arguments returning isError: true with remediation guidance", async () => {
      const response = await client.callTool({
        name: "verify_spec_tasks",
        arguments: {
          workspacePath: path.join(os.tmpdir(), "nonexistent-workspace-path-12345"),
        },
      });

      expect(response.isError).toBe(true);
      const text = (response.content[0] as { type: "text"; text: string }).text;
      const parsed = JSON.parse(text);
      expect(parsed.passed).toBe(false);
      expect(parsed.error).toBeDefined();
      expect(parsed.remediation).toBeDefined();
    });

    it("calls init_feature_spec over MCP and scaffolds a feature successfully", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-scaffold-test-"));
      await execFile("git", ["init", "-b", "main"], { cwd: tempDir });

      try {
        const response = await client.callTool({
          name: "init_feature_spec",
          arguments: {
            workspacePath: tempDir,
            featureName: "Test Module",
            summary: "Scaffolded via MCP protocol",
          },
        });

        expect(response.isError).toBeFalsy();
        const text = (response.content[0] as { type: "text"; text: string }).text;
        const parsed = JSON.parse(text);
        expect(parsed.created).toBe(true);
        expect(parsed.featureId).toBe("001-test-module");
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
