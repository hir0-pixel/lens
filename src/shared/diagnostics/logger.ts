/**
 * Application logger with levels, ring buffer, and secret redaction.
 * Safe for production — never logs raw API keys.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MAX_ENTRIES = 500;
const SECRET_PATTERNS = [
  /\b(sk-[a-zA-Z0-9_-]{8,})/gi,
  /\b(sk-ant-[a-zA-Z0-9_-]{8,})/gi,
  /\b(api[_-]?key["']?\s*[:=]\s*["']?)([^"'\s]+)/gi,
  /\b(bearer\s+)([a-zA-Z0-9._-]+)/gi,
];

function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match) => {
      if (match.length <= 8) return "***";
      return `${match.slice(0, 4)}…***`;
    });
  }
  return out;
}

function redactContext(
  ctx?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (/key|secret|token|password|authorization/i.test(k)) {
      out[k] = typeof v === "string" && v ? maskSecret(v) : "[redacted]";
    } else if (typeof v === "string") {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Mask API key for display / persistence previews */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

class Logger {
  private entries: LogEntry[] = [];
  private minLevel: LogLevel =
    import.meta.env.DEV || import.meta.env.VITE_DEBUG === "true"
      ? "debug"
      : "info";
  private listeners = new Set<(e: LogEntry) => void>();

  setMinLevel(level: LogLevel) {
    this.minLevel = level;
  }

  subscribe(fn: (e: LogEntry) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  clear() {
    this.entries = [];
  }

  private write(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      level,
      message: redact(message),
      timestamp: new Date().toISOString(),
      context: redactContext(context),
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }

    const consoleFn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : level === "debug"
            ? console.debug
            : console.info;
    if (import.meta.env.DEV || level === "error" || level === "warn") {
      consoleFn(`[orchids:${level}]`, entry.message, entry.context ?? "");
    }

    this.listeners.forEach((fn) => fn(entry));
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.write("debug", message, context);
  }
  info(message: string, context?: Record<string, unknown>) {
    this.write("info", message, context);
  }
  warn(message: string, context?: Record<string, unknown>) {
    this.write("warn", message, context);
  }
  error(message: string, context?: Record<string, unknown>) {
    this.write("error", message, context);
  }

  /** Capture unexpected errors for diagnostics / crash placeholder */
  captureException(error: unknown, context?: Record<string, unknown>) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.error(message, { ...context, stack: stack ? redact(stack) : undefined });
  }
}

export const logger = new Logger();
