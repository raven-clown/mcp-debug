const SENSITIVE_KEY = /token|secret|password|passwd|api[_-]?key|authorization/i;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;

  // fail closed: past the depth cap, hide the remaining structure instead
  // of returning it unredacted (a secret nested deep enough must not slip
  // through just because we stopped walking it)
  if (depth > 6) return "[redacted: nested too deep]";

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  // Object.create(null) has no [[Prototype]], so a "__proto__" key from
  // untrusted JSON.parse'd input becomes a plain own property here instead
  // of reaching the inherited __proto__ setter and altering out's prototype
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(val, depth + 1);
  }
  return out;
}
