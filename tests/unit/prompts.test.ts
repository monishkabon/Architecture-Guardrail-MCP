import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/server.js";
import {
  buildPreCommitAuditPrompt,
  AUDIT_PROMPT_NAME,
} from "../../src/prompts/preCommitAudit.js";

describe("Phase 6 MCP Workflow Prompt (T016 - audit-implementation)", () => {
  const currentWorkspace = process.cwd();
  const mockRepoPath = path.join(currentWorkspace, "tests/fixtures/mock-repo");

  describe("Pure Runner Helper (buildPreCommitAuditPrompt)", () => {
    it("assembles all five context pieces and audit directives against mock-repo", async () => {
      const promptResult = await buildPreCommitAuditPrompt({
        workspacePath: mockRepoPath,
        featureId: "001-sample-feature",
      });

      expect(promptResult).toBeDefined();
      expect(promptResult.description).toContain("Bundles project constitution");
      expect(promptResult.messages).toHaveLength(1);

      const userMessage = promptResult.messages[0];
      expect(userMessage.role).toBe("user");
      expect(userMessage.content.type).toBe("text");

      const promptText = userMessage.content.text;

      // 1. Role framing and directives
      expect(promptText).toContain("Principal Architecture Reviewer and Spec Guard");
      expect(promptText).toContain("Constitutional & Boundary Compliance");
      expect(promptText).toContain("Feature Specification Alignment");
      expect(promptText).toContain("Unfinished Tasks or Missing Referenced Files");
      expect(promptText).toContain("READY TO COMMIT");
      expect(promptText).toContain("CHANGES REQUIRED");

      // 2. Constitution section (mock-repo constitution content)
      expect(promptText).toContain("## 1. Project Constitution");
      expect(promptText).toContain("Mock Project Constitution");

      // 3. Active feature spec section
      expect(promptText).toContain("## 2. Active Feature Specification & Tasks");
      expect(promptText).toContain("001-sample-feature");

      // 4. Staged diff validation report section
      expect(promptText).toContain("## 3. Deterministic Staged Diff Validation Report");

      // 5. Task verification report section (references missing.ts)
      expect(promptText).toContain("## 4. Deterministic Task Completion & File Existence Report");
      expect(promptText).toContain("src/missing.ts");

      // 6. Staged diff section
      expect(promptText).toContain("## 5. Current Staged Unified Diff");
    });

    it("gracefully degrades without throwing when given a non-existent workspace path", async () => {
      const nonExistentPath = "/non-existent-path-9999";
      let promptResult;

      await expect(
        (async () => {
          promptResult = await buildPreCommitAuditPrompt({
            workspacePath: nonExistentPath,
          });
        })()
      ).resolves.not.toThrow();

      expect(promptResult).toBeDefined();
      expect(promptResult!.messages).toHaveLength(1);

      const text = promptResult!.messages[0].content.text;
      expect(text).toContain("Principal Architecture Reviewer and Spec Guard");
      // Expect diagnostic or error notes in the sections
      expect(text).toMatch(/unavailable|diagnostic|error|invalid/i);
    });

    it("falls back to process.env.SPEC_GUARD_WORKSPACE or process.cwd() when workspacePath is omitted", async () => {
      const originalEnv = process.env.SPEC_GUARD_WORKSPACE;
      try {
        process.env.SPEC_GUARD_WORKSPACE = mockRepoPath;
        const promptResult = await buildPreCommitAuditPrompt({
          featureId: "001-sample-feature",
        });

        expect(promptResult).toBeDefined();
        expect(promptResult.messages[0].content.text).toContain("Mock Project Constitution");
      } finally {
        if (originalEnv !== undefined) {
          process.env.SPEC_GUARD_WORKSPACE = originalEnv;
        } else {
          delete process.env.SPEC_GUARD_WORKSPACE;
        }
      }
    });

    it("handles workspaces without staged changes with an informative placeholder", async () => {
      const promptResult = await buildPreCommitAuditPrompt({
        workspacePath: mockRepoPath,
        featureId: "001-sample-feature",
      });

      const text = promptResult.messages[0].content.text;
      expect(text).toContain("## 5. Current Staged Unified Diff");
      // When nothing is staged, should have placeholder or diff
      expect(text).toMatch(/_No staged changes found or not a Git repository._|diff --git/);
    });
  });

  describe("MCP Server Prompt Registration & Protocol Integration", () => {
    let client: Client;
    let clientTransport: InMemoryTransport;
    let serverTransport: InMemoryTransport;
    let server: ReturnType<typeof createMcpServer>;

    beforeEach(async () => {
      [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      client = new Client({
        name: "prompt-test-client",
        version: "1.0.0",
      });

      server = createMcpServer();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
    });

    afterEach(async () => {
      await client.close();
      await server.close();
    });

    it("registers audit-implementation on McpServer and lists it via client.listPrompts()", async () => {
      const promptsResult = await client.listPrompts();
      expect(promptsResult.prompts).toBeDefined();

      const auditPrompt = promptsResult.prompts.find((p) => p.name === AUDIT_PROMPT_NAME);
      expect(auditPrompt).toBeDefined();
      expect(auditPrompt?.description).toContain("Bundles project constitution");
      expect(auditPrompt?.arguments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "workspacePath",
            required: false,
          }),
          expect.objectContaining({
            name: "featureId",
            required: false,
          }),
        ])
      );
    });

    it("retrieves the audit-implementation prompt over MCP protocol with zero stdout pollution", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write");

      const promptResult = await client.getPrompt({
        name: AUDIT_PROMPT_NAME,
        arguments: {
          workspacePath: mockRepoPath,
          featureId: "001-sample-feature",
        },
      });

      expect(promptResult).toBeDefined();
      expect(promptResult.messages).toHaveLength(1);
      expect(promptResult.messages[0].role).toBe("user");

      const content = promptResult.messages[0].content;
      expect(content.type).toBe("text");
      if (content.type === "text") {
        expect(content.text).toContain("Mock Project Constitution");
        expect(content.text).toContain("001-sample-feature");
        expect(content.text).toContain("READY TO COMMIT");
      }

      // Verify zero unauthorized stdout emissions
      expect(stdoutSpy).not.toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });
  });
});
