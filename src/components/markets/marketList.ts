import { PublicKey } from '@solana/web3.js'
import { questionMarketAddress } from '../../../packages/adapters/solana/wire'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { parsePresentation, type Presentation } from '../../../packages/prediction-core/portfolio/model'
import type { ReservedSolanaQuestion } from '../home/solanaQuestionMarkets'

/** The catalogue read defined by docs/MARKET_LIST_API.md.
 *
 *  Note what this type does NOT carry: a market address. The endpoint is a
 *  catalogue of eligible items, and "a Neon row cannot redirect a client to an
 *  arbitrary on-chain market address" (MARKET_LIST_API.md:120). The client derives
 *  the PDA from (predictionProgramId, matchId, questionId) itself, so a compromised
 *  or mistaken catalogue can withhold an item but never point trading at another
 *  market. Dropping the field at the parser is what makes that structural.
 */
export type CatalogueItem = {
  kind: 'match' | 'general'
  eventId: string
  matchId: string
  questionId: string
  status: 'scheduled' | 'live' | 'open' | 'resolved' | 'cancelled'
  title: string
  eventType: 'genesis-ffa' | 'miaw-prix' | 'match' | 'general'
  matchNumber?: number
  gameMode?: string
  teamFormat?: string
  hasHumans: boolean
  startsAt?: string
  tradeLocksAt: string
  outcomes: { id: string; label: string }[]
  presentation?: Presentation
}

const ID = /^0x[0-9a-f]{64}$/i
const STATUS = ['scheduled', 'live', 'open', 'resolved', 'cancelled']
const EVENT_TYPE = ['genesis-ffa', 'miaw-prix', 'match', 'general']
// No Buffer: this runs in the browser, and the PDA seeds must not depend on a shim.
const hexBytes = (value: string) => Uint8Array.from((value.slice(2).match(/../g) ?? []).map(byte => Number.parseInt(byte, 16)))

function catalogueItem(row: unknown): CatalogueItem | null {
  if (!row || typeof row !== 'object') return null
  const item = row as Record<string, unknown>
  const outcomes = Array.isArray(item.outcomes) ? item.outcomes.filter((outcome): outcome is { id: string; label: string } =>
    !!outcome && typeof outcome === 'object' && typeof (outcome as { id?: unknown }).id === 'string' && typeof (outcome as { label?: unknown }).label === 'string') : []
  // Both ids become PDA seeds, so a row that cannot seed one is not an item.
  if (!ID.test(String(item.matchId)) || !ID.test(String(item.questionId))) return null
  if (typeof item.eventId !== 'string' || typeof item.title !== 'string') return null
  if (!STATUS.includes(String(item.status)) || (item.kind !== 'match' && item.kind !== 'general')) return null
  if (!EVENT_TYPE.includes(String(item.eventType))) return null
  if (outcomes.length !== 2 || typeof item.tradeLocksAt !== 'string' || !Number.isFinite(Date.parse(item.tradeLocksAt))) return null
  const startsAt = typeof item.startsAt === 'string' && Number.isFinite(Date.parse(item.startsAt)) ? item.startsAt : undefined
  const presentation = parsePresentation(item.presentation)
  const matchNumber = Number(item.matchNumber)
  return {
    kind: item.kind, eventId: item.eventId, matchId: String(item.matchId).toLowerCase(), questionId: String(item.questionId).toLowerCase(),
    status: item.status as CatalogueItem['status'], title: item.title, ...(startsAt ? { startsAt } : {}),
    eventType: item.eventType as CatalogueItem['eventType'], hasHumans: item.hasHumans === true,
    ...(Number.isSafeInteger(matchNumber) && matchNumber > 0 ? { matchNumber } : {}),
    ...(typeof item.gameMode === 'string' && item.gameMode ? { gameMode: item.gameMode } : {}),
    ...(typeof item.teamFormat === 'string' && item.teamFormat ? { teamFormat: item.teamFormat } : {}),
    tradeLocksAt: item.tradeLocksAt, outcomes: [outcomes[0]!, outcomes[1]!], ...(presentation ? { presentation } : {}),
  }
}

export function parseMarketList(value: unknown): { items: CatalogueItem[]; nextCursor: string | null; asOf: number } {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const rows = Array.isArray(body.items) ? body.items : []
  const asOf = typeof body.asOf === 'string' ? Date.parse(body.asOf) : Number.NaN
  return {
    items: rows.map(catalogueItem).filter((item): item is CatalogueItem => !!item),
    nextCursor: typeof body.nextCursor === 'string' && body.nextCursor ? body.nextCursor : null,
    asOf: Number.isFinite(asOf) ? asOf : Date.now(),
  }
}

/** Catalogue items in the shape the event pipeline consumes. Match existence
 *  is off-chain catalogue state, so resolved/cancelled rows remain viewable;
 *  only the optional venue binding depends on a configured program. */
export function catalogueQuestions(items: readonly CatalogueItem[], venue: PublicPredictionVenue | null | undefined): ReservedSolanaQuestion[] {
  const program = venue?.programId ? new PublicKey(venue.programId) : null
  const questions: ReservedSolanaQuestion[] = []
  for (const item of items) {
    const status = item.status === 'scheduled' ? 'reserved' as const
      : item.status === 'resolved' ? 'settled' as const
        : item.status === 'cancelled' ? 'cancelled' as const
          : 'live' as const
    questions.push({
      eventId: item.eventId, matchId: item.matchId, questionId: item.questionId,
      // A catalogue entry exists before its on-chain PDA does. The question ID
      // is a safe local key until venue configuration is available; no trading
      // code sees it because solanaBinding() stays absent without the program.
      marketId: program
        ? questionMarketAddress(program, hexBytes(item.matchId), hexBytes(item.questionId)).toBase58()
        : item.questionId,
      // IDs remain the binary contract keys; labels are what the event and trade
      // surfaces show. A head-to-head moneyline carries CLAW/STONK here, while a
      // generic binary question naturally carries Yes/No.
      label: item.title, outcomes: [item.outcomes[0]!.label, item.outcomes[1]!.label],
      // Timing rides matchId, which encodes kickoff; startsAt is the same instant
      // and is only present for items the source scheduled.
      scheduledStartAt: item.startsAt ?? new Date(Number.parseInt(item.matchId.slice(18, 34), 16) * 1000).toISOString(),
      status, ...(item.presentation ? { presentation: item.presentation } : {}),
    })
  }
  return questions
}
