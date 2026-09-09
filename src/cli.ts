#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const COLOR = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

class LineSplitter {
  private buf = "";
  constructor(private onLine: (line: string) => void) {}

  push(chunk: Buffer): void {
    this.buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      if (line.length > 0) this.onLine(line);
    }
  }

  flush(): void {
    const rest = this.buf.replace(/\r$/, "");
    this.buf = "";
    if (rest.length > 0) this.onLine(rest);
  }
}

function printUsage(): void {
  process.stderr.write("Usage: mcp-debug run -- <command> [args...]\n");
}

function handleProtocolLine(line: string, logPath: string): void {
  let summary: string;
  try {
    const msg = JSON.parse(line);
    if (!msg || typeof msg !== "object" || !("jsonrpc" in msg)) return;
    const parts = [msg.method, msg.id !== undefined ? `id=${msg.id}` : null].filter(Boolean);
    summary = parts.join(" ") || "(response)";
  } catch {
    return;
  }
  const time = new Date().toISOString();
  process.stderr.write(`${COLOR.cyan}${time} [rpc]${COLOR.reset} ${summary}\n`);
  appendFileSync(logPath, JSON.stringify({ time, channel: "protocol", text: summary }) + "\n");
}

function handleDebugLine(line: string, logPath: string): void {
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
  appendFileSync(logPath, JSON.stringify({ time, channel: "log", level, text }) + "\n");
}

function run(target: string, targetArgs: string[]): void {
  const sessionDir = join(process.cwd(), ".mcp-debug");
  mkdirSync(sessionDir, { recursive: true });
  const logPath = join(sessionDir, `session-${Date.now()}.jsonl`);

  const child = spawn(target, targetArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  process.stdin.pipe(child.stdin);

  const stdoutSplitter = new LineSplitter((line) => handleProtocolLine(line, logPath));
  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    stdoutSplitter.push(chunk);
  });
  child.stdout.on("close", () => stdoutSplitter.flush());

  const stderrSplitter = new LineSplitter((line) => handleDebugLine(line, logPath));
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

  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

function main(): void {
  const args = process.argv.slice(2);
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
