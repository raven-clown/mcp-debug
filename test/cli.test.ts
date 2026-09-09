import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

function run(args: string[], input?: string): Promise<RunResult> {
  const cwd = mkdtempSync(join(tmpdir(), "mcp-debug-test-"));
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [CLI, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code, cwd }));
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
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
