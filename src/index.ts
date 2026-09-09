import { appendFileSync } from "node:fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  label: string;
  data?: unknown;
}

let logFile: string | undefined;

// stdout carries the JSON-RPC transport for stdio MCP servers, so every
// log line here goes to stderr instead, plus an optional file for the
// mcp-debug CLI to replay.
export function setLogFile(path: string): void {
  logFile = path;
}

function write(level: LogLevel, label: string, data?: unknown): void {
  const entry: LogEntry = { time: new Date().toISOString(), level, label, data };
  const line = JSON.stringify(entry);
  process.stderr.write(line + "\n");
  if (logFile) appendFileSync(logFile, line + "\n");
}

export const debug = (label: string, data?: unknown): void => write("debug", label, data);
export const info = (label: string, data?: unknown): void => write("info", label, data);
export const warn = (label: string, data?: unknown): void => write("warn", label, data);
export const error = (label: string, data?: unknown): void => write("error", label, data);
