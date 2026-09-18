import { solanaClusterLabel } from '../../../packages/adapters/solana/cluster'
import { PublicKey } from '@solana/web3.js'
import { cachedQuestionMarketAddress } from '../solz/questionMarketPda'
import { parsePresentation, type Presentation } from '../../../packages/prediction-core/portfolio/model'
import { useEffect, useMemo, useState } from 'react'
import { predictionUrl } from '../../../packages/sdk/prediction-url'
import type { ArenaMarket, SolzMatch } from '../solz/model'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import type { SolanaBinding } from './venue/types'
import { useTokenMeta } from '../solz/tokenMeta'
import { resolvedTokenLogo } from '../solz/tokenIcon'

const MATCH_ID = /^0x[0-9a-f]{64}$/i
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const EMPTY_MATCHES: readonly SolzMatch[] = []

/** A catalogue written before `presentation` existed can still name a two-sided
 * token market by its two mint addresses. Treat that precise shape as a
 * head-to-head market so it joins the ordinary token-identity path below.
 *
 * This is intentionally stricter than a base58-looking regex: a generic
 * question must never become a team market merely because its answer text
 * happens to contain base58 characters. */
function mint(value: string): string | undefined {
  try {
    const parsed = new PublicKey(value.trim())
    return parsed.toBase58() === value.trim() ? parsed.toBase58() : undefined
  } catch { return undefined }
}

export function inferredHeadToHeadPresentation(question: Pick<ReservedSolanaQuestion, 'outcomes' | 'presentation'>): Presentation | undefined {
  const explicit = parsePresentation(question.presentation)
  if (explicit) return explicit.kind === 'head-to-head' ? explicit : undefined
  const teamIds = question.outcomes.map(mint)
  if (!teamIds[0] || !teamIds[1]) return undefined
  return {
    kind: 'head-to-head',
    eventTitle: teamIds.join(' vs '),
    outcomes: [
      { id: 0, label: teamIds[0], teamId: teamIds[0] },
      { id: 1, label: teamIds[1], teamId: teamIds[1] },
    ],
  }
}

/** Derives match-linked questions from the independently available game feed.
 * General questions deliberately do not appear here: their text and resolution
 * policy live in Postgres and cannot be reconstructed from a market PDA. */
export async function onchainFallbackQuestions(matches: readonly SolzMatch[]): Promise<ReservedSolanaQuestion[]> {
  const questions: ReservedSolanaQuestion[] = []
  for (const match of matches) {
    const matchId = match.id.startsWith('arena-') ? `0x${match.id.slice(6)}` : match.id
    if (!MATCH_ID.test(matchId)) continue
    const bytes = Uint8Array.from((matchId.slice(2).match(/../g) ?? []).map(byte => Number.parseInt(byte, 16)))
    if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'SOLZ' || bytes[4] !== 1) continue
    const kickoff = Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(8, false))
    if (!Number.isSafeInteger(kickoff)) continue
    const status = match.phase === 'settled' ? 'settled' as const : match.phase === 'live' ? 'live' as const : 'reserved' as const
    for (const member of match.roster) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`agent:${member.agentId}`)))
      questions.push({ eventId: match.id, matchId: matchId.toLowerCase(), questionId: `0x515545530101${hex(digest.slice(0, 26))}`,
        marketId: '', label: `Will ${member.codename || member.agentId.toUpperCase()} win?`, outcomes: ['YES', 'NO'],
        scheduledStartAt: new Date(kickoff * 1000).toISOString(), status, tradeable: status !== 'settled',
        presentation: { kind: 'linked', eventTitle: 'Who will win this match?', answer: { label: member.codename || member.agentId.toUpperCase(), participantId: member.agentId }, outcomes: [{ id: 0, label: 'Yes' }, { id: 1, label: 'No' }] },
      })
    }
  }
  return questions
}

export type ReservedSolanaQuestion = {
  presentation?: Presentation
  eventId: string
  matchId: string
  questionId: string
  marketId: string
  label: string
  outcomes: [string, string]
  scheduledStartAt: string
  status: 'planned' | 'reserved' | 'live' | 'settled' | 'cancelled'
  /** False for a question the catalogue publishes only so a position a trader
   *  still holds can be named. The market account on chain carries two 32-byte
   *  identities and no text, so a finished question has nowhere else to get its
   *  name, its outcome labels or its artwork from. Absent means tradeable: a
   *  backend that publishes open questions only never sets it. */
  tradeable?: boolean
}

/** Whether this entry is an offer to trade or a name for something finished.
 *  Every surface that can open or price a market reads this, never the status
 *  alone: a source can report a match as live for minutes after it ended. */
export const questionTradeable = (question: Pick<ReservedSolanaQuestion, 'tradeable'>) => question.tradeable !== false

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
      Number.isFinite(Date.parse(item.scheduledStartAt)) && ['planned', 'reserved', 'live', 'settled', 'cancelled'].includes(String(item.status))
  // The flag is normalised, not required, so a backend that publishes open
  // questions only keeps working: an explicit false withdraws one from trading.
  }).map(question => ({ ...question, tradeable: questionTradeable(question) }))
}

/**
 * The live catalogue plus every question this deployment ever published.
 *
 * /solana/questions lists only what a permit can still reach, so a question
 * disappears from it the moment its match locks. A trader keeps the shares. The
 * market account on chain carries two 32-byte identities and no text, so
 * without a second source a settled position renders as `Question 12Nc…nHGG`
 * with no name, no outcome labels and no artwork.
 *
 * That second source is the per-owner catalogue the prediction API persists and
 * returns as `questions` on /solana/portfolio/<owner>. It has no time window and
 * no entry cap, so a position is named for as long as it exists.
 *
 * Joined by MARKET ADDRESS, which is what a holding carries. A question id is
 * not an identity here: an arena question id is derived from the agent alone,
 * so one Genesis agent carries the same id in every round it ever plays. The
 * live entry always wins, and a stored entry that the live list no longer
 * carries is a name, never an offer to trade.
 */
export function mergeQuestionCatalogue(live: readonly ReservedSolanaQuestion[], stored: unknown): ReservedSolanaQuestion[] {
  const merged = new Map(live.map(question => [question.marketId, { ...question, tradeable: questionTradeable(question) }]))
  for (const question of parseReservedSolanaQuestions({ questions: Array.isArray(stored) ? stored : [] })) {
    if (!question.marketId || merged.has(question.marketId)) continue
    merged.set(question.marketId, { ...question, tradeable: false })
  }
  return [...merged.values()]
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
  const cancelled = question.status === 'cancelled'
  const settled = question.status === 'settled'
  // A stale upstream status must not leave a past match looking tradeable. This
  // applies to both live and never-flipped reserved records once their encoded
  // match window has ended; the authoritative result can arrive afterward. A
  // question the catalogue publishes for display only is finished by the same
  // rule, whatever its clock says: it exists here to be named, not traded.
  const finishedPending = !cancelled && !settled && (now >= closesAt || !questionTradeable(question))
  const finished = cancelled || settled || finishedPending
  const presentation = parsePresentation(question.presentation)
  const headToHead = presentation?.kind === 'head-to-head'
  const teams: SolzMatch['teams'] = headToHead ? presentation.outcomes.map((outcome, index) => ({
    teamId: outcome.teamId ?? `side-${index}`,
    symbol: outcome.label,
    name: outcome.label,
    ...((outcome.imageUrl) ? { logoUrl: outcome.imageUrl } : {}),
    color: outcome.color ?? (index === 0 ? '#3fdcff' : '#ff7a1a'),
    glyph: outcome.label.replace(/^\$/, '').slice(0, 3).toUpperCase(),
    score: 0,
    agentIds: [],
  })) : []
  const displayedOutcomes = presentation?.outcomes ?? ([{ id: 0, label: question.outcomes[0] }, { id: 1, label: question.outcomes[1] }] as const)
  // The identity colour has to travel on the outcome. These teams are synthetic
  // — they exist on this match only, never in the arena snapshot — so a
  // snapshot lookup can never resolve them.
  const identityColor = (item: (typeof displayedOutcomes)[number], index: number) =>
    'color' in item && typeof item.color === 'string' ? item.color : teams[index]?.color
  // The cluster the venue is actually bound to, not a literal. These two strings
  // are the badge and the chart's source label, so hardcoding 'DEVNET' made a
  // mainnet deployment announce itself as devnet on every question on the page.
  const cluster = solanaClusterLabel(venue?.chainId)
  // A linked answer's agent rides on the outcome, the way the arena feed's own
  // questions carry it. Both sides of a linked binary question are about the same
  // participant, so the options list and the ticket draw its portrait rather than
  // falling back to a generic mark.
  const linkedParticipant = presentation?.kind === 'linked' ? presentation.answer?.participantId : undefined
  return {
    match: {
      id: question.eventId, displayMatchId: `SOLANA ${cluster}`, kind: 'highlight', mode: headToHead ? 'HEAD-TO-HEAD' : 'PREDICTION', map: `MANIFEST ${cluster}`,
      // A reserved market has a real settlement cutoff, but it is not a
      // running match or a five-minute break. Treat its clock as open-ended
      // so a future scheduled start is never rendered as a multi-day timer.
      round: cancelled ? 'CANCELLED' : settled ? 'SETTLED' : finishedPending ? 'RESULT PENDING' : headToHead ? 'MONEYLINE' : question.status === 'live' ? 'LIVE LAZY MARKET' : 'MARKET RESERVED',
      phase: finished ? 'settled' : question.status === 'live' ? 'live' : 'countdown',
      startedAt: headToHead ? kickoff : question.status === 'live' ? kickoff : now,
      endsAt: closesAt, timingType: question.status === 'live' || headToHead ? 'countdown' : 'open-ended', timingEstimated: false,
      viewers: 0, marketId: question.marketId, volume: { SOL: 0, COOLA: 0 }, teams, roster: [],
    },
    market: {
      id: question.questionId, matchId: question.eventId, kind: 'match-winner', title: question.label,
      description: cancelled
        ? 'This eligible match was cancelled. Its event record remains visible and trading is closed.'
        : settled
          ? 'This eligible match has settled. Its event record and market history remain visible.'
          : finishedPending
            ? 'Match time has finished and the recorded result is pending. Trading is closed.'
            : 'Eligible off-chain prediction question. The first trader can open its Manifest market.',
      status: finished ? 'closed' : 'indicative', closesAt,
      volume: { SOL: 0, COOLA: 0 }, outcomes: displayedOutcomes.map((item, index) => ({ id: index === 0 ? 'yes' : 'no', label: item.label, detail: `Pays if ${item.label} is the recorded outcome.`, probability: .5, indicative: true, priceHistory: [], ...('teamId' in item && typeof item.teamId === 'string' ? { teamId: item.teamId } : {}), ...('imageUrl' in item && typeof item.imageUrl === 'string' ? { imageUrl: item.imageUrl } : {}), ...(identityColor(item, index) ? { color: identityColor(item, index) } : {}), ...(linkedParticipant ? { participantId: linkedParticipant } : {}) })),
      rules: finished
        ? 'Trading is closed. Resolution follows the authoritative match result.'
        : 'Indicative 50/50 display until the first trader creates the market and Manifest books. This is not an executable quote.',
      presentation,
      onchain: solanaBinding(question, venue) as ArenaMarket['onchain'],
    },
  }
}

/** Which markets a match trades, and whether they came from a canonical
 *  (matchId, questionId) source rather than the arena feed.
 *
 *  The arena feed wins when it has questions: its rows carry the recorded answers
 *  a settled question displays. The canonical catalogue supplies the same
 *  questions - same two IDs, same derived PDA - whenever it does not, which is
 *  what makes every eligible match tradable "as soon as its matchId exists"
 *  (MARKET_LIST_API.md:73) instead of only once an importer-backed feed has
 *  caught up with it. `canonical` then tells the venue pipeline not to blank
 *  those markets on an arena-feed flag describing a different source. */
export function resolveMatchMarkets(feed: readonly ArenaMarket[], catalogue: readonly ArenaMarket[]): { markets: ArenaMarket[]; canonical: boolean } {
  if (feed.length) return { markets: [...feed], canonical: false }
  return { markets: [...catalogue], canonical: catalogue.length > 0 }
}

/** One entry of the question catalogue: the synthetic match, its market, and
 *  the question it came from. */
export type ReservedSolanaView = { match: SolzMatch; market: ArenaMarket; question: ReservedSolanaQuestion }

/** Resolves /events/<id> against the question catalogue. Callers try the arena
 *  snapshot first, so a question never shadows a real match that shares its id. */
export function resolveQuestionEvent(views: readonly ReservedSolanaView[], eventId: string) {
  const normalized = eventId.toLowerCase()
  const view = views.find((item) => item.question.eventId.toLowerCase() === normalized
    || item.question.matchId.toLowerCase() === normalized
    || item.question.questionId.toLowerCase() === normalized)
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
  // An arena draft asks "Will COKE win?", so stripping only the question leaves
  // the verb behind ("COKE win"). The subject is what differs between linked
  // answers; the predicate is the shared tail whichever way it is phrased.
  const answer = (tail && withoutQuestion.toLowerCase().endsWith(tail.toLowerCase())
    ? withoutQuestion.slice(0, -tail.length).trim()
    : withoutQuestion.replace(/\s+finish\b.*$/i, '').trim()).replace(/\s+wins?$/i, '').trim()
  return answer || label
}

export function useReservedSolanaQuestions(apiUrl: string, venue?: PublicPredictionVenue | null, enabled = true, fallbackMatches: readonly SolzMatch[] = EMPTY_MATCHES) {
  const [questions, setQuestions] = useState<ReservedSolanaQuestion[]>([])
  const [fallbackQuestions, setFallbackQuestions] = useState<ReservedSolanaQuestion[]>([])
  // Distinguishes "no questions" from "not fetched yet": the event page must
  // not render EVENT NOT FOUND for a standalone question while it is in flight.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let active = true
    void onchainFallbackQuestions(fallbackMatches).then(value => { if (active) setFallbackQuestions(value) }).catch(() => { if (active) setFallbackQuestions([]) })
    return () => { active = false }
  }, [fallbackMatches])
  useEffect(() => {
    setQuestions([])
    setLoaded(false)
    if (!apiUrl || !enabled) { setLoaded(true); return }
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
  }, [apiUrl, enabled])
  const allQuestions = useMemo(() => {
    const program = venue?.programId ? new PublicKey(venue.programId) : undefined
    return [...new Map([...questions, ...fallbackQuestions].map(question => {
      const marketId = question.marketId || (program ? cachedQuestionMarketAddress(program, question.matchId, question.questionId) : question.questionId)
      return [`${question.matchId}:${question.questionId}`, { ...question, marketId }]
    })).values()]
  }, [questions, fallbackQuestions, venue?.programId])
  const identified = useQuestionIdentity(allQuestions)
  // The venue supplies the binding the shared venue hook needs to read this
  // question's Manifest books. Without it every Solana market renders as if no
  // market had been opened, however many trades have settled against it.
  const views = useMemo(
    () => identified.map(question => ({ ...reservedSolanaView(question, Date.now(), venue), question })),
    [identified, venue?.publicRpcUrl, venue?.programId, venue?.manifestProgramId, venue?.collateralToken],
  )
  return useMemo(() => ({ questions: views, loaded }), [views, loaded])
}

/** Adds canonical token artwork to any question collection, including the
 * all-status catalogue. History and unopened events must keep the same crests
 * as currently tradeable questions. */
export function useQuestionIdentity(questions: readonly ReservedSolanaQuestion[]) {
  const identityMints = useMemo(() => questions.flatMap((question) => {
    const presentation = inferredHeadToHeadPresentation(question)
    return presentation
      ? presentation.outcomes.flatMap((outcome) => outcome.teamId ? [outcome.teamId] : [])
      : []
  }), [questions])
  const tokenMeta = useTokenMeta(identityMints)
  return useMemo<ReservedSolanaQuestion[]>(() => questions.map((question) => {
    const presentation = inferredHeadToHeadPresentation(question)
    if (!presentation) return question
    let changed = false
    const outcomes = presentation.outcomes.map((outcome) => {
      const meta = outcome.teamId ? tokenMeta.get(outcome.teamId) : undefined
      if (!meta) return outcome
      const label = meta.symbol || outcome.label
      const imageUrl = resolvedTokenLogo(outcome.imageUrl, meta.icon) || undefined
      if (label === outcome.label && imageUrl === outcome.imageUrl) return outcome
      changed = true
      return { ...outcome, label, ...(imageUrl ? { imageUrl } : {}) }
    }) as typeof presentation.outcomes
    // Keep the inferred presentation even before the registry responds. It
    // preserves the mint identities for a later retry and gives the portfolio
    // a truthful head-to-head shape instead of treating it as YES/NO.
    if (!changed) return { ...question, presentation }
    const labels = outcomes.map((outcome) => outcome.label) as [string, string]
    const enrichedPresentation: Presentation = {
      kind: 'head-to-head', eventTitle: labels.join(' vs '), outcomes,
      ...(presentation.imageUrl ? { imageUrl: presentation.imageUrl } : {}),
    }
    return { ...question, label: labels.join(' vs '), outcomes: labels,
      presentation: enrichedPresentation }
  }), [questions, tokenMeta])
}
