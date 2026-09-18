import { useEffect, useMemo, useRef, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { manifestClient } from '../home/venue/manifestClients'
import type { ReservedSolanaQuestion } from '../home/solanaQuestionMarkets'
import { ManifestPortfolioReader, type ManifestPortfolio } from './solanaPortfolio'
import { schedulePoll } from '../home/venue/pollGate'

const POLL_MS = 30_000
const CACHE_MAX_AGE_MS = 2 * 60_000
const CACHE_PREFIX = 'coola:solana-portfolio:v1:'

export type SolanaPortfolioState = {
  portfolio: ManifestPortfolio | null
  loading: boolean
  error: string
}

const IDLE: SolanaPortfolioState = { portfolio: null, loading: false, error: '' }

type CachedPortfolio = { at: number; portfolio: ManifestPortfolio }

/** Browser storage is an outage cushion, never a source of truth. BigInts need
 * an explicit representation because JSON refuses them by default. */
function cacheKey(key: string) { return `${CACHE_PREFIX}${key}` }
function readCachedPortfolio(key: string): CachedPortfolio | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(key)) ?? '', (_key, item) =>
      item && typeof item === 'object' && typeof item.__coolaBigInt === 'string' ? BigInt(item.__coolaBigInt) : item,
    ) as CachedPortfolio
    return Number.isSafeInteger(value?.at) && value.portfolio && Array.isArray(value.portfolio.questions) && Date.now() - value.at <= CACHE_MAX_AGE_MS ? value : null
  } catch { return null }
}
function writeCachedPortfolio(key: string, portfolio: ManifestPortfolio) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(cacheKey(key), JSON.stringify({ at: Date.now(), portfolio }, (_key, item) =>
      typeof item === 'bigint' ? { __coolaBigInt: item.toString() } : item,
    ))
  } catch { /* Private browsing or a full quota must not affect a chain read. */ }
}

function deployment(venue: PublicPredictionVenue | null | undefined) {
  if (!venue?.programId || !venue.manifestProgramId || !venue.publicRpcUrl || !venue.collateralToken) return null
  return { rpcUrl: venue.publicRpcUrl, genesisHash: venue.chainId, predictionProgram: venue.programId, manifestProgram: venue.manifestProgramId, collateralMint: venue.collateralToken }
}

/**
 * The connected or browsed trader's Solana holdings, read straight from the
 * Manifest venue.
 *
 * Balances poll like the rest of the page; executed history does not. A history
 * pass walks every book the trader could have traded on and is bounded by the
 * fill reader's cache, so it runs on mount and on an explicit refresh rather
 * than every thirty seconds.
 */
export function useSolanaPortfolio(venue: PublicPredictionVenue | null | undefined, owner: string | undefined, questions: readonly ReservedSolanaQuestion[], retry: number): SolanaPortfolioState {
  const config = useMemo(() => deployment(venue), [venue?.publicRpcUrl, venue?.chainId, venue?.programId, venue?.manifestProgramId, venue?.collateralToken])
  const marketIds = useMemo(() => [...new Set(questions.map(question => question.marketId))].sort(), [questions])
  // The wallet and the deployment identify this read. The question catalogue
  // does NOT, although every market it names is read: the catalogue is
  // re-polled every ten seconds from two different endpoints, and any question
  // appearing or disappearing used to restart the whole effect — a fresh
  // discovery call and, before it was removed, a fresh 240-transaction history
  // scan. A membership change is a reason to read different accounts on the
  // next poll, never a reason to tear the reader down and start again.
  const key = `${config?.rpcUrl ?? ''}:${config?.predictionProgram ?? ''}:${config?.manifestProgram ?? ''}:${owner ?? ''}`
  const [state, setState] = useState<{ key: string } & SolanaPortfolioState>({ key: '', ...IDLE })
  // Read inside the poll rather than closed over, so a catalogue change is
  // picked up by the next tick without re-running the effect.
  const markets = useRef(marketIds)
  markets.current = marketIds
  // Which Refresh press this effect run belongs to. `retry` only ever counts
  // up, so testing `retry === 0` treated every run after the first press as a
  // refresh and left the cache permanently unused — which is why the page got
  // hungrier the more the trader clicked.
  const lastRetry = useRef(retry)

  useEffect(() => {
    if (!config || !owner) { setState({ key, ...IDLE }); return }
    let active = true
    let cancelPoll: (() => void) | undefined
    const refreshing = retry !== lastRetry.current
    lastRetry.current = retry
    let client: ReturnType<typeof manifestClient>
    try {
      new PublicKey(owner)
      client = manifestClient(config.rpcUrl, config)
    } catch (reason) {
      setState({ key, ...IDLE, error: reason instanceof Error ? reason.message : 'This Solana venue is misconfigured.' })
      return
    }
    const reader = new ManifestPortfolioReader(client.adapter)

    // Questions the trader still holds but that the live catalogue has dropped.
    // Discovery is a chain read, so it runs once on arrival rather than on
    // every poll; the ids it finds are then read like any other question.
    let extra: string[] = []
    const cached = readCachedPortfolio(key)

    async function load(first: boolean) {
      try {
        if (first) {
          // A cache already names every market in the last successful account
          // read. Reusing it avoids the expensive token-account discovery call
          // on reload, which was the first request to hit public RPC limits.
          const listed = new Set(markets.current)
          if (cached) extra = cached.portfolio.questions.map(question => question.marketId).filter(id => !listed.has(id))
          else try { extra = (await reader.discover(owner!)).filter(id => !listed.has(id)) }
          catch { extra = [] }
        }
        const portfolio = await reader.read(owner!, [...new Set([...markets.current, ...extra])].sort(), extra)
        if (!active) return
        writeCachedPortfolio(key, portfolio)
        setState(current => ({ ...current, key, portfolio, loading: false, error: '' }))
      } catch (reason) {
        // Keep the last verified snapshot visible while the shared RPC gate
        // backs off. A 429 is temporary, not evidence the wallet is empty.
        if (active) setState(current => ({ ...current, key, loading: false, error: reason instanceof Error ? reason.message : 'Solana positions are unavailable.' }))
      } finally {
        if (active) cancelPoll = schedulePoll(() => void load(false), POLL_MS)
      }
    }
    if (cached && !refreshing) {
      setState({ key, portfolio: cached.portfolio, loading: false, error: '' })
      const age = Date.now() - cached.at
      // A just-verified account does not need another RPC pass simply because
      // the page re-mounted. The normal poll resumes when it becomes due.
      cancelPoll = schedulePoll(() => void load(true), Math.max(0, POLL_MS - age))
    } else {
      // A Refresh press must actually read, so it shows the cached snapshot
      // while the read runs rather than blanking the table behind a spinner.
      setState(current => cached
        ? { key, portfolio: cached.portfolio, loading: true, error: '' }
        : current.key === key
          ? { ...current, loading: true }
          : { key, ...IDLE, loading: true })
      void load(true)
    }
    return () => { active = false; cancelPoll?.() }
  }, [key, retry])

  return state.key === key ? state : { ...IDLE, loading: Boolean(config && owner) }
}
