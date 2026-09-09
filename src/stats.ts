export interface SessionEntry {
  time: string;
  channel: "protocol" | "log";
  text: string;
  level?: string;
  direction?: "request" | "response" | "notification" | "anomaly";
  method?: string;
  id?: string;
  latencyMs?: number;
  isError?: boolean;
}

export interface MethodStats {
  count: number;
  avgLatencyMs: number;
}

export interface SessionStats {
  requests: number;
  responses: number;
  notifications: number;
  errors: number;
  anomalies: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  slowest: { method: string; id?: string; latencyMs: number } | null;
  byMethod: Record<string, MethodStats>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function computeStats(entries: SessionEntry[]): SessionStats {
  const stats: SessionStats = {
    requests: 0,
    responses: 0,
    notifications: 0,
    errors: 0,
    anomalies: 0,
    avgLatencyMs: null,
    p95LatencyMs: null,
    slowest: null,
    byMethod: {},
  };

  const latencies: number[] = [];
  const byMethodLatencies: Record<string, number[]> = {};

  for (const e of entries) {
    if (e.channel !== "protocol") continue;
    switch (e.direction) {
      case "request":
        stats.requests++;
        break;
      case "notification":
        stats.notifications++;
        break;
      case "anomaly":
        stats.anomalies++;
        break;
      case "response": {
        stats.responses++;
        if (e.isError) stats.errors++;
        if (typeof e.latencyMs === "number") {
          latencies.push(e.latencyMs);
          const method = e.method ?? "(unknown)";
          (byMethodLatencies[method] ??= []).push(e.latencyMs);
          if (!stats.slowest || e.latencyMs > stats.slowest.latencyMs) {
            stats.slowest = { method, id: e.id, latencyMs: e.latencyMs };
          }
        }
        break;
      }
    }
  }

  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    stats.avgLatencyMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    stats.p95LatencyMs = percentile(sorted, 95);
  }

  for (const [method, list] of Object.entries(byMethodLatencies)) {
    stats.byMethod[method] = {
      count: list.length,
      avgLatencyMs: Math.round(list.reduce((a, b) => a + b, 0) / list.length),
    };
  }

  return stats;
}
