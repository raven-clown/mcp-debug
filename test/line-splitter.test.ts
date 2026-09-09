import { describe, expect, test } from "bun:test";
import { LineSplitter } from "../src/line-splitter";

describe("LineSplitter", () => {
  test("splits multiple lines delivered in one chunk", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((l) => lines.push(l));
    splitter.push("a\nb\nc\n");
    expect(lines).toEqual(["a", "b", "c"]);
  });

  test("buffers a partial line across pushes", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((l) => lines.push(l));
    splitter.push("hel");
    splitter.push("lo\n");
    expect(lines).toEqual(["hello"]);
  });

  test("strips a trailing \\r for CRLF input", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((l) => lines.push(l));
    splitter.push("a\r\nb\r\n");
    expect(lines).toEqual(["a", "b"]);
  });

  test("skips empty lines", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((l) => lines.push(l));
    splitter.push("a\n\n\nb\n");
    expect(lines).toEqual(["a", "b"]);
  });

  test("flush emits a trailing line with no newline", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((l) => lines.push(l));
    splitter.push("no newline at end");
    expect(lines).toEqual([]);
    splitter.flush();
    expect(lines).toEqual(["no newline at end"]);
  });

  test("flush on an empty buffer emits nothing", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((l) => lines.push(l));
    splitter.push("complete\n");
    splitter.flush();
    expect(lines).toEqual(["complete"]);
  });

  test("accepts Buffer chunks", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((l) => lines.push(l));
    splitter.push(Buffer.from("buffered\n"));
    expect(lines).toEqual(["buffered"]);
  });

  test("reassembles a multi-byte UTF-8 character split across chunks", () => {
    const text = "สวัสดีครับ 你好 🎉 end\n";
    const buf = Buffer.from(text, "utf8");
    for (let splitPoint = 1; splitPoint < buf.length; splitPoint++) {
      const lines: string[] = [];
      const splitter = new LineSplitter((l) => lines.push(l));
      splitter.push(buf.subarray(0, splitPoint));
      splitter.push(buf.subarray(splitPoint));
      expect(lines[0]).toBe(text.trimEnd());
    }
  });

  test("flush decodes a trailing partial multi-byte character", () => {
    const text = "emoji at the end: 🎉";
    const buf = Buffer.from(text, "utf8");
    for (let splitPoint = 1; splitPoint < buf.length; splitPoint++) {
      const lines: string[] = [];
      const splitter = new LineSplitter((l) => lines.push(l));
      splitter.push(buf.subarray(0, splitPoint));
      splitter.push(buf.subarray(splitPoint));
      splitter.flush();
      expect(lines[0]).toBe(text);
    }
  });
});
