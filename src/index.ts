export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  label: string;
  data?: unknown;
}

// a logging call must never throw and crash the caller's server, so
// circular references and unserializable values (BigInt, ...) fall
// back to a safe placeholder instead of propagating the error
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") return `${val}n`;
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });
  } catch (err) {
    return JSON.stringify({ error: `mcp-stdio-debug: failed to serialize log data: ${(err as Error).message}` });
  }
}

// stdout carries the JSON-RPC transport for stdio MCP servers, so every
// log line here goes to stderr instead, where the mcp-debug CLI picks it up.
function write(level: LogLevel, label: string, data?: unknown): void {
  const entry: LogEntry = { time: new Date().toISOString(), level, label, data };
  process.stderr.write(safeStringify(entry) + "\n");
}

export const debug = (label: string, data?: unknown): void => write("debug", label, data);
export const info = (label: string, data?: unknown): void => write("info", label, data);
export const warn = (label: string, data?: unknown): void => write("warn", label, data);
export const error = (label: string, data?: unknown): void => write("error", label, data);
