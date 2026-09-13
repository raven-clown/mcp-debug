import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractDate, formatDate, parseSessionFilename, SessionLog } from "../src/session-log";

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "session-log-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function waitTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50));
}

describe("SessionLog", () => {
  test("writes lines to a single file when under the size cap", async () => {
    await withTempDir(async (dir) => {
      const log = new SessionLog({ dir });
      log.write("line one\n");
      log.write("line two\n");
      log.end();
      await waitTick();

      const files = readdirSync(dir);
      expect(files.length).toBe(1);
      expect(readFileSync(join(dir, files[0]), "utf8")).toBe("line one\nline two\n");
    });
  });

  test("rotates to a new file once the cap would be exceeded", async () => {
    await withTempDir(async (dir) => {
      const rotated: string[] = [];
      const log = new SessionLog({ dir, maxSizeBytes: 20, onRotate: (p) => rotated.push(p) });
      log.write("0123456789\n"); // 11 bytes, fits
      log.write("0123456789\n"); // would be 22 bytes, over cap: rotate first
      log.end();
      await waitTick();

      expect(rotated.length).toBe(1);
      const files = readdirSync(dir).sort();
      expect(files.length).toBe(2);
      expect(readFileSync(join(dir, files[0]), "utf8")).toBe("0123456789\n");
      expect(readFileSync(join(dir, files[1]), "utf8")).toBe("0123456789\n");
    });
  });

  test("always writes the first line even if it alone exceeds the cap", async () => {
    await withTempDir(async (dir) => {
      const rotated: string[] = [];
      const log = new SessionLog({ dir, maxSizeBytes: 5, onRotate: (p) => rotated.push(p) });
      log.write("this line alone is already over the cap\n");
      log.end();
      await waitTick();

      expect(rotated.length).toBe(0);
      const files = readdirSync(dir);
      expect(files.length).toBe(1);
      expect(readFileSync(join(dir, files[0]), "utf8")).toBe("this line alone is already over the cap\n");
    });
  });

  test("keeps rotating across multiple size-cap crossings", async () => {
    await withTempDir(async (dir) => {
      const rotated: string[] = [];
      const log = new SessionLog({ dir, maxSizeBytes: 10, onRotate: (p) => rotated.push(p) });
      for (let i = 0; i < 5; i++) log.write("12345\n");
      log.end();
      await waitTick();

      const files = readdirSync(dir);
      expect(files.length).toBeGreaterThan(1);
      expect(rotated.length).toBe(files.length - 1);
    });
  });

  test("exposes the current file path, updated after rotation", async () => {
    await withTempDir(async (dir) => {
      const log = new SessionLog({ dir, maxSizeBytes: 5 });
      const firstPath = log.path;
      log.write("aaaaaaaaaa\n");
      log.write("bbbbbbbbbb\n");
      expect(log.path).not.toBe(firstPath);
      log.end();
    });
  });

  test("uses a human-readable dated filename with an incrementing sequence", async () => {
    await withTempDir(async (dir) => {
      const log = new SessionLog({ dir });
      log.write("x\n");
      log.end();
      await waitTick();

      const files = readdirSync(dir);
      expect(files[0]).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{5}\.jsonl$/);
    });
  });

  test("uses a custom prefix when given one", async () => {
    await withTempDir(async (dir) => {
      const log = new SessionLog({ dir, prefix: "mytool" });
      log.write("x\n");
      log.end();
      await waitTick();

      const files = readdirSync(dir);
      expect(files[0]).toMatch(/^mytool-\d{4}-\d{2}-\d{2}-\d{5}\.jsonl$/);
    });
  });

  test("rotation numbers increment 1, 2, 3, ... rather than reusing a name", async () => {
    await withTempDir(async (dir) => {
      const log = new SessionLog({ dir, maxSizeBytes: 1 });
      log.write("a\n");
      log.write("b\n");
      log.write("c\n");
      log.end();
      await waitTick();

      const files = readdirSync(dir).sort();
      const unique = new Set(files);
      expect(unique.size).toBe(files.length);
      expect(files.length).toBeGreaterThanOrEqual(2);

      const seqs = files.map((f) => parseSessionFilename(f)?.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => (a ?? 0) - (b ?? 0)));
    });
  });

  test("resumes the sequence for today instead of overwriting on restart", async () => {
    await withTempDir(async (dir) => {
      const first = new SessionLog({ dir });
      first.write("x\n");
      first.end();
      await waitTick();

      const second = new SessionLog({ dir });
      second.write("y\n");
      second.end();
      await waitTick();

      expect(second.path).not.toBe(first.path);
      const files = readdirSync(dir);
      expect(files.length).toBe(2);
    });
  });

  test("does not collide with a same-day file another process already created", async () => {
    await withTempDir(async (dir) => {
      // simulate a second process that already claimed 00001 for today
      writeFileSync(join(dir, `session-${formatDate(new Date())}-00001.jsonl`), "other process\n");

      const log = new SessionLog({ dir });
      expect(log.path).not.toContain("00001.jsonl");
      log.write("x\n");
      log.end();
      await waitTick();

      expect(readFileSync(join(dir, `session-${formatDate(new Date())}-00001.jsonl`), "utf8")).toBe("other process\n");
    });
  });

  test("does not append into another process's file when rotation crosses midnight", async () => {
    await withTempDir(async (dir) => {
      let now = new Date(2026, 0, 1, 23, 59, 0);
      const log = new SessionLog({ dir, maxSizeBytes: 5, now: () => now });
      log.write("first\n"); // establishes bytesWritten > 0 so the next write can rotate

      // another process starts logging for the new day before we rotate into it
      const tomorrow = "2026-01-02";
      const tomorrowsFirstFile = join(dir, `session-${tomorrow}-00001.jsonl`);
      writeFileSync(tomorrowsFirstFile, "other process\n");

      now = new Date(2026, 0, 2, 0, 5, 0);
      log.write("aaaaaa\n"); // crosses the date boundary and rotates
      expect(log.path).not.toBe(tomorrowsFirstFile);
      log.end();
      await waitTick();

      expect(readFileSync(tomorrowsFirstFile, "utf8")).toBe("other process\n");
      expect(readFileSync(log.path, "utf8")).toBe("aaaaaa\n");
    });
  });
});

describe("formatDate / extractDate / parseSessionFilename", () => {
  test("formats a date as YYYY-MM-DD", () => {
    expect(formatDate(new Date(2026, 8, 13))).toBe("2026-09-13");
  });

  test("parses the date and sequence out of a session filename", () => {
    expect(parseSessionFilename("session-2026-09-13-00042.jsonl")).toEqual({ date: "2026-09-13", seq: 42 });
  });

  test("parses filenames with a custom prefix", () => {
    expect(parseSessionFilename("my-custom-prefix-2026-01-01-00001.jsonl", "my-custom-prefix")).toEqual({
      date: "2026-01-01",
      seq: 1,
    });
  });

  test("returns null for a filename with no embedded date", () => {
    expect(parseSessionFilename("session-not-a-date.jsonl")).toBeNull();
  });

  test("extracts the date as epoch milliseconds at local midnight", () => {
    expect(extractDate("session-2026-01-01-00001.jsonl")).toBe(new Date(2026, 0, 1).getTime());
  });
});
