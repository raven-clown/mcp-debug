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

  test("hides content past the depth cap instead of returning it unredacted", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { token: "SECRET" } } } } } } } };
    const serialized = JSON.stringify(redact(deep));
    expect(serialized).not.toContain("SECRET");
    expect(serialized).toContain("nested too deep");
  });

  test("still redacts normally within the depth cap", () => {
    const shallow = { a: { b: { token: "abc" } } };
    expect(redact(shallow)).toEqual({ a: { b: { token: "[redacted]" } } });
  });

  test("does not let a __proto__ key pollute the returned object's prototype", () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": "yes"}, "token": "secret"}');
    const out = redact(malicious) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect((out as { token: string }).token).toBe("[redacted]");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
