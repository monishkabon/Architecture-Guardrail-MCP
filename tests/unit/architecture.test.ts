import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

describe("Repository Architecture & Directory Boundaries (User Story 4)", () => {
  const expectedDirectories = [
    "src/types",
    "src/config",
    "src/resources",
    "src/tools",
    "src/prompts",
    "src/utils",
    "tests/unit",
    "tests/fixtures",
  ];

  for (const dir of expectedDirectories) {
    it(`should contain constitutional directory: ${dir}`, () => {
      const dirPath = path.join(projectRoot, dir);
      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });
  }

  it("should contain src/index.ts with #!/usr/bin/env node shebang", () => {
    const indexPath = path.join(projectRoot, "src/index.ts");
    expect(fs.existsSync(indexPath)).toBe(true);
    const content = fs.readFileSync(indexPath, "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("should strictly forbid console.log across src/ to preserve STDIO stream purity", () => {
    const srcDir = path.join(projectRoot, "src");

    function scanFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const sourceFiles = scanFiles(srcDir);
    expect(sourceFiles.length).toBeGreaterThan(0);

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(
        content.includes("console.log"),
        `File ${path.relative(projectRoot, filePath)} violates STDIO purity by calling console.log`
      ).toBe(false);
    }
  });
});
