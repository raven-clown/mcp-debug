import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { findOnPath } from "../src/which";

describe("findOnPath", () => {
  test("finds a bare command by exact name on POSIX", () => {
    const dir = mkdtempSync(join(tmpdir(), "which-test-"));
    try {
      const bin = join(dir, "mytool");
      writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
      const found = findOnPath("mytool", { PATH: dir }, "linux");
      expect(found).toBe(bin);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")("does not find a non-executable file on POSIX", () => {
    // the execute-permission bit is a real POSIX filesystem concept the
    // underlying OS must enforce; Windows has no equivalent to test against
    const dir = mkdtempSync(join(tmpdir(), "which-test-"));
    try {
      writeFileSync(join(dir, "notexec"), "hello", { mode: 0o644 });
      expect(findOnPath("notexec", { PATH: dir }, "linux")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tries PATHEXT extensions on Windows for a bare name", () => {
    const dir = mkdtempSync(join(tmpdir(), "which-test-"));
    try {
      writeFileSync(join(dir, "mytool.EXE"), "");
      const found = findOnPath("mytool", { PATH: dir, PATHEXT: ".COM;.EXE;.BAT" }, "win32");
      expect(found).toBe(join(dir, "mytool.EXE"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not re-append an extension already present on Windows", () => {
    const dir = mkdtempSync(join(tmpdir(), "which-test-"));
    try {
      writeFileSync(join(dir, "mytool.exe"), "");
      const found = findOnPath("mytool.exe", { PATH: dir, PATHEXT: ".COM;.EXE;.BAT" }, "win32");
      expect(found).toBe(join(dir, "mytool.exe"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("searches multiple PATH directories in order", () => {
    const dirA = mkdtempSync(join(tmpdir(), "which-test-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "which-test-b-"));
    try {
      writeFileSync(join(dirB, "onlyinb"), "#!/bin/sh\n", { mode: 0o755 });
      const path = [dirA, dirB].join(delimiter);
      const found = findOnPath("onlyinb", { PATH: path }, "linux");
      expect(found).toBe(join(dirB, "onlyinb"));
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  test("returns null when the command is nowhere on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "which-test-"));
    try {
      expect(findOnPath("definitely-not-a-real-command-xyz", { PATH: dir }, "linux")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null when PATH is unset", () => {
    expect(findOnPath("node", {}, "linux")).toBeNull();
  });
});
