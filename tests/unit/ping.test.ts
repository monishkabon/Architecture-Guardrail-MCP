import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/server.js";
import type { HealthStatusPayload } from "../../src/types/index.js";

describe("ping_spec_guard tool (User Story 1 - MVP)", () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({
      name: "test-client",
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

  it("should expose ping_spec_guard in the tools list", async () => {
    const toolsResult = await client.listTools();
    const pingTool = toolsResult.tools.find((t) => t.name === "ping_spec_guard");

    expect(pingTool).toBeDefined();
    expect(pingTool?.description).toContain("health-check ping tool");
  });

  it("should successfully execute ping_spec_guard and return healthy status payload", async () => {
    const result = await client.callTool({
      name: "ping_spec_guard",
      arguments: {},
    });

    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const payload = JSON.parse(result.content[0].text as string) as HealthStatusPayload;

    expect(payload.status).toBe("ok");
    expect(payload.server).toBe("spec-guard-mcp");
    expect(payload.version).toBe("0.1.0");
    expect(new Date(payload.timestamp).toString()).not.toBe("Invalid Date");
  });
});
