/** Persisted pool list filters (shared by Pools + Settings). */
export const LS_MAX_APY = 'darkyield_maxReasonableApyPercent'
export const LS_INCLUDE_OUTLIERS = 'darkyield_includeApyOutliers'

export function loadApyCeiling(fallback: number, hardCap = 50_000): number {
  try {
    const s = localStorage.getItem(LS_MAX_APY)
    if (s != null) {
      const n = parseFloat(s)
      if (Number.isFinite(n) && n >= 1) return Math.min(n, hardCap)
    }
  } catch {
    /* ignore */
  }
  return fallback
}

export function saveApyCeiling(n: number): void {
  localStorage.setItem(LS_MAX_APY, String(n))
}

export function loadIncludeOutliers(): boolean {
  return localStorage.getItem(LS_INCLUDE_OUTLIERS) === 'true'
}

export function saveIncludeOutliers(v: boolean): void {
  localStorage.setItem(LS_INCLUDE_OUTLIERS, v ? 'true' : 'false')
}
