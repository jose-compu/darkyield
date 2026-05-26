/** Normalize JSON-deserialized values to a valid Date (APIs often return ISO strings). */
export function asDate(value: unknown): Date {
  if (value === null || value === undefined) {
    return new Date();
  }
  // Prefer string/number paths first — JSON never yields real Date instances.
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? new Date() : value;
  }
  if (typeof value === 'object' && '$date' in (value as object)) {
    const inner = (value as { $date: string | number }).$date;
    const d = new Date(inner);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function asTimeMs(value: unknown): number {
  return asDate(value).getTime();
}
