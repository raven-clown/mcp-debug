import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { debug, error, info, warn } from "../src/index";

let written: string[] = [];
let originalWrite: typeof process.stderr.write;

beforeEach(() => {
  written = [];
  originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string) => {
    written.push(chunk.toString());
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalWrite;
});

describe("logger", () => {
  test("writes valid JSON with the given level and label", () => {
    info("server.start", { pid: 123 });
    const entry = JSON.parse(written[0]);
    expect(entry.level).toBe("info");
    expect(entry.label).toBe("server.start");
    expect(entry.data).toEqual({ pid: 123 });
  });

  test("debug/warn/error use their own level", () => {
    debug("d");
    warn("w");
    error("e");
    expect(JSON.parse(written[0]).level).toBe("debug");
    expect(JSON.parse(written[1]).level).toBe("warn");
    expect(JSON.parse(written[2]).level).toBe("error");
  });

  test("does not throw on circular data", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(() => info("circular", obj)).not.toThrow();
    const entry = JSON.parse(written[0]);
    expect(entry.data.self).toBe("[Circular]");
  });

  test("does not throw on BigInt data", () => {
    expect(() => info("bigint", { big: 10n })).not.toThrow();
    const entry = JSON.parse(written[0]);
    expect(entry.data.big).toBe("10n");
  });

  test("falls back to a safe placeholder if serialization still fails", () => {
    const poison = {
      toJSON() {
        throw new Error("nope");
      },
    };
    expect(() => info("poison", poison)).not.toThrow();
    const entry = JSON.parse(written[0]);
    expect(entry.error).toContain("nope");
  });
});
