import { describe, expect, test } from "bun:test";
import { parseIncoming, parseOutgoing, type PendingEntry } from "../src/protocol";

function req(id: number, method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}
function res(id: number, result: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function errRes(id: number, message: string) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: -1, message } });
}
function notif(method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

describe("parseOutgoing", () => {
  test("classifies a request and tracks it as pending", () => {
    const pending = new Map<string, PendingEntry>();
    const [msg] = parseOutgoing(req(1, "ping"), pending, false);
    expect(msg.direction).toBe("request");
    expect(msg.method).toBe("ping");
    expect(pending.has("1")).toBe(true);
  });

  test("classifies a notification without tracking it", () => {
    const pending = new Map<string, PendingEntry>();
    const [msg] = parseOutgoing(notif("initialized"), pending, false);
    expect(msg.direction).toBe("notification");
    expect(pending.size).toBe(0);
  });

  test("flags a duplicate request id as an anomaly", () => {
    const pending = new Map<string, PendingEntry>();
    parseOutgoing(req(1, "ping"), pending, false);
    const [msg] = parseOutgoing(req(1, "ping"), pending, false);
    expect(msg.direction).toBe("anomaly");
    expect(msg.summary).toContain("duplicate");
  });

  test("flags a message with no jsonrpc field as an anomaly", () => {
    const pending = new Map<string, PendingEntry>();
    const [msg] = parseOutgoing(JSON.stringify({ id: 1, method: "ping" }), pending, false);
    expect(msg.direction).toBe("anomaly");
  });

  test("ignores non-JSON lines", () => {
    const pending = new Map<string, PendingEntry>();
    expect(parseOutgoing("not json", pending, false)).toEqual([]);
  });

  test("handles a batch of requests", () => {
    const pending = new Map<string, PendingEntry>();
    const batch = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "a" },
      { jsonrpc: "2.0", id: 2, method: "b" },
    ]);
    const msgs = parseOutgoing(batch, pending, false);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.method)).toEqual(["a", "b"]);
    expect(pending.size).toBe(2);
  });

  test("includes the redacted payload in verbose mode", () => {
    const pending = new Map<string, PendingEntry>();
    const [msg] = parseOutgoing(req(1, "auth", { token: "secret" }), pending, true);
    expect(msg.summary).toContain("[redacted]");
    expect(msg.summary).not.toContain("secret");
  });
});

describe("parseIncoming", () => {
  test("computes latency for a matching response", async () => {
    const pending = new Map<string, PendingEntry>();
    pending.set("1", { method: "ping", time: Date.now() - 10 });
    const [msg] = parseIncoming(res(1, { ok: true }), pending, false);
    expect(msg.direction).toBe("response");
    expect(msg.method).toBe("ping");
    expect(msg.latencyMs).toBeGreaterThanOrEqual(0);
    expect(pending.has("1")).toBe(false);
  });

  test("flags an error response", () => {
    const pending = new Map<string, PendingEntry>();
    pending.set("1", { method: "ping", time: Date.now() });
    const [msg] = parseIncoming(errRes(1, "boom"), pending, false);
    expect(msg.isError).toBe(true);
    expect(msg.summary).toContain("boom");
  });

  test("flags a response with no matching pending request as an anomaly", () => {
    const pending = new Map<string, PendingEntry>();
    const [msg] = parseIncoming(res(99, {}), pending, false);
    expect(msg.direction).toBe("anomaly");
    expect(msg.summary).toContain("unknown request id=99");
  });

  test("handles a batch of responses", () => {
    const pending = new Map<string, PendingEntry>();
    pending.set("1", { method: "a", time: Date.now() });
    pending.set("2", { method: "b", time: Date.now() });
    const batch = JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
    const msgs = parseIncoming(batch, pending, false);
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.direction === "response")).toBe(true);
  });
});
