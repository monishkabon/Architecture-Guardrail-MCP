import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../dist/index.js");

describe("CLI STDIO Server Integration (User Story 2 & 3)", () => {
  it("should preserve stdout exclusively for JSON-RPC protocol frames and output logs to stderr (US2)", async () => {
    const child = spawn("node", [cliPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutData = "";
    let stderrData = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutData += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrData += chunk.toString("utf-8");
    });

    // Send standard MCP initialize request over stdin
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    }) + "\n";

    child.stdin.write(initRequest);

    // Wait for response or timeout
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (stdoutData.includes('"result"')) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 2000);
    });

    // Cleanup child process
    child.kill("SIGTERM");

    // Verify stdout contains ONLY valid JSON-RPC lines
    const stdoutLines = stdoutData.trim().split("\n").filter((l) => l.trim().length > 0);
    expect(stdoutLines.length).toBeGreaterThan(0);

    for (const line of stdoutLines) {
      const parsed = JSON.parse(line);
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.id).toBe(1);
    }

    // Verify stderr receives diagnostic logs
    expect(stderrData).toContain("[INFO] Connecting spec-guard-mcp server to STDIO transport...");
    expect(stderrData).toContain("[INFO] spec-guard-mcp server initialized and listening on STDIO.");
  });

  it("should terminate cleanly with exit code 0 and log to stderr when receiving SIGTERM (US3)", async () => {
    const child = spawn("node", [cliPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderrData = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrData += chunk.toString("utf-8");
    });

    // Wait until server has started
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (stderrData.includes("spec-guard-mcp server initialized")) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 2000);
    });

    // Send SIGTERM
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });

    child.kill("SIGTERM");

    const exitResult = await exitPromise;

    expect(exitResult.code).toBe(0);
    expect(stderrData).toContain("Received SIGTERM, shutting down spec-guard-mcp gracefully...");
    expect(stderrData).toContain("spec-guard-mcp closed cleanly.");
  });

  it("should terminate cleanly with exit code 0 when receiving SIGINT (US3)", async () => {
    const child = spawn("node", [cliPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderrData = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrData += chunk.toString("utf-8");
    });

    // Wait until server has started
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (stderrData.includes("spec-guard-mcp server initialized")) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 2000);
    });

    // Send SIGINT
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });

    child.kill("SIGINT");

    const exitResult = await exitPromise;

    expect(exitResult.code).toBe(0);
    expect(stderrData).toContain("Received SIGINT, shutting down spec-guard-mcp gracefully...");
    expect(stderrData).toContain("spec-guard-mcp closed cleanly.");
  });
});
