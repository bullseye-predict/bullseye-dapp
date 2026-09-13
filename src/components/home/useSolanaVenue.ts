import { useEffect, useState } from 'react'
import { getPredictionConfig } from '../../../packages/sdk/PredictionTradingClient'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'

/**
 * The Manifest venue that supplies every Solana question's binding. Three pages
 * need it (arena, event detail, market directory), so it lives here rather than
 * being re-implemented per page and drifting.
 */
export function useSolanaVenue(apiUrl: string, enabled = true) {
  const [venue, setVenue] = useState<PublicPredictionVenue | null>(null)
  useEffect(() => {
    setVenue(null)
    if (!apiUrl || !enabled) return
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const config = await getPredictionConfig(apiUrl, AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]))
        if (!controller.signal.aborted)
          setVenue(config.venues.find((item) => item.family === 'SOLANA' && item.matchingEngine === 'MANIFEST') ?? null)
      } catch {
        // A local backend may be restarted independently from Astro. Keep
        // retrying so wallet balances and trading recover without a page reload.
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void load(), 10_000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [apiUrl, enabled])
  return venue
}
