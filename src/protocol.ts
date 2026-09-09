import { redact } from "./redact.js";

export type Direction = "request" | "response" | "notification" | "anomaly";

export interface ProtocolMessage {
  direction: Direction;
  method?: string;
  id?: string;
  latencyMs?: number;
  isError?: boolean;
  summary: string;
}

export const SLOW_THRESHOLD_MS = 500;

export interface PendingEntry {
  method: string;
  time: number;
}

function safeParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function isJsonRpc(msg: unknown): msg is Record<string, unknown> {
  return !!msg && typeof msg === "object" && !Array.isArray(msg);
}

function withPayload(summary: string, msg: unknown, verbose: boolean): string {
  return verbose ? `${summary} ${JSON.stringify(redact(msg))}` : summary;
}

/** Messages the client sends the server (our own stdin, tapped before piping through). */
export function parseOutgoing(
  line: string,
  pending: Map<string, PendingEntry>,
  verbose: boolean,
): ProtocolMessage[] {
  const parsed = safeParse(line);
  if (parsed === undefined) return [];
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((msg) => classifyOutgoing(msg, pending, verbose));
}

function classifyOutgoing(msg: unknown, pending: Map<string, PendingEntry>, verbose: boolean): ProtocolMessage {
  if (!isJsonRpc(msg) || !("jsonrpc" in msg)) {
    return { direction: "anomaly", summary: withPayload("malformed message: missing jsonrpc field", msg, verbose) };
  }

  const method = typeof msg.method === "string" ? msg.method : undefined;
  const id = msg.id !== undefined ? String(msg.id) : undefined;

  if (method && id !== undefined) {
    if (pending.has(id)) {
      return {
        direction: "anomaly",
        id,
        summary: withPayload(`duplicate request id=${id} (previous request still pending)`, msg, verbose),
      };
    }
    pending.set(id, { method, time: Date.now() });
    return { direction: "request", method, id, summary: withPayload(`→ ${method} id=${id}`, msg, verbose) };
  }

  if (method) {
    return { direction: "notification", method, summary: withPayload(`→ ${method}`, msg, verbose) };
  }

  return { direction: "anomaly", summary: withPayload("malformed request: no method", msg, verbose) };
}

/** Messages the server sends the client (child's stdout, relayed through untouched). */
export function parseIncoming(
  line: string,
  pending: Map<string, PendingEntry>,
  verbose: boolean,
): ProtocolMessage[] {
  const parsed = safeParse(line);
  if (parsed === undefined) return [];
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((msg) => classifyIncoming(msg, pending, verbose));
}

function classifyIncoming(msg: unknown, pending: Map<string, PendingEntry>, verbose: boolean): ProtocolMessage {
  if (!isJsonRpc(msg) || !("jsonrpc" in msg)) {
    return { direction: "anomaly", summary: withPayload("malformed message: missing jsonrpc field", msg, verbose) };
  }

  const method = typeof msg.method === "string" ? msg.method : undefined;
  const id = msg.id !== undefined ? String(msg.id) : undefined;

  if (method) {
    // server-initiated request or notification (e.g. sampling)
    const summary = id !== undefined ? `← ${method} id=${id}` : `← ${method}`;
    return { direction: id !== undefined ? "request" : "notification", method, id, summary: withPayload(summary, msg, verbose) };
  }

  if (id !== undefined) {
    const start = pending.get(id);
    const isError = "error" in msg;
    if (!start) {
      return {
        direction: "anomaly",
        id,
        summary: withPayload(`response for unknown request id=${id}`, msg, verbose),
      };
    }
    pending.delete(id);
    const latencyMs = Date.now() - start.time;
    const errorText = isError && msg.error && typeof msg.error === "object" && "message" in (msg.error as object)
      ? ` error: ${(msg.error as { message: unknown }).message}`
      : "";
    return {
      direction: "response",
      method: start.method,
      id,
      latencyMs,
      isError,
      summary: withPayload(`← ${start.method} id=${id} (${latencyMs}ms)${errorText}`, msg, verbose),
    };
  }

  return { direction: "anomaly", summary: withPayload("malformed message: no id or method", msg, verbose) };
}
