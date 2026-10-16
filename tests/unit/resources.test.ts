import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { getConstitutionResourceContent } from "../../src/resources/constitution.js";
import { getActiveSpecResourceContent } from "../../src/resources/activeSpec.js";
import { MAX_RESOURCE_CHARS } from "../../src/config/defaults.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/server.js";

describe("Phase 4 MCP Resources", () => {
  const currentWorkspace = process.cwd();
  const mockRepoPath = path.join(currentWorkspace, "tests/fixtures/mock-repo");

  describe("Project Constitution Resource (T011 / US1 - MVP)", () => {
    it("returns text/markdown, strips HTML comments and shield badges, and includes NO_RAW_SQL_DROP", async () => {
      const result = await getConstitutionResourceContent(mockRepoPath);

      expect(result).toBeDefined();
      expect(result.uri).toBe("spec://project/constitution");
      expect(result.mimeType).toBe("text/markdown");

      // Verify HTML comments and badges from mock-repo constitution are stripped
      expect(result.text).not.toContain("Internal fixture comment");
      expect(result.text).not.toContain("img.shields.io");

      // Verify compact metadata header
      expect(result.text).toContain("mock-repo");
      expect(result.text).toMatch(/rules?:\s*4/i);

      // Verify core principles and NO_RAW_SQL_DROP rule context is retained
      expect(result.text).toContain("STDIO Stream Purity");
      expect(result.text).toContain("NO_RAW_SQL_DROP");
      expect(result.text).toContain("DROP\\s+TABLE");
    });

    it("resolves workspace from SPEC_GUARD_WORKSPACE env variable when no argument provided", async () => {
      const origEnv = process.env.SPEC_GUARD_WORKSPACE;
      try {
        process.env.SPEC_GUARD_WORKSPACE = mockRepoPath;
        const result = await getConstitutionResourceContent();
        expect(result.text).toContain("NO_RAW_SQL_DROP");
      } finally {
        if (origEnv !== undefined) {
          process.env.SPEC_GUARD_WORKSPACE = origEnv;
        } else {
          delete process.env.SPEC_GUARD_WORKSPACE;
        }
      }
    });

    it("returns graceful Markdown diagnostic fallback when constitution file is missing without throwing", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "empty-ws-"));
      try {
        const result = await getConstitutionResourceContent(tempDir);
        expect(result.uri).toBe("spec://project/constitution");
        expect(result.mimeType).toBe("text/markdown");
        expect(result.text).toContain("Diagnostic");
        expect(result.text).toContain("Constitution");
        expect(result.text).toContain(".specify/memory/constitution.md");
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("enforces MAX_RESOURCE_CHARS truncation with a clear truncation message", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "large-ws-"));
      try {
        const specifyDir = path.join(tempDir, ".specify", "memory");
        await fs.mkdir(specifyDir, { recursive: true });

        // Generate content exceeding MAX_RESOURCE_CHARS
        const largeBody = "# Large Constitution\n\n" + "A".repeat(MAX_RESOURCE_CHARS + 5000);
        await fs.writeFile(path.join(specifyDir, "constitution.md"), largeBody, "utf-8");

        const result = await getConstitutionResourceContent(tempDir);
        expect(result.text.length).toBeLessThanOrEqual(MAX_RESOURCE_CHARS + 200);
        expect(result.text).toContain("[Content truncated: exceeded character limit]");
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Active Branch Spec Resource (T012 / US2)", () => {
    it("resolves 001-sample-feature via fallback, bundles spec.md and tasks.md, and strips token noise", async () => {
      const result = await getActiveSpecResourceContent(mockRepoPath);

      expect(result).toBeDefined();
      expect(result.uri).toBe("spec://branch/current");
      expect(result.mimeType).toBe("text/markdown");

      // Verify bundled header with resolved feature folder
      expect(result.text).toContain("# Active Feature: 001-sample-feature");

      // Verify spec.md content included
      expect(result.text).toContain("## Specification");
      expect(result.text).toContain("Sample Feature");

      // Verify tasks.md content included
      expect(result.text).toContain("## Task Checklist");
      expect(result.text).toContain("T001 Initialize sample repository file");

      // Verify absence of plan.md is handled cleanly
      expect(result.text).toContain("## Implementation Plan");
      expect(result.text).toMatch(/no implementation plan/i);
    });

    it("returns graceful Markdown diagnostic when workspace has no specs directory", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "no-specs-ws-"));
      try {
        const result = await getActiveSpecResourceContent(tempDir);
        expect(result.uri).toBe("spec://branch/current");
        expect(result.mimeType).toBe("text/markdown");
        expect(result.text).toContain("Diagnostic");
        expect(result.text).toMatch(/specs?.*unavailable|not found/i);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("returns graceful Markdown diagnostic when specs directory contains no feature folders", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "empty-specs-ws-"));
      try {
        await fs.mkdir(path.join(tempDir, "specs"), { recursive: true });
        const result = await getActiveSpecResourceContent(tempDir);
        expect(result.uri).toBe("spec://branch/current");
        expect(result.mimeType).toBe("text/markdown");
        expect(result.text).toContain("Diagnostic");
        expect(result.text).toMatch(/no feature specifications? found/i);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("enforces MAX_RESOURCE_CHARS truncation when bundled spec artifacts exceed character limit", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "huge-spec-ws-"));
      try {
        const featureDir = path.join(tempDir, "specs", "099-huge-feature");
        await fs.mkdir(featureDir, { recursive: true });

        const hugeSpec = "# Huge Spec\n\n" + "B".repeat(MAX_RESOURCE_CHARS + 5000);
        await fs.writeFile(path.join(featureDir, "spec.md"), hugeSpec, "utf-8");

        const result = await getActiveSpecResourceContent(tempDir);
        expect(result.text.length).toBeLessThanOrEqual(MAX_RESOURCE_CHARS + 200);
        expect(result.text).toContain("[Content truncated: exceeded character limit]");
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Server Registration & Protocol Integration (T007 & T008 / US3)", () => {
    let client: Client;
    let clientTransport: InMemoryTransport;
    let serverTransport: InMemoryTransport;
    let server: ReturnType<typeof createMcpServer>;

    beforeEach(async () => {
      [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      client = new Client({
        name: "resource-test-client",
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

    it("registers both resources on the McpServer and lists them via client.listResources()", async () => {
      const resourcesResult = await client.listResources();
      expect(resourcesResult.resources).toBeDefined();

      const constitutionRes = resourcesResult.resources.find(
        (r) => r.uri === "spec://project/constitution"
      );
      expect(constitutionRes).toBeDefined();
      expect(constitutionRes?.name).toBe("project-constitution");
      expect(constitutionRes?.mimeType).toBe("text/markdown");
      expect(constitutionRes?.description).toContain("constitution");

      const activeSpecRes = resourcesResult.resources.find(
        (r) => r.uri === "spec://branch/current"
      );
      expect(activeSpecRes).toBeDefined();
      expect(activeSpecRes?.name).toBe("active-branch-spec");
      expect(activeSpecRes?.mimeType).toBe("text/markdown");
      expect(activeSpecRes?.description).toContain("Active branch");
    });

    it("reads spec://project/constitution through MCP protocol", async () => {
      const readResult = await client.readResource({
        uri: "spec://project/constitution",
      });

      expect(readResult.contents).toHaveLength(1);
      const item = readResult.contents[0];
      expect(item.uri).toBe("spec://project/constitution");
      expect(item.mimeType).toBe("text/markdown");
      if ("text" in item) {
        expect(item.text).toContain("Project Constitution");
      } else {
        expect.fail("Expected text property in readResource response");
      }
    });

    it("reads spec://project/constitution with custom ?workspacePath= parameter", async () => {
      const readResult = await client.readResource({
        uri: `spec://project/constitution?workspacePath=${encodeURIComponent(mockRepoPath)}`,
      });

      expect(readResult.contents).toHaveLength(1);
      const item = readResult.contents[0];
      if ("text" in item) {
        expect(item.text).toContain("mock-repo");
        expect(item.text).toContain("NO_RAW_SQL_DROP");
      } else {
        expect.fail("Expected text property in readResource response");
      }
    });

    it("reads spec://branch/current through MCP protocol", async () => {
      const readResult = await client.readResource({
        uri: `spec://branch/current?workspacePath=${encodeURIComponent(mockRepoPath)}`,
      });

      expect(readResult.contents).toHaveLength(1);
      const item = readResult.contents[0];
      expect(item.uri).toBe("spec://branch/current");
      expect(item.mimeType).toBe("text/markdown");
      if ("text" in item) {
        expect(item.text).toContain("# Active Feature: 001-sample-feature");
        expect(item.text).toContain("## Specification");
        expect(item.text).toContain("## Task Checklist");
      } else {
        expect.fail("Expected text property in readResource response");
      }
    });

    it("preserves 100% stdout stream purity during resource operations", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      try {
        await client.listResources();
        await client.readResource({ uri: "spec://project/constitution" });
        await client.readResource({ uri: "spec://branch/current" });

        expect(stdoutSpy).not.toHaveBeenCalled();
      } finally {
        stdoutSpy.mockRestore();
      }
    });
  });
});
