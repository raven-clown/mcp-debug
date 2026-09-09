import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const FIXTURES = join(import.meta.dir, "fixtures");

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  cwd: string;
}

function run(args: string[], input?: string, cwd?: string): Promise<RunResult> {
  const dir = cwd ?? mkdtempSync(join(tmpdir(), "mcp-debug-test-"));
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [CLI, ...args], { cwd: dir });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code, cwd: dir }));
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    // a just-killed child process can briefly hold a Windows file lock
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
});

describe("mcp-debug run", () => {
  test("relays a JSON-RPC response through stdout untouched", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { hello: "world" } }) + "\n";
    const result = await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(result.cwd);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { echoed: { hello: "world" } },
    });
  });

  test("keeps debug logs off stdout", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const result = await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(result.cwd);

    for (const line of result.stdout.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(result.stderr).toContain("server.start");
    expect(result.stderr).toContain("request.received");
  });

  test("writes a session log file with protocol and log entries", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const result = await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(result.cwd);

    const sessionDir = join(result.cwd, ".mcp-debug");
    const files = readdirSync(sessionDir);
    expect(files.length).toBe(1);

    const entries = readFileSync(join(sessionDir, files[0]), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(entries.some((e) => e.channel === "protocol")).toBe(true);
    expect(entries.some((e) => e.channel === "log" && e.text.includes("server.start"))).toBe(true);
  });

  test("reports round-trip latency for a request/response pair", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const result = await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(result.cwd);
    expect(result.stderr).toContain("[rpc]");
    expect(result.stderr).toMatch(/id=1 \(\d+ms\)/);
  });

  test("flags a JSON-RPC error response", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "fail" }) + "\n";
    const result = await run(["run", "--", "node", join(FIXTURES, "error-server.js")], request);
    tempDirs.push(result.cwd);
    expect(result.stderr).toContain("error: boom");
  });

  test("prints an end-of-run summary", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const result = await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(result.cwd);
    expect(result.stderr).toContain("mcp-debug summary:");
    expect(result.stderr).toContain("1 requests, 1 responses");
  });

  test("--level filters out lower-severity debug logs", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const result = await run(
      ["run", "--level=error", "--", "node", join(FIXTURES, "echo-server.js")],
      request,
    );
    tempDirs.push(result.cwd);
    expect(result.stderr).not.toContain("[info]");
    expect(result.stderr).not.toContain("[debug]");
  });

  test("--verbose includes the full payload and redacts secrets", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { token: "sekrit" } }) + "\n";
    const result = await run(["run", "--verbose", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(result.cwd);
    expect(result.stderr).toContain("[redacted]");
    expect(result.stderr).not.toContain("sekrit");
    // the raw passthrough on stdout must stay untouched
    expect(result.stdout).toContain("sekrit");
  });

  test("redacts secrets from debug log data even without --verbose", async () => {
    const result = await run(["run", "--", "node", join(FIXTURES, "leaky-server.js")]);
    tempDirs.push(result.cwd);
    expect(result.stderr).toContain("[redacted]");
    expect(result.stderr).not.toContain("super-secret-token-123");

    const sessionDir = join(result.cwd, ".mcp-debug");
    const file = readdirSync(sessionDir)[0];
    const content = readFileSync(join(sessionDir, file), "utf8");
    expect(content).toContain("[redacted]");
    expect(content).not.toContain("super-secret-token-123");
  });

  test("--no-color disables ANSI escape codes", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const result = await run(["run", "--no-color", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(result.cwd);
    expect(result.stderr).not.toContain("\x1b[");
  });

  test("exits with the wrapped process's exit code", async () => {
    const result = await run(["run", "--", "node", join(FIXTURES, "exit-with-code.js"), "3"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(3);
  });

  test("fails clearly for a missing command", async () => {
    const result = await run(["run", "--", "definitely-not-a-real-command-xyz"]);
    tempDirs.push(result.cwd);
    expect(result.code).not.toBe(0);
    if (process.platform !== "win32") {
      // on win32 the command runs through cmd.exe (see shell: true in
      // src/cli.ts), which reports "not recognized" itself instead of
      // Node raising ENOENT
      expect(result.stderr).toContain("failed to start");
    }
  });

  test("keeps only the most recent 20 session files", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mcp-debug-test-"));
    tempDirs.push(cwd);
    const sessionDir = join(cwd, ".mcp-debug");
    mkdirSync(sessionDir, { recursive: true });
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(sessionDir, `session-${String(i).padStart(3, "0")}.jsonl`), "{}\n");
    }

    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request, cwd);

    expect(readdirSync(sessionDir).length).toBe(20);
  });
});

describe("mcp-debug replay", () => {
  test("reproduces the log entries from a saved session", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const recorded = await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(recorded.cwd);

    const replayed = await run(["replay"], undefined, recorded.cwd);
    expect(replayed.code).toBe(0);
    expect(replayed.stdout).toContain("server.start");
    expect(replayed.stdout).toContain("request.received");
    expect(replayed.stdout).toContain("[rpc]");
    expect(replayed.stdout).toContain("id=1");
  });

  test("accepts an explicit session file path", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const recorded = await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(recorded.cwd);

    const sessionDir = join(recorded.cwd, ".mcp-debug");
    const file = readdirSync(sessionDir)[0];
    const replayed = await run(["replay", join(sessionDir, file)], undefined, recorded.cwd);
    expect(replayed.code).toBe(0);
    expect(replayed.stdout).toContain("server.start");
  });

  test("fails clearly when no session exists", async () => {
    const result = await run(["replay"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no session file found");
  });

  test("fails clearly for a missing file path", async () => {
    const result = await run(["replay", "/no/such/file.jsonl"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("could not read");
  });

  test("--follow prints new lines appended after it starts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mcp-debug-test-"));
    tempDirs.push(cwd);
    const sessionDir = join(cwd, ".mcp-debug");
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, "session-1.jsonl");
    writeFileSync(sessionFile, JSON.stringify({ time: "t1", channel: "log", level: "info", text: "first" }) + "\n");

    const child = spawn("bun", [CLI, "replay", "--follow"], { cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));

    await new Promise((r) => setTimeout(r, 500));
    expect(stdout).toContain("first");

    writeFileSync(
      sessionFile,
      JSON.stringify({ time: "t2", channel: "log", level: "info", text: "second" }) + "\n",
      { flag: "a" },
    );
    await new Promise((r) => setTimeout(r, 800));
    expect(stdout).toContain("second");

    const exited = new Promise((r) => child.on("close", r));
    child.kill();
    await exited;
    // give Windows a moment to release its file handles on the temp dir
    await new Promise((r) => setTimeout(r, 200));
  });

  test("--follow recovers after the session file is truncated or recreated", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mcp-debug-test-"));
    tempDirs.push(cwd);
    const sessionDir = join(cwd, ".mcp-debug");
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, "session-1.jsonl");
    writeFileSync(
      sessionFile,
      JSON.stringify({ time: "t1", channel: "log", level: "info", text: "a longer first line" }) + "\n",
    );

    const child = spawn("bun", [CLI, "replay", "--follow"], { cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));

    await new Promise((r) => setTimeout(r, 500));
    expect(stdout).toContain("a longer first line");

    // simulate the file being truncated/recreated with shorter content
    writeFileSync(sessionFile, JSON.stringify({ time: "t2", channel: "log", level: "info", text: "short" }) + "\n");
    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(
      sessionFile,
      JSON.stringify({ time: "t3", channel: "log", level: "info", text: "after-shrink" }) + "\n",
      { flag: "a" },
    );
    await new Promise((r) => setTimeout(r, 800));
    expect(stdout).toContain("after-shrink");

    const exited = new Promise((r) => child.on("close", r));
    child.kill();
    await exited;
    await new Promise((r) => setTimeout(r, 200));
  });
});

describe("mcp-debug stats", () => {
  test("summarizes requests, responses, and latency", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n";
    const recorded = await run(["run", "--", "node", join(FIXTURES, "echo-server.js")], request);
    tempDirs.push(recorded.cwd);

    const result = await run(["stats"], undefined, recorded.cwd);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Requests: 1");
    expect(result.stdout).toContain("Responses: 1");
    expect(result.stdout).toMatch(/Latency: avg \d+ms, p95 \d+ms/);
    expect(result.stdout).toContain("ping: 1 calls");
  });

  test("reports errors separately", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "fail" }) + "\n";
    const recorded = await run(["run", "--", "node", join(FIXTURES, "error-server.js")], request);
    tempDirs.push(recorded.cwd);

    const result = await run(["stats"], undefined, recorded.cwd);
    expect(result.stdout).toContain("1 errors");
  });

  test("fails clearly when no session exists", async () => {
    const result = await run(["stats"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no session file found");
  });
});

describe("mcp-debug doctor", () => {
  test(
    "passes when the target command exists",
    async () => {
      const result = await run(["doctor", "--", "node"]);
      tempDirs.push(result.cwd);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("runtime:");
      expect(result.stdout).toContain('command "node" on PATH');
      expect(result.stdout).toContain("current directory writable");
    },
    10000,
  );

  test("fails when the target command is missing", async () => {
    const result = await run(["doctor", "--", "definitely-not-a-real-command-xyz"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("not found");
  });

  test("works without a target command", async () => {
    const result = await run(["doctor"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("runtime:");
  });

  test("errors instead of silently ignoring a target given without --", async () => {
    const result = await run(["doctor", "node"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--");
  });

  test("does not emit ANSI color codes when not a TTY", async () => {
    const result = await run(["doctor", "--", "node"]);
    tempDirs.push(result.cwd);
    expect(result.stdout).not.toContain("\x1b[");
  });

  test("checks a path target by existence, not PATH lookup", async () => {
    const result = await run(["doctor", "--", CLI]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("exists");
  });

  test("fails clearly for a path target that does not exist", async () => {
    const result = await run(["doctor", "--", "./no/such/path.js"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("not found");
  });
});

describe("mcp-debug flags", () => {
  test("--version prints the package version", async () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));
    const result = await run(["--version"]);
    tempDirs.push(result.cwd);
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.code).toBe(0);
  });

  test("--help prints usage and exits 0", async () => {
    const result = await run(["--help"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Usage: mcp-debug run");
  });

  test("no arguments prints usage and exits 0", async () => {
    const result = await run([]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(0);
  });

  test("unknown subcommand prints usage and exits 1", async () => {
    const result = await run(["bogus"]);
    tempDirs.push(result.cwd);
    expect(result.code).toBe(1);
  });
});
