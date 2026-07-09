export type BenchStats = {
  runs: number
  batchSize: number
  medianMs: number
  p10Ms: number
  p90Ms: number
  infPerSec: number
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const a = sorted[lo]!
  const b = sorted[hi]!
  return a + (b - a) * (idx - lo)
}

export function summarize(timingsMs: number[], batchSize: number): BenchStats {
  if (timingsMs.length === 0) throw new Error('summarize: sin mediciones')
  const sorted = [...timingsMs].sort((a, b) => a - b)
  const medianMs = percentile(sorted, 0.5)
  return {
    runs: timingsMs.length,
    batchSize,
    medianMs,
    p10Ms: percentile(sorted, 0.1),
    p90Ms: percentile(sorted, 0.9),
    infPerSec: batchSize / (medianMs / 1000),
  }
}
