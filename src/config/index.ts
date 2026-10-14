import type { ServerConfig } from "../types/index.js";

export const SERVER_NAME = "spec-guard-mcp";
export const SERVER_VERSION = "0.1.0";
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  shutdownTimeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
};
