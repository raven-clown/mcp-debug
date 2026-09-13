const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

/** Parses a size string like "10MB", "500KB", "1GB", or a bare number of
 * bytes ("2048"). Returns null if the string doesn't look like a size. */
export function parseSize(input: string): number | null {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  return Math.round(value * UNITS[unit]);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
