#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  unwatchFile,
  watchFile,
} from "node:fs";
import { join, resolve } from "node:path";
import { LineSplitter } from "./line-splitter.js";
import { createPendingState, parseIncoming, parseOutgoing, SLOW_THRESHOLD_MS, type ProtocolMessage } from "./protocol.js";
import { redact } from "./redact.js";
import { extractDate, parseSessionFilename, SessionLog } from "./session-log.js";
import { formatSize, parseSize } from "./size.js";
import { computeStats, type SessionEntry } from "./stats.js";
import { findOnPath } from "./which.js";

/** Anything writeProtocolMessages/handleDebugLine need from a log sink;
 * satisfied by both node's WriteStream and SessionLog. */
interface LogWriter {
  write(line: string): void;
}

const COLOR = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  green: "\x1b[32m",
};

const LEVEL_ORDER = ["debug", "info", "warn", "error"];
const MAX_SESSIONS = 20;

function cleanupOldSessions(dir: string, prefix: string, keep: number, maxAgeDays?: number): void {
  const files = readdirSync(dir)
    .filter((f) => parseSessionFilename(f, prefix) !== null)
    .sort();

  const toDelete = new Set(files.slice(0, Math.max(0, files.length - keep)));

  if (maxAgeDays !== undefined) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const f of files) {
      const ts = extractDate(f, prefix);
      if (ts !== null && ts < cutoff) toDelete.add(f);
    }
  }

  for (const f of toDelete) {
    try {
      unlinkSync(join(dir, f));
    } catch {
      // best effort
    }
  }
}

let useColor = true;
function paint(code: string, text: string): string {
  return useColor ? `${code}${text}${COLOR.reset}` : text;
}

function levelAllowed(min: string | undefined, level: string): boolean {
  if (!min) return true;
  const minIdx = LEVEL_ORDER.indexOf(min);
  const idx = LEVEL_ORDER.indexOf(level);
  if (minIdx === -1 || idx === -1) return true;
  return idx >= minIdx;
}

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

function writeProtocolMessages(messages: ProtocolMessage[], logStream: LogWriter, counters: RunCounters): void {
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
    process.stderr.write(`${paint(colorForProtocol(msg), `${time} [rpc]`)} ${msg.summary}\n`);
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
  process.stderr.write(`${paint(COLOR.gray, "mcp-debug summary:")} ${parts.join(", ")}\n`);
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
      "  mcp-debug run [flags] -- node server.js   wrap a stdio MCP server",
      "  mcp-debug replay [--follow] [file]        pretty-print a saved session (defaults to the latest)",
      "  mcp-debug stats [file]                    summarize a saved session (defaults to the latest)",
      "  mcp-debug doctor -- <command>              sanity-check the environment and command",
      "  mcp-debug --version                       print the installed version",
      "  mcp-debug --help                          show this message",
      "",
      "Flags for run: --verbose  --level=debug|info|warn|error  --no-color",
      "  --max-sessions=<n>     keep at most n session files (default 20)",
      "  --max-age=<days>       also delete session files older than n days",
      "  --max-size=<size>      rotate to a new file past this size, e.g. 10MB",
      "  --session-dir=<path>   where to write session files (default .mcp-debug)",
      "  --session-name=<name>  filename prefix for session files (default session)",
      "",
      "Each of the above can also be set via MCP_DEBUG_MAX_SESSIONS, MCP_DEBUG_MAX_AGE,",
      "MCP_DEBUG_MAX_SIZE, MCP_DEBUG_SESSION_DIR, MCP_DEBUG_SESSION_NAME; a flag wins over its env var.",
      "",
    ].join("\n"),
  );
}

function handleDebugLine(line: string, logStream: LogWriter, minLevel: string | undefined): void {
  let text = line;
  let level = "log";
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && "level" in parsed) {
      level = String(parsed.level);
      text = [parsed.label, parsed.data !== undefined ? JSON.stringify(redact(parsed.data)) : ""]
        .filter(Boolean)
        .join(" ");
    }
  } catch {
    // not a structured entry, print the raw line as-is
  }
  const time = new Date().toISOString();
  logStream.write(JSON.stringify({ time, channel: "log", level, text }) + "\n");

  if (!levelAllowed(minLevel, level)) return;
  const color = level === "error" ? COLOR.red : level === "warn" ? COLOR.yellow : COLOR.gray;
  process.stderr.write(`${paint(color, `${time} [${level}]`)} ${text}\n`);
}

interface RunFlags {
  level?: string;
  verbose: boolean;
  noColor: boolean;
  maxSessions: number;
  maxAgeDays?: number;
  maxSizeBytes?: number;
  sessionDir?: string;
  sessionName?: string;
}

/** A prefix becomes part of a filename joined onto sessionDir, so it must
 * not contain path separators or ".." components (that would let
 * --session-name or MCP_DEBUG_SESSION_NAME write outside sessionDir). */
function isSafeSessionName(name: string): boolean {
  return name.length > 0 && !/[\\/]/.test(name) && name !== "." && name !== "..";
}

function parseFlags(args: string[]): RunFlags {
  const env = process.env;
  const flags: RunFlags = {
    verbose: false,
    noColor: false,
    maxSessions: MAX_SESSIONS,
    sessionDir: env.MCP_DEBUG_SESSION_DIR,
    sessionName: env.MCP_DEBUG_SESSION_NAME,
  };

  if (env.MCP_DEBUG_MAX_SESSIONS !== undefined) {
    const n = Number(env.MCP_DEBUG_MAX_SESSIONS);
    if (Number.isInteger(n) && n >= 1) flags.maxSessions = n;
  }
  if (env.MCP_DEBUG_MAX_AGE !== undefined) {
    const n = Number(env.MCP_DEBUG_MAX_AGE);
    if (Number.isFinite(n) && n > 0) flags.maxAgeDays = n;
  }
  if (env.MCP_DEBUG_MAX_SIZE !== undefined) {
    const bytes = parseSize(env.MCP_DEBUG_MAX_SIZE);
    if (bytes !== null && bytes > 0) flags.maxSizeBytes = bytes;
  }
  if (flags.sessionName !== undefined && !isSafeSessionName(flags.sessionName)) {
    process.stderr.write(`mcp-debug: MCP_DEBUG_SESSION_NAME must not contain path separators, got "${flags.sessionName}"\n`);
    process.exit(1);
  }

  for (const a of args) {
    if (a.startsWith("--level=")) {
      flags.level = a.slice("--level=".length);
    } else if (a === "--verbose") {
      flags.verbose = true;
    } else if (a === "--no-color") {
      flags.noColor = true;
    } else if (a.startsWith("--max-sessions=")) {
      const n = Number(a.slice("--max-sessions=".length));
      if (!Number.isInteger(n) || n < 1) {
        process.stderr.write(`mcp-debug: --max-sessions must be a positive integer, got "${a.slice("--max-sessions=".length)}"\n`);
        process.exit(1);
      }
      flags.maxSessions = n;
    } else if (a.startsWith("--max-age=")) {
      const n = Number(a.slice("--max-age=".length));
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`mcp-debug: --max-age must be a positive number of days, got "${a.slice("--max-age=".length)}"\n`);
        process.exit(1);
      }
      flags.maxAgeDays = n;
    } else if (a.startsWith("--max-size=")) {
      const raw = a.slice("--max-size=".length);
      const bytes = parseSize(raw);
      if (bytes === null || bytes <= 0) {
        process.stderr.write(`mcp-debug: --max-size must look like "10MB", "500KB", "1GB", got "${raw}"\n`);
        process.exit(1);
      }
      flags.maxSizeBytes = bytes;
    } else if (a.startsWith("--session-dir=")) {
      flags.sessionDir = a.slice("--session-dir=".length);
    } else if (a.startsWith("--session-name=")) {
      const name = a.slice("--session-name=".length);
      if (!isSafeSessionName(name)) {
        process.stderr.write(`mcp-debug: --session-name must not contain path separators, got "${name}"\n`);
        process.exit(1);
      }
      flags.sessionName = name;
    }
  }
  return flags;
}

function run(target: string, targetArgs: string[], flags: RunFlags): void {
  useColor = !flags.noColor && !!process.stderr.isTTY;

  const sessionDir = resolve(process.cwd(), flags.sessionDir ?? ".mcp-debug");
  const sessionName = flags.sessionName ?? "session";
  mkdirSync(sessionDir, { recursive: true });
  // clean up before creating this run's file: createWriteStream opens
  // asynchronously, so a cleanup after it would race and miss the new file
  cleanupOldSessions(sessionDir, sessionName, flags.maxSessions - 1, flags.maxAgeDays);
  const logStream = new SessionLog({
    dir: sessionDir,
    prefix: sessionName,
    maxSizeBytes: flags.maxSizeBytes,
    onRotate: () => cleanupOldSessions(sessionDir, sessionName, flags.maxSessions, flags.maxAgeDays),
    onError: (err) => {
      process.stderr.write(`mcp-debug: log file write failed: ${err.message}\n`);
    },
  });

  const child = spawn(target, targetArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  const pending = createPendingState();
  const counters: RunCounters = {
    requests: 0,
    responses: 0,
    notifications: 0,
    errors: 0,
    anomalies: 0,
    latencies: [],
  };

  const stdinSplitter = new LineSplitter((line) => {
    writeProtocolMessages(parseOutgoing(line, pending, flags.verbose), logStream, counters);
  });
  process.stdin.on("data", (chunk: Buffer) => stdinSplitter.push(chunk));
  process.stdin.pipe(child.stdin);

  const stdoutSplitter = new LineSplitter((line) => {
    writeProtocolMessages(parseIncoming(line, pending, flags.verbose), logStream, counters);
  });
  // pipe (not manual .write()) so Node applies backpressure automatically
  // if the downstream consumer reads slower than the server writes
  child.stdout.pipe(process.stdout, { end: false });
  child.stdout.on("data", (chunk: Buffer) => stdoutSplitter.push(chunk));
  child.stdout.on("close", () => stdoutSplitter.flush());

  const stderrSplitter = new LineSplitter((line) => handleDebugLine(line, logStream, flags.level));
  child.stderr.on("data", (chunk: Buffer) => stderrSplitter.push(chunk));
  child.stderr.on("close", () => stderrSplitter.flush());

  const killChild = (sig: NodeJS.Signals): void => {
    // on Windows the child runs inside a cmd.exe wrapper (see shell above);
    // killing that wrapper alone leaves the real process running, so kill
    // the whole tree by pid instead
    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      // an unhandled "error" on a ChildProcess throws and crashes this
      // process; if taskkill itself can't be spawned, fail quietly instead
      killer.on("error", (err) => {
        process.stderr.write(`mcp-debug: failed to run taskkill: ${err.message}\n`);
      });
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

// matches "<any-prefix>-YYYY-MM-DD-00001.jsonl" regardless of which
// --session-name/MCP_DEBUG_SESSION_NAME prefix produced it, so replay/stats
// can find the latest session without knowing the prefix run() used
const ANY_SESSION_FILE = /-\d{4}-\d{2}-\d{2}-\d{5}\.jsonl$/;

function findLatestSession(): string | undefined {
  const dir = resolve(process.cwd(), process.env.MCP_DEBUG_SESSION_DIR ?? ".mcp-debug");
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((f) => ANY_SESSION_FILE.test(f))
    .sort();
  return files.length > 0 ? join(dir, files[files.length - 1]) : undefined;
}

function resolveSessionPath(path: string | undefined): string {
  const sessionPath = path ?? findLatestSession();
  if (!sessionPath) {
    process.stderr.write("mcp-debug: no session file found (pass a path, or run in a directory with .mcp-debug/)\n");
    process.exit(1);
  }
  return sessionPath;
}

function readSessionFile(sessionPath: string): string {
  try {
    return readFileSync(sessionPath, "utf8");
  } catch (err) {
    process.stderr.write(`mcp-debug: could not read "${sessionPath}": ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function printSessionLine(line: string): void {
  if (!line.trim()) return;
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
    return;
  }

  if (entry.channel === "protocol") {
    const color =
      entry.direction === "anomaly"
        ? COLOR.yellow
        : entry.isError || (entry.latencyMs !== undefined && entry.latencyMs > SLOW_THRESHOLD_MS)
          ? COLOR.red
          : COLOR.cyan;
    process.stdout.write(`${paint(color, `${entry.time} [rpc]`)} ${entry.text}\n`);
  } else {
    const color = entry.level === "error" ? COLOR.red : entry.level === "warn" ? COLOR.yellow : COLOR.gray;
    process.stdout.write(`${paint(color, `${entry.time} [${entry.level}]`)} ${entry.text}\n`);
  }
}

function replay(path: string | undefined, noColor: boolean, follow: boolean): void {
  useColor = !noColor && !!process.stdout.isTTY;
  const sessionPath = resolveSessionPath(path);
  const content = readSessionFile(sessionPath);
  for (const line of content.split("\n")) printSessionLine(line);

  if (!follow) return;

  let position: number;
  try {
    position = statSync(sessionPath).size;
  } catch (err) {
    process.stderr.write(`mcp-debug: could not follow "${sessionPath}": ${(err as Error).message}\n`);
    process.exit(1);
  }
  watchFile(sessionPath, { interval: 300 }, () => {
    // the file can disappear out from under us (another run's session
    // cleanup, or it's just gone); an fs error here must not crash the
    // process, so the whole read is wrapped rather than just the stat
    try {
      const size = statSync(sessionPath).size;
      // the file was truncated or recreated (e.g. a new run started):
      // resync from the start instead of getting stuck past its new size
      if (size < position) position = 0;
      if (size <= position) return;
      const fd = openSync(sessionPath, "r");
      const buf = Buffer.alloc(size - position);
      readSync(fd, buf, 0, buf.length, position);
      closeSync(fd);
      position = size;
      for (const line of buf.toString("utf8").split("\n")) printSessionLine(line);
    } catch (err) {
      process.stderr.write(`mcp-debug: stopped following "${sessionPath}": ${(err as Error).message}\n`);
      unwatchFile(sessionPath);
    }
  });
}

function statsCmd(path: string | undefined): void {
  const sessionPath = resolveSessionPath(path);
  const content = readSessionFile(sessionPath);

  const entries: SessionEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  const s = computeStats(entries);
  process.stdout.write(`Requests: ${s.requests}\n`);
  process.stdout.write(`Responses: ${s.responses}${s.errors > 0 ? ` (${s.errors} errors)` : ""}\n`);
  process.stdout.write(`Notifications: ${s.notifications}\n`);
  if (s.anomalies > 0) process.stdout.write(`Anomalies: ${s.anomalies}\n`);
  if (s.avgLatencyMs !== null) {
    process.stdout.write(`Latency: avg ${s.avgLatencyMs}ms, p95 ${s.p95LatencyMs}ms\n`);
  }
  if (s.slowest) {
    process.stdout.write(`Slowest: ${s.slowest.method} id=${s.slowest.id} (${s.slowest.latencyMs}ms)\n`);
  }

  const methods = Object.entries(s.byMethod).sort((a, b) => b[1].count - a[1].count);
  if (methods.length > 0) {
    process.stdout.write("\nBy method:\n");
    for (const [method, m] of methods) {
      process.stdout.write(`  ${method}: ${m.count} calls, avg ${m.avgLatencyMs}ms\n`);
    }
  }
}

function doctor(target: string | undefined): void {
  useColor = !!process.stdout.isTTY;
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  checks.push({ name: "runtime", ok: true, detail: `${process.platform}, node ${process.version}` });

  if (target) {
    if (target.includes("/") || target.includes("\\")) {
      // a path, not a bare command name: "where"/"which" only search PATH
      // by name and error out or give false negatives on an actual path
      const found = existsSync(target);
      checks.push({ name: `path "${target}" exists`, ok: found, detail: found ? target : "not found" });
    } else {
      const found = findOnPath(target);
      checks.push({ name: `command "${target}" on PATH`, ok: found !== null, detail: found ?? "not found" });
    }
  }

  try {
    accessSync(process.cwd(), constants.W_OK);
    checks.push({ name: "current directory writable", ok: true, detail: process.cwd() });
  } catch {
    checks.push({ name: "current directory writable", ok: false, detail: process.cwd() });
  }

  let allOk = true;
  for (const c of checks) {
    allOk = allOk && c.ok;
    const mark = c.ok ? paint(COLOR.green, "✓") : paint(COLOR.red, "✗");
    process.stdout.write(`${mark} ${c.name}: ${c.detail}\n`);
  }
  process.exitCode = allOk ? 0 : 1;
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
    const rest = args.slice(1);
    const noColor = rest.includes("--no-color");
    const follow = rest.includes("--follow");
    const path = rest.find((a) => a !== "--no-color" && a !== "--follow");
    replay(path, noColor, follow);
    return;
  }

  if (args[0] === "stats") {
    statsCmd(args[1]);
    return;
  }

  if (args[0] === "doctor") {
    const sepIndex = args.indexOf("--");
    if (sepIndex === -1 && args.length > 1) {
      process.stderr.write('mcp-debug: doctor takes a command after "--", e.g. mcp-debug doctor -- node\n');
      process.exit(1);
    }
    const target = sepIndex !== -1 ? args[sepIndex + 1] : undefined;
    doctor(target);
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

  const flags = parseFlags(args.slice(1, sepIndex));
  run(args[sepIndex + 1], args.slice(sepIndex + 2), flags);
}

main();
