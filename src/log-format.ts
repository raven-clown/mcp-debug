export type LogFormat = "jsonl" | "opensearch";

const LOG_FORMATS: LogFormat[] = ["jsonl", "opensearch"];

export function parseLogFormat(input: string): LogFormat | null {
  return (LOG_FORMATS as string[]).includes(input) ? (input as LogFormat) : null;
}

export interface LogEntryFields {
  time: string;
  channel: string;
  [key: string]: unknown;
}

/** Serializes one session log entry as a line. "opensearch" renames
 * "time" to "@timestamp", the field OpenSearch/Elasticsearch use to
 * recognize a document's time for time-based indices; everything else
 * stays the same, so the file is still plain JSON Lines either way. */
export function formatLogEntry(entry: LogEntryFields, format: LogFormat): string {
  if (format === "opensearch") {
    const { time, ...rest } = entry;
    return JSON.stringify({ "@timestamp": time, ...rest }) + "\n";
  }
  return JSON.stringify(entry) + "\n";
}

/** Reads the timestamp back out of a line written in either format. */
export function readEntryTime(entry: Record<string, unknown>): string | undefined {
  const time = entry.time ?? entry["@timestamp"];
  return typeof time === "string" ? time : undefined;
}
