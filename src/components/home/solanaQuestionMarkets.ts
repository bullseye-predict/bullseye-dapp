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
  // The question travels with the match: the trade ticket needs it to open the
  // market on-chain, not just to render a title.
  return { match: view.match, question: view.question, markets: views.filter((item) => item.match.id === view.match.id).map((item) => item.market) }
}

/** The canonical QUES v1 kind byte: 01 is a question about one arena match, 02
 *  is an independent proposition that settles on its own schedule. */
export function questionKind(questionId: string) {
  return questionId.slice(12, 14).toLowerCase()
}

/**
 * Questions that stand on their own, by protocol identity rather than by whether
 * their match happens to be in the current snapshot. Arena matches roll every
 * ~20 minutes, so a kind-01 question outlives its match in the catalogue for a
 * few minutes; keying off the snapshot listed those stale rows as standalone.
 */
export function standaloneQuestions(views: readonly ReservedSolanaView[], matches: readonly { id: string }[]) {
  return views.filter((item) => questionKind(item.question.questionId) === '02'
    && !matches.some((match) => match.id === item.question.eventId))
}

/** Groups a flat question list into the events the directory actually lists.
 *  Twelve questions sharing one eventId are one event with twelve markets, the
 *  same way an arena match owns its per-agent questions. */
export function questionEvents(views: readonly ReservedSolanaView[]) {
  const byEvent = new Map<string, ReservedSolanaView[]>()
  for (const view of views) {
    const list = byEvent.get(view.question.eventId)
    if (list) list.push(view)
    else byEvent.set(view.question.eventId, [view])
  }
  return [...byEvent.values()]
}

/** The shared tail of a set of linked question labels, which is the event they
 *  all ask about ("Will genesis-07 finish Season 01 with the most kills?" ->
 *  "Finish Season 01 with the most kills?"). Falls back to the first label when
 *  the questions share nothing substantial, rather than inventing a title. */
export function linkedQuestionTitle(labels: readonly string[]) {
  const [first, ...rest] = labels
  if (!first) return ''
  if (!rest.length) return first
  let shared = first
  for (const label of rest) {
    let size = 0
    while (size < shared.length && size < label.length
      && shared[shared.length - 1 - size] === label[label.length - 1 - size]) size++
    shared = shared.slice(shared.length - size)
  }
  // Start at a word boundary so the title never opens mid-word.
  const trimmed = shared.replace(/^[^ ]*\s+/, '').trim()
  if (trimmed.length < 12) return first
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
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
