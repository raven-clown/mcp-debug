import { describe, expect, test } from "bun:test";
import { formatSize, parseSize } from "../src/size";

describe("parseSize", () => {
  test("parses a bare number as bytes", () => {
    expect(parseSize("2048")).toBe(2048);
  });

  test("parses KB, MB, GB (case-insensitive)", () => {
    expect(parseSize("500KB")).toBe(500 * 1024);
    expect(parseSize("10mb")).toBe(10 * 1024 * 1024);
    expect(parseSize("1GB")).toBe(1024 * 1024 * 1024);
  });

  test("allows a space between the number and unit", () => {
    expect(parseSize("10 MB")).toBe(10 * 1024 * 1024);
  });

  test("allows a decimal value", () => {
    expect(parseSize("1.5MB")).toBe(Math.round(1.5 * 1024 * 1024));
  });

  test("returns null for garbage input", () => {
    expect(parseSize("not a size")).toBeNull();
    expect(parseSize("")).toBeNull();
    expect(parseSize("10TB")).toBeNull();
    expect(parseSize("-5MB")).toBeNull();
  });
});

describe("formatSize", () => {
  test("formats bytes, KB, MB, GB at the right scale", () => {
    expect(formatSize(500)).toBe("500B");
    expect(formatSize(2048)).toBe("2.0KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0MB");
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe("2.0GB");
  });
});
