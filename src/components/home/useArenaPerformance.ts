import { useCallback, useEffect, useRef, useState } from 'react'

export type ArenaPerformance = {
  checkedAt: number
  fps: number | null
  gpu: string | null
  tier: number
  type: string
}

const CACHE_KEY = 'solz:arena:gpu-performance:v1'
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1_000

function cachedPerformance(): ArenaPerformance | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? '') as Partial<ArenaPerformance>
    if (
      !Number.isFinite(value.checkedAt) ||
      Date.now() - Number(value.checkedAt) > CACHE_MAX_AGE ||
      !Number.isFinite(value.tier) ||
      typeof value.type !== 'string'
    ) return null
    return { checkedAt: Number(value.checkedAt), fps: Number.isFinite(value.fps) ? Number(value.fps) : null, gpu: typeof value.gpu === 'string' ? value.gpu : null, tier: Number(value.tier), type: value.type }
  } catch { return null }
}

/** A cached PMNDRS benchmark keeps iframe decisions consistent without blocking SSR. */
export function useArenaPerformance() {
  const [performance, setPerformance] = useState<ArenaPerformance | null>(null)
  const pending = useRef<Promise<ArenaPerformance> | null>(null)
  const inspect = useCallback(() => {
    if (performance) return Promise.resolve(performance)
    if (pending.current) return pending.current
    const cached = cachedPerformance()
    if (cached) { setPerformance(cached); return Promise.resolve(cached) }
    pending.current = import('@pmndrs/detect-gpu').then(({ getGPUTier }) => getGPUTier({ failIfMajorPerformanceCaveat: true })).then((result) => {
      const next: ArenaPerformance = { checkedAt: Date.now(), fps: Number.isFinite(result.fps) ? result.fps! : null, gpu: result.gpu ?? null, tier: result.tier, type: result.type }
      try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(next)) } catch { /* Detection still informs this session. */ }
      setPerformance(next)
      return next
    }).catch(() => {
      const next: ArenaPerformance = { checkedAt: Date.now(), fps: null, gpu: null, tier: 0, type: 'DETECTION_FAILED' }
      setPerformance(next)
      return next
    }).finally(() => { pending.current = null })
    return pending.current
  }, [performance])
  useEffect(() => { void inspect() }, [inspect])
  return { performance, inspect }
}

export function needsIframeWarning(performance: ArenaPerformance) {
  return performance.fps !== null ? performance.fps < 60 : performance.tier < 3
}
