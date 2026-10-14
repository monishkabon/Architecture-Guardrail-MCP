import type { LogLevel } from "../types/index.js";

export class Logger {
  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  debug(message: string, context?: unknown): void {
    const formatted = this.formatMessage("debug", message);
    if (context !== undefined) {
      console.error(formatted, context);
    } else {
      console.error(formatted);
    }
  }

  info(message: string, context?: unknown): void {
    const formatted = this.formatMessage("info", message);
    if (context !== undefined) {
      console.error(formatted, context);
    } else {
      console.error(formatted);
    }
  }

  warn(message: string, context?: unknown): void {
    const formatted = this.formatMessage("warn", message);
    if (context !== undefined) {
      console.error(formatted, context);
    } else {
      console.error(formatted);
    }
  }

  error(message: string, error?: unknown): void {
    const formatted = this.formatMessage("error", message);
    if (error !== undefined) {
      console.error(formatted, error);
    } else {
      console.error(formatted);
    }
  }
}

export const logger = new Logger();
