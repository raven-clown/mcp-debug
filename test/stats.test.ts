import { describe, expect, test } from "bun:test";
import { computeStats, type SessionEntry } from "../src/stats";

function protocolEntry(overrides: Partial<SessionEntry>): SessionEntry {
  return { time: "2026-01-01T00:00:00.000Z", channel: "protocol", text: "", ...overrides };
}

describe("computeStats", () => {
  test("counts requests, responses, notifications, and anomalies", () => {
    const entries: SessionEntry[] = [
      protocolEntry({ direction: "request", method: "a", id: "1" }),
      protocolEntry({ direction: "response", method: "a", id: "1", latencyMs: 10 }),
      protocolEntry({ direction: "notification", method: "b" }),
      protocolEntry({ direction: "anomaly" }),
    ];
    const s = computeStats(entries);
    expect(s.requests).toBe(1);
    expect(s.responses).toBe(1);
    expect(s.notifications).toBe(1);
    expect(s.anomalies).toBe(1);
  });

  test("computes avg and p95 latency", () => {
    const entries: SessionEntry[] = [10, 20, 30, 40, 100].map((ms) =>
      protocolEntry({ direction: "response", method: "a", id: "1", latencyMs: ms }),
    );
    const s = computeStats(entries);
    expect(s.avgLatencyMs).toBe(40);
    expect(s.p95LatencyMs).toBe(100);
  });

  test("tracks the slowest response", () => {
    const entries: SessionEntry[] = [
      protocolEntry({ direction: "response", method: "a", id: "1", latencyMs: 10 }),
      protocolEntry({ direction: "response", method: "b", id: "2", latencyMs: 900 }),
    ];
    const s = computeStats(entries);
    expect(s.slowest).toEqual({ method: "b", id: "2", latencyMs: 900 });
  });

  test("counts errors separately from responses", () => {
    const entries: SessionEntry[] = [
      protocolEntry({ direction: "response", method: "a", id: "1", latencyMs: 10, isError: true }),
      protocolEntry({ direction: "response", method: "a", id: "2", latencyMs: 20 }),
    ];
    const s = computeStats(entries);
    expect(s.responses).toBe(2);
    expect(s.errors).toBe(1);
  });

  test("groups latency by method", () => {
    const entries: SessionEntry[] = [
      protocolEntry({ direction: "response", method: "a", id: "1", latencyMs: 10 }),
      protocolEntry({ direction: "response", method: "a", id: "2", latencyMs: 30 }),
      protocolEntry({ direction: "response", method: "b", id: "3", latencyMs: 100 }),
    ];
    const s = computeStats(entries);
    expect(s.byMethod.a).toEqual({ count: 2, avgLatencyMs: 20 });
    expect(s.byMethod.b).toEqual({ count: 1, avgLatencyMs: 100 });
  });

  test("returns nulls when there is no latency data", () => {
    const s = computeStats([]);
    expect(s.avgLatencyMs).toBeNull();
    expect(s.p95LatencyMs).toBeNull();
    expect(s.slowest).toBeNull();
  });

  test("ignores non-protocol (log) entries", () => {
    const entries: SessionEntry[] = [{ time: "t", channel: "log", text: "hello", level: "info" }];
    const s = computeStats(entries);
    expect(s.requests).toBe(0);
    expect(s.responses).toBe(0);
  });
});
