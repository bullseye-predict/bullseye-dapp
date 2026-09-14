import { parsePresentation, type Presentation } from '../../../packages/prediction-core/portfolio/model'
import { useEffect, useMemo, useState } from 'react'
import { predictionUrl } from '../../../packages/sdk/prediction-url'
import type { ArenaMarket, SolzMatch } from '../solz/model'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import type { SolanaBinding } from './venue/types'

export type ReservedSolanaQuestion = {
  presentation?: Presentation
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
  const presentation = parsePresentation(question.presentation)
  const headToHead = presentation?.kind === 'head-to-head'
  const teams: SolzMatch['teams'] = headToHead ? presentation.outcomes.map((outcome, index) => ({
    teamId: outcome.teamId ?? `side-${index}`,
    symbol: outcome.label,
    name: outcome.label,
    color: outcome.color ?? (index === 0 ? '#3fdcff' : '#ff7a1a'),
    glyph: outcome.label.replace(/^\$/, '').slice(0, 3).toUpperCase(),
    score: 0,
    agentIds: [],
  })) : []
  const displayedOutcomes = presentation?.outcomes ?? ([{ id: 0, label: question.outcomes[0] }, { id: 1, label: question.outcomes[1] }] as const)
  return {
    match: {
      id: question.eventId, displayMatchId: 'SOLANA DEVNET', kind: 'highlight', mode: headToHead ? 'HEAD-TO-HEAD' : 'PREDICTION', map: 'MANIFEST DEVNET',
      // A reserved market has a real settlement cutoff, but it is not a
      // running match or a five-minute break. Treat its clock as open-ended
      // so a future scheduled start is never rendered as a multi-day timer.
      round: headToHead ? 'MONEYLINE' : question.status === 'live' ? 'LIVE LAZY MARKET' : 'MARKET RESERVED', phase: question.status === 'live' ? 'live' : 'countdown', startedAt: headToHead ? kickoff : question.status === 'live' ? kickoff : now, endsAt: closesAt, timingType: question.status === 'live' || headToHead ? 'countdown' : 'open-ended', timingEstimated: false,
      viewers: 0, marketId: question.marketId, volume: { SOL: 0, COOLA: 0 }, teams, roster: [],
    },
    market: {
      id: question.questionId, matchId: question.eventId, kind: 'match-winner', title: question.label,
      description: 'Canonical Solana question reserved for first-trader activation on Manifest.', status: 'indicative', closesAt,
      volume: { SOL: 0, COOLA: 0 }, outcomes: displayedOutcomes.map((item, index) => ({ id: index === 0 ? 'yes' : 'no', label: item.label, detail: `Pays if ${item.label} is the recorded outcome.`, probability: .5, indicative: true, priceHistory: [], ...('teamId' in item && typeof item.teamId === 'string' ? { teamId: item.teamId } : {}) })),
      rules: 'Indicative 50/50 display until the first trader creates the market and Manifest books. This is not an executable quote.',
      presentation,
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
  const linked = views.filter((item) => item.match.id === view.match.id)
  const inferredTitle = linkedQuestionTitle(linked.map((item) => item.question.label))
  const markets = linked.map((item) => {
    if (item.market.presentation || linked.length < 2) return item.market
    const answer = linkedAnswerLabel(item.question.label, inferredTitle)
    const agent = /^GENESIS-(\d{2})$/i.exec(answer)
    const presentation: Presentation = { kind: 'linked', eventTitle: inferredTitle, answer: { label: answer, ...(agent ? { participantId: `genesis-${agent[1]}` } : {}) }, outcomes: [{ id: 0, label: 'Yes' }, { id: 1, label: 'No' }] }
    return { ...item.market, title: inferredTitle, presentation }
  })
  return { match: view.match, question: view.question, questions: linked.map((item) => item.question), markets }
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
 *  "Which Genesis agent will finish Season 01 with the most kills?"). Falls back to the first label when
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
  const subject = labels.every((label) => /^Will\s+genesis-\d{2}\b/i.test(label)) ? 'Which Genesis agent will ' : ''
  return subject + (subject ? trimmed.charAt(0).toLowerCase() : trimmed.charAt(0).toUpperCase()) + trimmed.slice(1)
}

/** The answer is the part that varies between linked binary questions. Explicit
 *  presentation metadata wins; this parser only keeps old catalogues readable. */
export function linkedAnswerLabel(label: string, eventTitle: string) {
  const withoutQuestion = label.replace(/^Will\s+/i, '').replace(/[?]\s*$/, '').trim()
  const tail = eventTitle.replace(/[?]\s*$/, '').replace(/^Will\s+/i, '').trim()
  const answer = tail && withoutQuestion.toLowerCase().endsWith(tail.toLowerCase())
    ? withoutQuestion.slice(0, -tail.length).trim()
    : withoutQuestion.replace(/\s+finish\b.*$/i, '').trim()
  return answer || label
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
