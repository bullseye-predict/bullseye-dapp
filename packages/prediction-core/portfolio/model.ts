/** Public portfolio contracts: prices and quantities use collateral atoms, never floats. */
export type Outcome = 0 | 1
export type PresentationOutcome = {
  id: Outcome
  label: string
  imageUrl?: string
  teamId?: string
  color?: string
}
export type Presentation = {
  kind: 'linked' | 'head-to-head' | 'general'
  /** Shared event prompt. Linked rows use this instead of repeating a full
   *  binary question for every candidate. */
  eventTitle?: string
  /** The candidate represented by one linked YES/NO market. */
  answer?: Omit<PresentationOutcome, 'id'> & { participantId?: string }
  outcomes: [PresentationOutcome & { id: 0 }, PresentationOutcome & { id: 1 }]
  imageUrl?: string
}
export function parsePresentation(value: unknown): Presentation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Presentation
  if (!['linked', 'head-to-head', 'general'].includes(v.kind) || !Array.isArray(v.outcomes) || v.outcomes.length !== 2 || !v.outcomes.every((o, i) => o?.id === i && typeof o.label === 'string' && o.label.trim().length > 0)) return undefined
  const image = (imageUrl: unknown) => typeof imageUrl === 'string' && /^(https:\/\/|\/[^/])/.test(imageUrl) ? imageUrl : undefined
  const outcomes = v.outcomes.map((outcome, id) => ({
    id: id as Outcome,
    label: outcome.label.trim(),
    ...(image(outcome.imageUrl) ? { imageUrl: image(outcome.imageUrl) } : {}),
    ...(typeof outcome.teamId === 'string' && outcome.teamId.trim() ? { teamId: outcome.teamId.trim() } : {}),
    ...(typeof outcome.color === 'string' && /^#[0-9a-f]{6}$/i.test(outcome.color) ? { color: outcome.color } : {}),
  })) as Presentation['outcomes']
  const answer = v.answer && typeof v.answer.label === 'string' && v.answer.label.trim() ? {
    label: v.answer.label.trim(),
    ...(image(v.answer.imageUrl) ? { imageUrl: image(v.answer.imageUrl) } : {}),
    ...(typeof v.answer.teamId === 'string' && v.answer.teamId.trim() ? { teamId: v.answer.teamId.trim() } : {}),
    ...(typeof v.answer.participantId === 'string' && v.answer.participantId.trim() ? { participantId: v.answer.participantId.trim() } : {}),
  } : undefined
  return {
    kind: v.kind,
    outcomes,
    ...(typeof v.eventTitle === 'string' && v.eventTitle.trim() ? { eventTitle: v.eventTitle.trim() } : {}),
    ...(answer ? { answer } : {}),
    ...(image(v.imageUrl) ? { imageUrl: image(v.imageUrl) } : {}),
  }
}
export type PortfolioEventKind = 'BUY' | 'SELL' | 'ORDER' | 'CANCEL' | 'SPLIT' | 'MERGE' | 'CLAIM' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'DEPOSIT' | 'WITHDRAW' | 'CUSTODY' | 'MARK' | 'SETTLEMENT'
export type PortfolioEvent = {
  id: string; signature: string; slot: number; transactionIndex: number; index: number; at: number
  owner: string; marketId?: string; outcome?: Outcome; kind: PortfolioEventKind
  shares?: string; collateral?: string; price?: string; fee?: string | null
  vaultChange?: string; orderId?: string; side?: 'BUY' | 'SELL'; detail?: string
  finality: 'confirmed' | 'finalized'
}
export type PositionAccounting = {
  marketId: string; outcome: Outcome; quantity: string; costBasis: string | null
  average: string | null; current: string | null; value: string | null; pnl: string | null
  acquisitionCost?: string | null; disposedCost?: string | null; historicalAverage?: string | null
  realized: string | null; acquired: string; disposed: string; proceeds: string
  complete: boolean; reason?: string
}
export type PnlPoint = { at: number; value: string | null }
export type PortfolioAccounting = { positions: PositionAccounting[]; points: PnlPoint[]; complete: boolean; reason?: string }
export type PortfolioCoverage = { complete: boolean; reason?: string; from: number | null; through: number; finality: 'finalized' }
export type PortfolioReadModel = {
  address: string; deployment: string; observedAt: number; coverage: PortfolioCoverage
  accounting: PortfolioAccounting; events: PortfolioEvent[]; nextCursor: string | null
}
export const positionKey = (market: string, outcome: Outcome) => `${market}:${outcome}`
