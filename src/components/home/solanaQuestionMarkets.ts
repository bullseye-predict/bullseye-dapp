import { useEffect, useMemo, useState } from 'react'
import { predictionUrl } from '../../../packages/sdk/prediction-url'
import type { ArenaMarket, SolzMatch } from '../solz/model'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import type { SolanaBinding } from './venue/types'

export type ReservedSolanaQuestion = {
  eventId: string
  matchId: string
  questionId: string
  marketId: string
  label: string
  outcomes: [string, string]
  scheduledStartAt: string
  status: 'reserved' | 'live'
}

export function solanaQuestionLocksAt(question: Pick<ReservedSolanaQuestion, 'matchId'>) {
  const encoded = question.matchId.slice(2)
  const durationMinutes = Number.parseInt(encoded.slice(12, 16), 16)
  const kickoffSeconds = Number.parseInt(encoded.slice(16, 32), 16)
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 || !Number.isSafeInteger(kickoffSeconds))
    throw new Error('Invalid canonical Solana match timing.')
  return (kickoffSeconds + durationMinutes * 60) * 1_000
}

export function parseReservedSolanaQuestions(value: unknown): ReservedSolanaQuestion[] {
  const rows = value && typeof value === 'object' && Array.isArray((value as { questions?: unknown }).questions)
    ? (value as { questions: unknown[] }).questions
    : []
  return rows.filter((row): row is ReservedSolanaQuestion => {
    if (!row || typeof row !== 'object') return false
    const item = row as Record<string, unknown>
    return typeof item.eventId === 'string' && /^0x[0-9a-f]{64}$/i.test(String(item.matchId)) &&
      /^0x[0-9a-f]{64}$/i.test(String(item.questionId)) && typeof item.marketId === 'string' &&
      typeof item.label === 'string' && Array.isArray(item.outcomes) && item.outcomes.length === 2 &&
      item.outcomes.every(outcome => typeof outcome === 'string') && typeof item.scheduledStartAt === 'string' &&
      Number.isFinite(Date.parse(item.scheduledStartAt)) && (item.status === 'reserved' || item.status === 'live')
  })
}

/** Builds the venue binding for a Solana question so the shared venue hook can
 *  read its Manifest books. Without a venue the market renders as an unopened
 *  question, exactly as before. */
export function solanaBinding(question: ReservedSolanaQuestion, venue: PublicPredictionVenue | null | undefined): SolanaBinding | undefined {
  if (!venue?.programId || !venue.manifestProgramId || !venue.publicRpcUrl) return undefined
  return {
    family: 'SOLANA',
    marketId: question.marketId,
    tradingStartsAt: Date.parse(question.scheduledStartAt),
    tradingLocksAt: solanaQuestionLocksAt(question),
    rpcUrl: venue.publicRpcUrl,
    genesisHash: venue.chainId,
    predictionProgram: venue.programId,
    manifestProgram: venue.manifestProgramId,
    collateralMint: venue.collateralToken,
    collateralDecimals: venue.collateralDecimals,
    explorer: { family: 'SOLANA', chainId: venue.chainId, explorerUrl: venue.explorerUrl },
  }
}

export function reservedSolanaView(question: ReservedSolanaQuestion, now = Date.now(), venue?: PublicPredictionVenue | null): { match: SolzMatch; market: ArenaMarket } {
  const kickoff = Date.parse(question.scheduledStartAt)
  const closesAt = solanaQuestionLocksAt(question)
  return {
    match: {
      id: question.eventId, displayMatchId: 'SOLANA DEVNET', kind: 'highlight', mode: 'PREDICTION', map: 'MANIFEST DEVNET',
      // A reserved market has a real settlement cutoff, but it is not a
      // running match or a five-minute break. Treat its clock as open-ended
      // so a future scheduled start is never rendered as a multi-day timer.
      round: question.status === 'live' ? 'LIVE LAZY MARKET' : 'MARKET RESERVED', phase: question.status === 'live' ? 'live' : 'countdown', startedAt: question.status === 'live' ? kickoff : now, endsAt: closesAt, timingType: question.status === 'live' ? 'countdown' : 'open-ended', timingEstimated: false,
      viewers: 0, marketId: question.marketId, volume: { SOL: 0, COOLA: 0 }, teams: [], roster: [],
    },
    market: {
      id: question.questionId, matchId: question.eventId, kind: 'match-winner', title: question.label,
      description: 'Canonical Solana question reserved for first-trader activation on Manifest.', status: 'indicative', closesAt,
      volume: { SOL: 0, COOLA: 0 }, outcomes: question.outcomes.map((label, index) => ({ id: index === 0 ? 'yes' : 'no', label, detail: index === 0 ? 'Pays if the recorded answer is YES.' : 'Pays if the recorded answer is NO.', probability: .5, priceHistory: [] })),
      rules: 'Indicative 50/50 display until the first trader creates the market and Manifest books. This is not an executable quote.',
      onchain: solanaBinding(question, venue) as ArenaMarket['onchain'],
    },
  }
}

/** One entry of the question catalogue: the synthetic match, its market, and
 *  the question it came from. */
export type ReservedSolanaView = { match: SolzMatch; market: ArenaMarket; question: ReservedSolanaQuestion }

/** Resolves /events/<id> against the question catalogue. Callers try the arena
 *  snapshot first, so a question never shadows a real match that shares its id. */
export function resolveQuestionEvent(views: readonly ReservedSolanaView[], eventId: string) {
  const view = views.find((item) => item.question.eventId === eventId)
  if (!view) return undefined
  return { match: view.match, markets: views.filter((item) => item.match.id === view.match.id).map((item) => item.market) }
}

/** Questions with no arena match behind them. An arena-backed question already
 *  appears as its match, so listing it as standalone would duplicate it. */
export function standaloneQuestions(views: readonly ReservedSolanaView[], matches: readonly { id: string }[]) {
  return views.filter((item) => !matches.some((match) => match.id === item.question.eventId))
}

export function useReservedSolanaQuestions(apiUrl: string, venue?: PublicPredictionVenue | null) {
  const [questions, setQuestions] = useState<ReservedSolanaQuestion[]>([])
  // Distinguishes "no questions" from "not fetched yet": the event page must
  // not render EVENT NOT FOUND for a standalone question while it is in flight.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setQuestions([])
    setLoaded(false)
    if (!apiUrl) { setLoaded(true); return }
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        // Generous: a cold cross-region Neon can take seconds, and a timeout that
        // straddles the backend means the catalogue arrives only intermittently and
        // no market can carry a venue binding on the passes where it does not.
        const response = await fetch(predictionUrl('/solana/questions', apiUrl), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]), headers: { accept: 'application/json' } })
        const value = await response.json().catch(() => null)
        if (!response.ok) throw new Error('Solana question catalogue unavailable.')
        if (!controller.signal.aborted) setQuestions(parseReservedSolanaQuestions(value))
      } catch {
        // Preserve the last verified catalogue through a transient local-backend
        // outage. The next poll will replace it with the current match.
      } finally {
        if (!controller.signal.aborted) { setLoaded(true); timer = window.setTimeout(() => void load(), 10_000) }
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [apiUrl])
  // The venue supplies the binding the shared venue hook needs to read this
  // question's Manifest books. Without it every Solana market renders as if no
  // market had been opened, however many trades have settled against it.
  const views = useMemo(
    () => questions.map(question => ({ ...reservedSolanaView(question, Date.now(), venue), question })),
    [questions, venue?.publicRpcUrl, venue?.programId, venue?.manifestProgramId, venue?.collateralToken],
  )
  return useMemo(() => ({ questions: views, loaded }), [views, loaded])
}
