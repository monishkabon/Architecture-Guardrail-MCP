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

export interface WorkspaceMetadata {
  rootPath: string;
  hasGit: boolean;
  hasSpecify: boolean;
  specifyPath: string | null;
  constitutionPath: string | null;
  specsPath: string | null;
  isValid: boolean;
  error?: string;
  warnings: string[];
}

export type ViolationSeverity = "error" | "warning";

export interface DiffViolation {
  ruleId: string;
  category: string;
  file: string;
  line?: number;
  hunk?: string;
  severity: ViolationSeverity;
  message: string;
  remediation?: string;
}

export type TaskStatus = "completed" | "pending" | "in_progress" | "failed";

export interface TaskItem {
  id: string;
  description: string;
  status: TaskStatus;
  line?: number;
  referencedFiles: string[];
  fileExistence: Record<string, boolean>;
  details?: string;
}

export interface TaskVerificationResult {
  featureId: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  tasks: TaskItem[];
  isValid: boolean;
  warnings: string[];
}

export type RuleSeverity = "mandatory" | "recommended";

export interface ConstitutionRule {
  id: string;
  category: string;
  title: string;
  statement: string;
  severity: RuleSeverity;
}

export interface GitDiffResult {
  diff: string;
  truncated: boolean;
}

export interface ForbiddenPatternRule {
  id: string;
  pattern: string;
  regex?: RegExp;
  description: string;
  severity?: ViolationSeverity;
}

export interface ParsedConstitution {
  rules: ForbiddenPatternRule[];
  rawContent: string;
  frontmatter?: Record<string, unknown>;
}

export interface AddedDiffLine {
  file: string;
  line: number;
  content: string;
}

export interface DiffValidationResult {
  isValid: boolean;
  violations: DiffViolation[];
  checkedLinesCount: number;
  summary: {
    totalViolations: number;
    errorCount: number;
    warningCount: number;
  };
  truncated?: boolean;
}
