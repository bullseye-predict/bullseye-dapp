import { useEffect, useMemo, useRef, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { bookAddress } from '../../../packages/adapters/solana/manifest/wire'
import { manifestClient } from '../home/venue/manifestClients'
import type { ReservedSolanaQuestion } from '../home/solanaQuestionMarkets'
import { ManifestPortfolioReader, type ManifestPortfolio } from './solanaPortfolio'
import { ManifestFillReader, fillCashFlow, type ManifestHistory } from './solanaFills'
import type { CashFlow } from './cashFlow'

const POLL_MS = 30_000

export type SolanaPortfolioState = {
  portfolio: ManifestPortfolio | null
  loading: boolean
  error: string
  /** Executed trades, oldest first, for the net-flow chart. */
  flows: CashFlow[]
  historyLoading: boolean
  /** History hit its scan cap, so the chart is a tail rather than the whole record. */
  historyLimited: boolean
  historyError: boolean
}

const IDLE: SolanaPortfolioState = { portfolio: null, loading: false, error: '', flows: [], historyLoading: false, historyLimited: false, historyError: false }

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
  const key = `${config?.rpcUrl ?? ''}:${config?.predictionProgram ?? ''}:${config?.manifestProgram ?? ''}:${owner ?? ''}:${marketIds.join(',')}`
  const [state, setState] = useState<{ key: string } & SolanaPortfolioState>({ key: '', ...IDLE })
  // The fill cache belongs to the reader, and rebuilding one per render would
  // throw away every receipt it has already paid for.
  const fillReader = useRef<{ key: string; reader: ManifestFillReader } | null>(null)

  useEffect(() => {
    if (!config || !owner) { setState({ key, ...IDLE }); return }
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    let client: ReturnType<typeof manifestClient>
    try {
      new PublicKey(owner)
      client = manifestClient(config.rpcUrl, config)
    } catch (reason) {
      setState({ key, ...IDLE, error: reason instanceof Error ? reason.message : 'This Solana venue is misconfigured.' })
      return
    }
    const reader = new ManifestPortfolioReader(client.adapter)
    const fills = fillReader.current?.key === `${config.rpcUrl}:${config.manifestProgram}` ? fillReader.current.reader : new ManifestFillReader(client.adapter.connection, config.manifestProgram)
    fillReader.current = { key: `${config.rpcUrl}:${config.manifestProgram}`, reader: fills }

    async function loadHistory(portfolio: ManifestPortfolio) {
      // Only books that exist can hold a fill, and an unopened question has none.
      const books = portfolio.questions.flatMap(question => question.opened
        ? ([0, 1] as const).filter(outcome => question.outcomes[outcome].opened).map(outcome => ({
          address: bookAddress(new PublicKey(config!.predictionProgram), new PublicKey(question.marketId), outcome).toBase58(),
          marketId: question.marketId, outcome,
        }))
        : [])
      if (!books.length) { if (active) setState(current => ({ ...current, historyLoading: false })); return }
      let history: ManifestHistory
      try { history = await fills.read(portfolio.owner, books, controller.signal) }
      catch { if (active) setState(current => ({ ...current, historyLoading: false, historyError: true })); return }
      if (!active) return
      setState(current => ({ ...current, flows: history.fills.map(fillCashFlow), historyLoading: false, historyLimited: history.limited, historyError: history.error }))
    }

    // Questions the trader still holds but that the live catalogue has dropped.
    // Discovery is a chain read, so it runs with the history pass rather than
    // on every poll; the ids it finds are then read like any other question.
    let extra: string[] = []
    const listed = new Set(marketIds)

    async function load(first: boolean) {
      try {
        if (first) {
          try { extra = (await reader.discover(owner!)).filter(id => !listed.has(id)) }
          catch { extra = [] }
        }
        const portfolio = await reader.read(owner!, [...new Set([...marketIds, ...extra])].sort(), extra)
        if (!active) return
        setState(current => ({ ...current, key, portfolio, loading: false, error: '', historyLoading: first ? true : current.historyLoading }))
        if (first) await loadHistory(portfolio)
      } catch (reason) {
        if (active) setState(current => ({ ...current, key, loading: false, historyLoading: false, error: reason instanceof Error ? reason.message : 'Solana positions are unavailable.' }))
      } finally {
        if (active) timer = setTimeout(() => void load(false), POLL_MS)
      }
    }
    setState(current => (current.key === key ? { ...current, loading: true } : { key, ...IDLE, loading: true }))
    void load(true)
    return () => { active = false; controller.abort(); clearTimeout(timer) }
  }, [key, retry])

  return state.key === key ? state : { ...IDLE, loading: Boolean(config && owner) }
}
