import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "../../src/utils/logger.js";

describe("Logger", () => {
  let logger: Logger;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let processStdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger();
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    processStdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should write info messages exclusively to console.error", () => {
    logger.info("Server started");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0][0]).toMatch(/\[\d{4}-\d{2}-\d{2}T.*\] \[INFO\] Server started/);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(processStdoutSpy).not.toHaveBeenCalled();
  });

  it("should write debug messages exclusively to console.error", () => {
    logger.debug("Debugging trace", { detail: 123 });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0][0]).toMatch(/\[DEBUG\] Debugging trace/);
    expect(stderrSpy.mock.calls[0][1]).toEqual({ detail: 123 });
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(processStdoutSpy).not.toHaveBeenCalled();
  });

  it("should write warn messages exclusively to console.error", () => {
    logger.warn("Potential issue detected");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0][0]).toMatch(/\[WARN\] Potential issue detected/);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(processStdoutSpy).not.toHaveBeenCalled();
  });

  it("should write error messages and error objects exclusively to console.error", () => {
    const err = new Error("Fatal startup error");
    logger.error("Failed to initialize", err);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0][0]).toMatch(/\[ERROR\] Failed to initialize/);
    expect(stderrSpy.mock.calls[0][1]).toBe(err);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(processStdoutSpy).not.toHaveBeenCalled();
  });
});
