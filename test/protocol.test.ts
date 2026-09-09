import { describe, expect, test } from "bun:test";
import { createPendingState, parseIncoming, parseOutgoing } from "../src/protocol";

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

describe("parseOutgoing (client -> server)", () => {
  test("classifies a request and tracks it as pending", () => {
    const pending = createPendingState();
    const [msg] = parseOutgoing(req(1, "ping"), pending, false);
    expect(msg.direction).toBe("request");
    expect(msg.method).toBe("ping");
    expect(pending.fromClient.has("1")).toBe(true);
  });

  test("classifies a notification without tracking it", () => {
    const pending = createPendingState();
    const [msg] = parseOutgoing(notif("initialized"), pending, false);
    expect(msg.direction).toBe("notification");
    expect(pending.fromClient.size).toBe(0);
  });

  test("flags a duplicate request id as an anomaly", () => {
    const pending = createPendingState();
    parseOutgoing(req(1, "ping"), pending, false);
    const [msg] = parseOutgoing(req(1, "ping"), pending, false);
    expect(msg.direction).toBe("anomaly");
    expect(msg.summary).toContain("duplicate");
  });

  test("flags a message with no jsonrpc field as an anomaly", () => {
    const pending = createPendingState();
    const [msg] = parseOutgoing(JSON.stringify({ id: 1, method: "ping" }), pending, false);
    expect(msg.direction).toBe("anomaly");
  });

  test("ignores non-JSON lines", () => {
    const pending = createPendingState();
    expect(parseOutgoing("not json", pending, false)).toEqual([]);
  });

  test("handles a batch of requests", () => {
    const pending = createPendingState();
    const batch = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "a" },
      { jsonrpc: "2.0", id: 2, method: "b" },
    ]);
    const msgs = parseOutgoing(batch, pending, false);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.method)).toEqual(["a", "b"]);
    expect(pending.fromClient.size).toBe(2);
  });

  test("includes the redacted payload in verbose mode", () => {
    const pending = createPendingState();
    const [msg] = parseOutgoing(req(1, "auth", { token: "secret" }), pending, true);
    expect(msg.summary).toContain("[redacted]");
    expect(msg.summary).not.toContain("secret");
  });

  test("classifies a client response to a server-initiated request", () => {
    const pending = createPendingState();
    parseIncoming(req(1, "sampling/createMessage"), pending, false);
    const [msg] = parseOutgoing(res(1, { ok: true }), pending, false);
    expect(msg.direction).toBe("response");
    expect(msg.method).toBe("sampling/createMessage");
    expect(pending.fromServer.has("1")).toBe(false);
  });
});

describe("parseIncoming (server -> client)", () => {
  test("computes latency for a matching response", async () => {
    const pending = createPendingState();
    pending.fromClient.set("1", { method: "ping", time: Date.now() - 10 });
    const [msg] = parseIncoming(res(1, { ok: true }), pending, false);
    expect(msg.direction).toBe("response");
    expect(msg.method).toBe("ping");
    expect(msg.latencyMs).toBeGreaterThanOrEqual(0);
    expect(pending.fromClient.has("1")).toBe(false);
  });

  test("flags an error response", () => {
    const pending = createPendingState();
    pending.fromClient.set("1", { method: "ping", time: Date.now() });
    const [msg] = parseIncoming(errRes(1, "boom"), pending, false);
    expect(msg.isError).toBe(true);
    expect(msg.summary).toContain("boom");
  });

  test("flags a response with no matching pending request as an anomaly", () => {
    const pending = createPendingState();
    const [msg] = parseIncoming(res(99, {}), pending, false);
    expect(msg.direction).toBe("anomaly");
    expect(msg.summary).toContain("unknown request id=99");
  });

  test("handles a batch of responses", () => {
    const pending = createPendingState();
    pending.fromClient.set("1", { method: "a", time: Date.now() });
    pending.fromClient.set("2", { method: "b", time: Date.now() });
    const batch = JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
    const msgs = parseIncoming(batch, pending, false);
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.direction === "response")).toBe(true);
  });

  test("classifies a server-initiated request and tracks it separately from client requests", () => {
    const pending = createPendingState();
    const [msg] = parseIncoming(req(1, "sampling/createMessage"), pending, false);
    expect(msg.direction).toBe("request");
    expect(pending.fromServer.has("1")).toBe(true);
  });

  test("client and server request ids do not collide", () => {
    const pending = createPendingState();
    parseOutgoing(req(1, "ping"), pending, false); // client id=1
    parseIncoming(req(1, "sampling/createMessage"), pending, false); // server id=1, independent sequence

    // resolving the server's id=1 must not affect the client's own id=1
    parseOutgoing(res(1, {}), pending, false);
    expect(pending.fromServer.has("1")).toBe(false);
    expect(pending.fromClient.has("1")).toBe(true);
  });
});
