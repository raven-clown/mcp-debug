export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  label: string;
  data?: unknown;
  topic?: string;
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
function write(level: LogLevel, label: string, data?: unknown, topic?: string): void {
  const entry: LogEntry = { time: new Date().toISOString(), level, label, data, topic };
  process.stderr.write(safeStringify(entry) + "\n");
}

// a topic routes this entry to its own session file under the mcp-debug
// CLI's session directory (e.g. "api", "chat") instead of the main one -
// see --session-dir / MCP_DEBUG_TOPIC_DIR_<TOPIC> in the README.
export const debug = (label: string, data?: unknown, topic?: string): void => write("debug", label, data, topic);
export const info = (label: string, data?: unknown, topic?: string): void => write("info", label, data, topic);
export const warn = (label: string, data?: unknown, topic?: string): void => write("warn", label, data, topic);
export const error = (label: string, data?: unknown, topic?: string): void => write("error", label, data, topic);
