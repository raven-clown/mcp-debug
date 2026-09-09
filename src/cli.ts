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
import { parseIncoming, parseOutgoing, SLOW_THRESHOLD_MS, type PendingEntry, type ProtocolMessage } from "./protocol.js";

const COLOR = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function colorForProtocol(msg: ProtocolMessage): string {
  if (msg.direction === "anomaly") return COLOR.yellow;
  if (msg.direction === "response" && msg.isError) return COLOR.red;
  if (msg.latencyMs !== undefined && msg.latencyMs > SLOW_THRESHOLD_MS) return COLOR.red;
  return COLOR.cyan;
}

interface RunCounters {
  requests: number;
  responses: number;
  notifications: number;
  errors: number;
  anomalies: number;
  latencies: number[];
}

function writeProtocolMessages(messages: ProtocolMessage[], logStream: WriteStream, counters: RunCounters): void {
  for (const msg of messages) {
    if (msg.direction === "request") counters.requests++;
    if (msg.direction === "notification") counters.notifications++;
    if (msg.direction === "anomaly") counters.anomalies++;
    if (msg.direction === "response") {
      counters.responses++;
      if (msg.isError) counters.errors++;
      if (msg.latencyMs !== undefined) counters.latencies.push(msg.latencyMs);
    }

    const time = new Date().toISOString();
    process.stderr.write(`${colorForProtocol(msg)}${time} [rpc]${COLOR.reset} ${msg.summary}\n`);
    logStream.write(
      JSON.stringify({
        time,
        channel: "protocol",
        direction: msg.direction,
        method: msg.method,
        id: msg.id,
        latencyMs: msg.latencyMs,
        isError: msg.isError,
        text: msg.summary,
      }) + "\n",
    );
  }
}

function printSummary(counters: RunCounters): void {
  const parts = [`${counters.requests} requests`, `${counters.responses} responses`];
  if (counters.errors > 0) parts.push(`${counters.errors} errors`);
  if (counters.anomalies > 0) parts.push(`${counters.anomalies} anomalies`);
  if (counters.latencies.length > 0) {
    const avg = Math.round(counters.latencies.reduce((a, b) => a + b, 0) / counters.latencies.length);
    const max = Math.max(...counters.latencies);
    parts.push(`avg ${avg}ms`, `slowest ${max}ms`);
  }
  process.stderr.write(`${COLOR.gray}mcp-debug summary:${COLOR.reset} ${parts.join(", ")}\n`);
}

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

  const pending = new Map<string, PendingEntry>();
  const counters: RunCounters = {
    requests: 0,
    responses: 0,
    notifications: 0,
    errors: 0,
    anomalies: 0,
    latencies: [],
  };

  const stdinSplitter = new LineSplitter((line) => {
    writeProtocolMessages(parseOutgoing(line, pending, false), logStream, counters);
  });
  process.stdin.on("data", (chunk: Buffer) => stdinSplitter.push(chunk));
  process.stdin.pipe(child.stdin);

  const stdoutSplitter = new LineSplitter((line) => {
    writeProtocolMessages(parseIncoming(line, pending, false), logStream, counters);
  });
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
    printSummary(counters);
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
    let entry: {
      time: string;
      channel: string;
      text: string;
      level?: string;
      direction?: string;
      latencyMs?: number;
      isError?: boolean;
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.channel === "protocol") {
      const color =
        entry.direction === "anomaly"
          ? COLOR.yellow
          : entry.isError || (entry.latencyMs !== undefined && entry.latencyMs > SLOW_THRESHOLD_MS)
            ? COLOR.red
            : COLOR.cyan;
      process.stdout.write(`${color}${entry.time} [rpc]${COLOR.reset} ${entry.text}\n`);
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
