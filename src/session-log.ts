import { createWriteStream, openSync, readdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

export interface SessionLogOptions {
  dir: string;
  prefix?: string;
  maxSizeBytes?: number;
  onRotate?: (newPath: string) => void;
  onError?: (err: Error) => void;
  /** Injectable clock, for tests that need to force a date rollover. */
  now?: () => Date;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

const SEQ_WIDTH = 5;

/** Formats a Date as YYYY-MM-DD in local time. */
export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sessionFileRegex(prefix: string): RegExp {
  return new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})-(\\d+)\\.jsonl$`);
}

export interface ParsedSessionFilename {
  date: string;
  seq: number;
}

/** Splits a "<prefix>-YYYY-MM-DD-00001.jsonl" filename into its date and
 * rotation sequence number, or null if it doesn't match. */
export function parseSessionFilename(filename: string, prefix = "session"): ParsedSessionFilename | null {
  const match = filename.match(sessionFileRegex(prefix));
  if (!match) return null;
  return { date: match[1], seq: Number(match[2]) };
}

/** Extracts the embedded date from a session filename as epoch
 * milliseconds (midnight local time), for age-based cleanup. */
export function extractDate(filename: string, prefix = "session"): number | null {
  const parsed = parseSessionFilename(filename, prefix);
  if (!parsed) return null;
  const [y, mo, d] = parsed.date.split("-").map(Number);
  return new Date(y, mo - 1, d).getTime();
}

/** Finds the next free rotation number for today by scanning the
 * directory once at startup, so a restarted process continues the
 * sequence instead of overwriting today's last file. */
function nextSeqForDate(dir: string, prefix: string, date: string): number {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return 1;
  }
  const re = sessionFileRegex(prefix);
  let max = 0;
  for (const f of files) {
    const match = f.match(re);
    if (match && match[1] === date) max = Math.max(max, Number(match[2]));
  }
  return max + 1;
}

/** Opens the first free "<prefix>-<date>-NNNNN.jsonl" at or after startSeq.
 * Uses the "ax" open flag so file creation itself is the collision check
 * (fails atomically with EEXIST if the name is taken) rather than an
 * existsSync() check followed by a separate open. That distinction
 * matters here: a plain check-then-open has a gap where another writer
 * can create the file in between the two calls - either a second
 * mcp-debug process sharing the same session directory and prefix, or
 * (before this fix) this same process rotating across a date boundary
 * into a date another process already started logging to. Either way,
 * the loser would silently start appending into the winner's file
 * instead of getting its own, interleaving two unrelated sessions. */
function openUniqueSession(dir: string, prefix: string, date: string, startSeq: number): { seq: number; path: string; fd: number } {
  let seq = startSeq;
  for (;;) {
    const path = join(dir, `${prefix}-${date}-${pad(seq, SEQ_WIDTH)}.jsonl`);
    try {
      const fd = openSync(path, "ax");
      return { seq, path, fd };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        seq++;
        continue;
      }
      throw err;
    }
  }
}

/** Writes session log lines to a file, rotating to a new file once the
 * current one passes maxSizeBytes instead of growing it unbounded.
 * Rotated files are named "<prefix>-YYYY-MM-DD-00001.jsonl",
 * "...-00002.jsonl", and so on. */
export class SessionLog {
  private stream: WriteStream;
  private bytesWritten = 0;
  private prefix: string;
  private now: () => Date;
  private date: string;
  private seq: number;
  path: string;

  constructor(private options: SessionLogOptions) {
    this.prefix = options.prefix ?? "session";
    this.now = options.now ?? (() => new Date());
    this.date = formatDate(this.now());
    const startSeq = nextSeqForDate(options.dir, this.prefix, this.date);
    const opened = openUniqueSession(options.dir, this.prefix, this.date, startSeq);
    this.seq = opened.seq;
    this.path = opened.path;
    this.stream = this.wrapStream(opened.fd);
  }

  private wrapStream(fd: number): WriteStream {
    const stream = createWriteStream("", { fd });
    stream.on("error", (err) => this.options.onError?.(err));
    return stream;
  }

  write(line: string): void {
    const bytes = Buffer.byteLength(line, "utf8");
    const cap = this.options.maxSizeBytes;
    if (cap !== undefined && this.bytesWritten > 0 && this.bytesWritten + bytes > cap) {
      // a logging call must never crash its caller: opening the next file
      // (openSync, in rotate()) can throw for reasons other than the
      // EEXIST it already retries on - disk full, permission changes
      // mid-run, too many open files - so a failed rotation falls back to
      // the current file instead of taking down the whole process
      try {
        this.rotate();
      } catch (err) {
        this.options.onError?.(err as Error);
      }
    }
    this.stream.write(line);
    this.bytesWritten += bytes;
  }

  private rotate(): void {
    const today = formatDate(this.now());
    const startSeq = today !== this.date ? nextSeqForDate(this.options.dir, this.prefix, today) : this.seq + 1;
    // open the new file before touching the old stream: if this throws,
    // the caller's catch leaves the current (still-open, still-working)
    // stream in place instead of having already ended it for a
    // replacement that never arrived
    const opened = openUniqueSession(this.options.dir, this.prefix, today, startSeq);
    const oldStream = this.stream;
    this.date = today;
    this.seq = opened.seq;
    this.path = opened.path;
    this.stream = this.wrapStream(opened.fd);
    this.bytesWritten = 0;
    oldStream.end();
    this.options.onRotate?.(this.path);
  }

  end(): void {
    this.stream.end();
  }
}
