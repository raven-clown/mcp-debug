#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  type WriteStream,
} from "node:fs";
import { join } from "node:path";
import { LineSplitter } from "./line-splitter.js";

const COLOR = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function readVersion(): string {
  const pkgPath = new URL("../package.json", import.meta.url);
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: mcp-debug run -- <command> [args...]",
      "",
      "  mcp-debug run -- node server.js   wrap a stdio MCP server",
      "  mcp-debug replay [session-file]   pretty-print a saved session (defaults to the latest)",
      "  mcp-debug --version               print the installed version",
      "  mcp-debug --help                  show this message",
      "",
    ].join("\n"),
  );
}

// tracks in-flight client -> server requests by id so a matching response
// on stdout can report round-trip latency
function handleClientLine(line: string, pending: Map<string, number>): void {
  try {
    const msg = JSON.parse(line);
    if (msg && typeof msg === "object" && msg.method && msg.id !== undefined) {
      pending.set(String(msg.id), Date.now());
    }
  } catch {
    // not JSON, nothing to track
  }
}

function handleProtocolLine(line: string, logStream: WriteStream, pending: Map<string, number>): void {
  let summary: string;
  try {
    const msg = JSON.parse(line);
    if (!msg || typeof msg !== "object" || !("jsonrpc" in msg)) return;
    const parts = [msg.method, msg.id !== undefined ? `id=${msg.id}` : null].filter(Boolean);
    summary = parts.join(" ") || "(response)";

    if (msg.id !== undefined && !msg.method) {
      const key = String(msg.id);
      const start = pending.get(key);
      if (start !== undefined) {
        summary += ` (${Date.now() - start}ms)`;
        pending.delete(key);
      }
    }
  } catch {
    return;
  }
  const time = new Date().toISOString();
  process.stderr.write(`${COLOR.cyan}${time} [rpc]${COLOR.reset} ${summary}\n`);
  logStream.write(JSON.stringify({ time, channel: "protocol", text: summary }) + "\n");
}

function handleDebugLine(line: string, logStream: WriteStream): void {
  let text = line;
  let level = "log";
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && "level" in parsed) {
      level = String(parsed.level);
      text = [parsed.label, parsed.data !== undefined ? JSON.stringify(parsed.data) : ""]
        .filter(Boolean)
        .join(" ");
    }
  } catch {
    // not a structured entry, print the raw line as-is
  }
  const color = level === "error" ? COLOR.red : level === "warn" ? COLOR.yellow : COLOR.gray;
  const time = new Date().toISOString();
  process.stderr.write(`${color}${time} [${level}]${COLOR.reset} ${text}\n`);
  logStream.write(JSON.stringify({ time, channel: "log", level, text }) + "\n");
}

function run(target: string, targetArgs: string[]): void {
  const sessionDir = join(process.cwd(), ".mcp-debug");
  mkdirSync(sessionDir, { recursive: true });
  const logPath = join(sessionDir, `session-${Date.now()}.jsonl`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.on("error", (err) => {
    process.stderr.write(`mcp-debug: log file write failed: ${err.message}\n`);
  });

  const child = spawn(target, targetArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  const pending = new Map<string, number>();
  const stdinSplitter = new LineSplitter((line) => handleClientLine(line, pending));
  process.stdin.on("data", (chunk: Buffer) => stdinSplitter.push(chunk));
  process.stdin.pipe(child.stdin);

  const stdoutSplitter = new LineSplitter((line) => handleProtocolLine(line, logStream, pending));
  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    stdoutSplitter.push(chunk);
  });
  child.stdout.on("close", () => stdoutSplitter.flush());

  const stderrSplitter = new LineSplitter((line) => handleDebugLine(line, logStream));
  child.stderr.on("data", (chunk: Buffer) => stderrSplitter.push(chunk));
  child.stderr.on("close", () => stderrSplitter.flush());

  const killChild = (sig: NodeJS.Signals): void => {
    // on Windows the child runs inside a cmd.exe wrapper (see shell above);
    // killing that wrapper alone leaves the real process running, so kill
    // the whole tree by pid instead
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else {
      child.kill(sig);
    }
  };

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => killChild(sig));
  }

  child.on("error", (err) => {
    process.stderr.write(`mcp-debug: failed to start "${target}": ${err.message}\n`);
    process.exitCode = 1;
  });

  // "close" (not "exit") guarantees stdout/stderr have finished emitting
  // "close" themselves, so the flush() calls above have already run and
  // it's safe to end the log stream without a "write after end" race
  child.on("close", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
    logStream.end();
  });
}

function findLatestSession(): string | undefined {
  const dir = join(process.cwd(), ".mcp-debug");
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  return files.length > 0 ? join(dir, files[files.length - 1]) : undefined;
}

function replay(path: string | undefined): void {
  const sessionPath = path ?? findLatestSession();
  if (!sessionPath) {
    process.stderr.write("mcp-debug: no session file found (pass a path, or run in a directory with .mcp-debug/)\n");
    process.exit(1);
  }

  let content: string;
  try {
    content = readFileSync(sessionPath, "utf8");
  } catch (err) {
    process.stderr.write(`mcp-debug: could not read "${sessionPath}": ${(err as Error).message}\n`);
    process.exit(1);
  }

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: { time: string; channel: string; text: string; level?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.channel === "protocol") {
      process.stdout.write(`${COLOR.cyan}${entry.time} [rpc]${COLOR.reset} ${entry.text}\n`);
    } else {
      const color = entry.level === "error" ? COLOR.red : entry.level === "warn" ? COLOR.yellow : COLOR.gray;
      process.stdout.write(`${color}${entry.time} [${entry.level}]${COLOR.reset} ${entry.text}\n`);
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(readVersion() + "\n");
    return;
  }

  if (args[0] === "--help" || args[0] === "-h") {
    printUsage();
    return;
  }

  if (args[0] === "replay") {
    replay(args[1]);
    return;
  }

  if (args[0] !== "run") {
    printUsage();
    process.exit(args[0] ? 1 : 0);
  }

  const sepIndex = args.indexOf("--");
  if (sepIndex === -1 || sepIndex === args.length - 1) {
    printUsage();
    process.exit(1);
  }

  run(args[sepIndex + 1], args.slice(sepIndex + 2));
}

main();
