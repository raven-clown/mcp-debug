export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  label: string;
  data?: unknown;
}

// stdout carries the JSON-RPC transport for stdio MCP servers, so every
// log line here goes to stderr instead, where the mcp-debug CLI picks it up.
function write(level: LogLevel, label: string, data?: unknown): void {
  const entry: LogEntry = { time: new Date().toISOString(), level, label, data };
  process.stderr.write(JSON.stringify(entry) + "\n");
}

export const debug = (label: string, data?: unknown): void => write("debug", label, data);
export const info = (label: string, data?: unknown): void => write("info", label, data);
export const warn = (label: string, data?: unknown): void => write("warn", label, data);
export const error = (label: string, data?: unknown): void => write("error", label, data);
