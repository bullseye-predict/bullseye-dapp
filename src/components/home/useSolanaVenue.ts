import { useEffect, useMemo, useState } from 'react'
import { getPredictionConfig } from '../../../packages/sdk/PredictionTradingClient'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { publicSolanaVenue } from './solanaVenueFallback'

/**
 * The Manifest venue that supplies every Solana question's binding. Three pages
 * need it (arena, event detail, market directory), so it lives here rather than
 * being re-implemented per page and drifting.
 */
export function useSolanaVenue(apiUrl: string, enabled = true) {
  const fallback = useMemo(() => publicSolanaVenue(), [])
  const [venue, setVenue] = useState<PublicPredictionVenue | null>(fallback)
  useEffect(() => {
    setVenue(enabled ? fallback : null)
    if (!apiUrl || !enabled) return
    const controller = new AbortController()
    let timer: number | undefined
    let retryDelay = 30_000
    const load = async () => {
      try {
        const config = await getPredictionConfig(apiUrl, AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]))
        if (!controller.signal.aborted)
          setVenue(config.venues.find((item) => item.family === 'SOLANA' && item.matchingEngine === 'MANIFEST') ?? fallback)
        // Venue configuration is deployment metadata. It does not need to
        // share the 10s cadence used by live order-book reads.
        retryDelay = 30_000
      } catch {
        // A local backend may be restarted independently from Astro. Keep
        // retrying so wallet balances and trading recover without a page reload,
        // but do not hammer a rate-limited config endpoint.
        if (!controller.signal.aborted) {
          // Retain the public deployment identity while the API recovers. It
          // is enough for direct Manifest reads and wallet-signed CLOB trades.
          setVenue(fallback)
          timer = window.setTimeout(() => void load(), retryDelay)
          retryDelay = Math.min(5 * 60_000, retryDelay * 2)
        }
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [apiUrl, enabled])
  return venue
}
