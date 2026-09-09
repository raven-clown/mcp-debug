import { describe, expect, test } from "bun:test";
import { redact } from "../src/redact";

describe("redact", () => {
  test("masks keys that look sensitive", () => {
    const out = redact({ token: "abc", apiKey: "xyz", password: "hunter2", name: "ok" });
    expect(out).toEqual({ token: "[redacted]", apiKey: "[redacted]", password: "[redacted]", name: "ok" });
  });

  test("recurses into nested objects and arrays", () => {
    const out = redact({ user: { authorization: "Bearer x", id: 1 }, list: [{ secret: "s" }] });
    expect(out).toEqual({ user: { authorization: "[redacted]", id: 1 }, list: [{ secret: "[redacted]" }] });
  });

  test("leaves primitives and non-sensitive keys untouched", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact({ method: "ping", id: 1 })).toEqual({ method: "ping", id: 1 });
  });
});
