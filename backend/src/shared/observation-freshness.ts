export function readPositiveSeconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function isObservationStale(
  observedAt: string | undefined,
  staleAfterSeconds: number,
  now: Date = new Date(),
): boolean {
  if (!observedAt) return false;
  const timestamp = Date.parse(observedAt);
  if (Number.isNaN(timestamp)) return true;
  return now.getTime() - timestamp > staleAfterSeconds * 1000;
}
