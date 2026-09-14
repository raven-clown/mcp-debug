import { describe, expect, test } from "bun:test";
import { formatLogEntry, parseLogFormat, readEntryTime } from "../src/log-format";

describe("parseLogFormat", () => {
  test("accepts the known formats", () => {
    expect(parseLogFormat("jsonl")).toBe("jsonl");
    expect(parseLogFormat("opensearch")).toBe("opensearch");
  });

  test("rejects anything else", () => {
    expect(parseLogFormat("text")).toBeNull();
    expect(parseLogFormat("")).toBeNull();
    expect(parseLogFormat("JSONL")).toBeNull();
  });
});

describe("formatLogEntry", () => {
  const entry = { time: "2026-01-01T00:00:00.000Z", channel: "log", level: "info", text: "hi" };

  test("jsonl keeps the time field as-is", () => {
    const line = formatLogEntry(entry, "jsonl");
    expect(JSON.parse(line)).toEqual(entry);
    expect(line.endsWith("\n")).toBe(true);
  });

  test("opensearch renames time to @timestamp and keeps other fields", () => {
    const line = formatLogEntry(entry, "opensearch");
    const parsed = JSON.parse(line);
    expect(parsed["@timestamp"]).toBe(entry.time);
    expect(parsed.time).toBeUndefined();
    expect(parsed.channel).toBe("log");
    expect(parsed.level).toBe("info");
    expect(parsed.text).toBe("hi");
  });
});

describe("readEntryTime", () => {
  test("reads a jsonl-style time field", () => {
    expect(readEntryTime({ time: "t1" })).toBe("t1");
  });

  test("reads an opensearch-style @timestamp field", () => {
    expect(readEntryTime({ "@timestamp": "t2" })).toBe("t2");
  });

  test("returns undefined when neither is present", () => {
    expect(readEntryTime({ channel: "log" })).toBeUndefined();
  });
});
