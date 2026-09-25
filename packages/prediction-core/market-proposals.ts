import { PANTA_CATEGORIES, type PantaCategory } from './panta'

export type MarketProposalDraft = {
  question: string
  category: PantaCategory
  closesAt: string
  resolutionRule: string
  sourcesOfTruth: string[]
}
export type MarketProposalSubmission = {
  id: string
  wallet: string
  submittedAt: number
  draft: MarketProposalDraft
  signature: string
}
export type MarketProposalReceipt = {
  id: string
  question: string
  status: 'pending' | 'approved' | 'rejected'
  submittedAt: string
  reviewNote: string | null
  marketUrl: string | null
}
export const isProposalId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export function parseMarketProposal(value: unknown, now = Date.now()): MarketProposalDraft {
  const row = value as Record<string, unknown> | null
  const clean = (value: unknown, label: string, min: number, max: number) => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label} must be ${min}–${max} characters.`)
    return value.trim().replace(/\r\n?/g, '\n')
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Enter a market proposal.')
  const question = clean(row.question, 'Question', 12, 512)
  const resolutionRule = clean(row.resolutionRule, 'Resolution rules', 30, 2048)
  if (!PANTA_CATEGORIES.includes(row.category as PantaCategory)) throw new Error('Choose a category.')
  const close = typeof row.closesAt === 'string' ? Date.parse(row.closesAt) : NaN
  if (!Number.isFinite(close) || close <= now + 3_600_000 || close > now + 366 * 5 * 86_400_000) throw new Error('Choose a closing time at least one hour ahead and within five years.')
  if (!Array.isArray(row.sourcesOfTruth) || row.sourcesOfTruth.length < 1 || row.sourcesOfTruth.length > 5) throw new Error('Add between one and five public source URLs.')
  const sourcesOfTruth = [...new Set(row.sourcesOfTruth.map(value => {
    const source = clean(value, 'Source URL', 8, 2048)
    let url: URL
    try { url = new URL(source) } catch { throw new Error('Each source must be a public HTTPS URL.') }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) || url.hostname.endsWith('.local')) throw new Error('Each source must be a public HTTPS URL.')
    return url.toString()
  }))]
  return { question, category: row.category as PantaCategory, closesAt: new Date(close).toISOString(), resolutionRule, sourcesOfTruth }
}

/** A readable, domain-separated message. It cannot authorize a trade or spend. */
export function marketProposalMessage(audience: string, submission: Omit<MarketProposalSubmission, 'signature'>) {
  const { id, wallet, submittedAt, draft } = submission
  return [
    'COLACAT_MARKET_PROPOSAL_V1', `Service: ${audience}`, `Proposal: ${id}`, `Wallet: ${wallet}`,
    `Submitted: ${submittedAt}`, 'Submit this question for review. No transaction or payment is authorized.',
    JSON.stringify({ question: draft.question, category: draft.category, closesAt: draft.closesAt, resolutionRule: draft.resolutionRule, sourcesOfTruth: draft.sourcesOfTruth }),
  ].join('\n')
}
