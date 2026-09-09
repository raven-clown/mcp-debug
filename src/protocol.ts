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

/** Two independent maps: client-issued request ids and server-issued
 * request ids are separate numbering sequences and may collide. */
export interface PendingState {
  fromClient: Map<string, PendingEntry>;
  fromServer: Map<string, PendingEntry>;
}

export function createPendingState(): PendingState {
  return { fromClient: new Map(), fromServer: new Map() };
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

function errorText(msg: Record<string, unknown>): string {
  if (!("error" in msg)) return "";
  const err = msg.error;
  return err && typeof err === "object" && "message" in err ? ` error: ${(err as { message: unknown }).message}` : "";
}

function classifyRequestOrNotification(
  msg: Record<string, unknown>,
  arrow: string,
  ownPending: Map<string, PendingEntry>,
  verbose: boolean,
): ProtocolMessage {
  const method = msg.method as string;
  const id = msg.id !== undefined ? String(msg.id) : undefined;

  if (id === undefined) {
    return { direction: "notification", method, summary: withPayload(`${arrow} ${method}`, msg, verbose) };
  }
  if (ownPending.has(id)) {
    return {
      direction: "anomaly",
      id,
      summary: withPayload(`duplicate request id=${id} (previous request still pending)`, msg, verbose),
    };
  }
  ownPending.set(id, { method, time: Date.now() });
  return { direction: "request", method, id, summary: withPayload(`${arrow} ${method} id=${id}`, msg, verbose) };
}

function classifyResponse(
  msg: Record<string, unknown>,
  arrow: string,
  counterpartPending: Map<string, PendingEntry>,
  verbose: boolean,
): ProtocolMessage {
  const id = String(msg.id);
  const start = counterpartPending.get(id);
  if (!start) {
    return { direction: "anomaly", id, summary: withPayload(`response for unknown request id=${id}`, msg, verbose) };
  }
  counterpartPending.delete(id);
  const latencyMs = Date.now() - start.time;
  const isError = "error" in msg;
  return {
    direction: "response",
    method: start.method,
    id,
    latencyMs,
    isError,
    summary: withPayload(`${arrow} ${start.method} id=${id} (${latencyMs}ms)${errorText(msg)}`, msg, verbose),
  };
}

function classify(
  msg: unknown,
  arrow: string,
  ownPending: Map<string, PendingEntry>,
  counterpartPending: Map<string, PendingEntry>,
  verbose: boolean,
): ProtocolMessage {
  if (!isJsonRpc(msg) || !("jsonrpc" in msg)) {
    return { direction: "anomaly", summary: withPayload("malformed message: missing jsonrpc field", msg, verbose) };
  }
  if (typeof msg.method === "string") {
    return classifyRequestOrNotification(msg, arrow, ownPending, verbose);
  }
  if (msg.id !== undefined) {
    return classifyResponse(msg, arrow, counterpartPending, verbose);
  }
  return { direction: "anomaly", summary: withPayload("malformed message: no id or method", msg, verbose) };
}

/** Messages the client sends the server (our own stdin, tapped before piping through). */
export function parseOutgoing(line: string, pending: PendingState, verbose: boolean): ProtocolMessage[] {
  const parsed = safeParse(line);
  if (parsed === undefined) return [];
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((msg) => classify(msg, "→", pending.fromClient, pending.fromServer, verbose));
}

/** Messages the server sends the client (child's stdout, relayed through untouched). */
export function parseIncoming(line: string, pending: PendingState, verbose: boolean): ProtocolMessage[] {
  const parsed = safeParse(line);
  if (parsed === undefined) return [];
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((msg) => classify(msg, "←", pending.fromServer, pending.fromClient, verbose));
}
