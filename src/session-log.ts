import { createWriteStream, existsSync, readdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

export interface SessionLogOptions {
  dir: string;
  prefix?: string;
  maxSizeBytes?: number;
  onRotate?: (newPath: string) => void;
  onError?: (err: Error) => void;
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

/** Writes session log lines to a file, rotating to a new file once the
 * current one passes maxSizeBytes instead of growing it unbounded.
 * Rotated files are named "<prefix>-YYYY-MM-DD-00001.jsonl",
 * "...-00002.jsonl", and so on: the sequence number is tracked in memory,
 * so rotation never has to ask the filesystem whether a name is free
 * (fs.createWriteStream() doesn't create the file synchronously, so that
 * check would be unreliable for rotations happening close together). */
export class SessionLog {
  private stream: WriteStream;
  private bytesWritten = 0;
  private prefix: string;
  private date: string;
  private seq: number;
  path: string;

  constructor(private options: SessionLogOptions) {
    this.prefix = options.prefix ?? "session";
    this.date = formatDate(new Date());
    this.seq = nextSeqForDate(options.dir, this.prefix, this.date);
    this.path = this.buildPath();
    while (existsSync(this.path)) {
      this.seq++;
      this.path = this.buildPath();
    }
    this.stream = this.openStream(this.path);
  }

  private buildPath(): string {
    return join(this.options.dir, `${this.prefix}-${this.date}-${pad(this.seq, SEQ_WIDTH)}.jsonl`);
  }

  private openStream(path: string): WriteStream {
    const stream = createWriteStream(path, { flags: "a" });
    stream.on("error", (err) => this.options.onError?.(err));
    return stream;
  }

  write(line: string): void {
    const bytes = Buffer.byteLength(line, "utf8");
    const cap = this.options.maxSizeBytes;
    if (cap !== undefined && this.bytesWritten > 0 && this.bytesWritten + bytes > cap) {
      this.rotate();
    }
    this.stream.write(line);
    this.bytesWritten += bytes;
  }

  private rotate(): void {
    this.stream.end();
    const today = formatDate(new Date());
    if (today !== this.date) {
      this.date = today;
      this.seq = 1;
    } else {
      this.seq++;
    }
    this.path = this.buildPath();
    this.stream = this.openStream(this.path);
    this.bytesWritten = 0;
    this.options.onRotate?.(this.path);
  }

  end(): void {
    this.stream.end();
  }
}
