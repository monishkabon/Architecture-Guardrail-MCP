#!/usr/bin/env node
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { logger } from "./utils/logger.js";
import { DEFAULT_SHUTDOWN_TIMEOUT_MS } from "./config/index.js";

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  let isShuttingDown = false;

  const handleShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}, shutting down spec-guard-mcp gracefully...`);

    const forceExitTimer = setTimeout(() => {
      logger.warn(`Graceful shutdown timed out (${DEFAULT_SHUTDOWN_TIMEOUT_MS}ms), forcing exit.`);
      process.exit(0);
    }, DEFAULT_SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    try {
      await server.close();
      logger.info("spec-guard-mcp closed cleanly.");
    } catch (err: unknown) {
      logger.error("Error encountered during server close:", err);
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void handleShutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void handleShutdown("SIGTERM");
  });

  process.on("uncaughtException", (err: Error) => {
    logger.error("Uncaught exception in spec-guard-mcp:", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("Unhandled promise rejection in spec-guard-mcp:", reason);
    process.exit(1);
  });

  try {
    logger.info("Connecting spec-guard-mcp server to STDIO transport...");
    await server.connect(transport);
    logger.info("spec-guard-mcp server initialized and listening on STDIO.");
  } catch (err: unknown) {
    logger.error("Fatal startup error connecting to STDIO transport:", err);
    process.exit(1);
  }
}

main();
