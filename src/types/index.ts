/**
 * Core domain types and interfaces for spec-guard-mcp.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface DiagnosticLogEvent {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown> | Error;
}

export interface HealthStatusPayload {
  status: "ok";
  server: "spec-guard-mcp";
  version: "0.1.0";
  timestamp: string;
}

export interface ServerConfig {
  name: string;
  version: string;
  shutdownTimeoutMs: number;
}
