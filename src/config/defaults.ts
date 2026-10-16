/**
 * Default candidate paths, token limits, and baseline forbidden patterns for spec-guard-mcp.
 */

export const DEFAULT_SPECIFY_DIR = ".specify";
export const DEFAULT_SPECS_DIR = "specs";

export const CANDIDATE_CONSTITUTION_PATHS = [
  ".specify/memory/constitution.md",
  "constitution.md",
] as const;

export const CANDIDATE_SPECS_DIRS = [
  "specs",
] as const;

export const MAX_DIFF_CHARS = 15000;
export const MAX_FILE_PREVIEW_CHARS = 10000;
export const MAX_RESOURCE_CHARS = 30000;

export const FORBIDDEN_STDOUT_PATTERNS = [
  ["console", "log"].join("."),
  ["process", "stdout", "write"].join("."),
] as const;

export const DEFAULT_FORBIDDEN_PATTERNS = [
  ...FORBIDDEN_STDOUT_PATTERNS,
  ["child_process", "exec"].join("."),
] as const;

export interface SpecKitDefaults {
  readonly defaultSpecifyDir: string;
  readonly defaultSpecsDir: string;
  readonly candidateConstitutionPaths: readonly string[];
  readonly candidateSpecsDirs: readonly string[];
  readonly maxDiffChars: number;
  readonly maxFilePreviewChars: number;
  readonly maxResourceChars: number;
  readonly forbiddenStdoutPatterns: readonly string[];
}

export const DEFAULT_SPECKIT_CONFIG: SpecKitDefaults = {
  defaultSpecifyDir: DEFAULT_SPECIFY_DIR,
  defaultSpecsDir: DEFAULT_SPECS_DIR,
  candidateConstitutionPaths: CANDIDATE_CONSTITUTION_PATHS,
  candidateSpecsDirs: CANDIDATE_SPECS_DIRS,
  maxDiffChars: MAX_DIFF_CHARS,
  maxFilePreviewChars: MAX_FILE_PREVIEW_CHARS,
  maxResourceChars: MAX_RESOURCE_CHARS,
  forbiddenStdoutPatterns: FORBIDDEN_STDOUT_PATTERNS,
};
