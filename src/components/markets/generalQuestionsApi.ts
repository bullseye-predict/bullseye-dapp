import { predictionUrl } from '../../../packages/sdk/prediction-url'
import { parsePantaMarket, parsePantaPage } from '../../../packages/prediction-core/panta'
import { isProposalId, type MarketProposalReceipt, type MarketProposalSubmission } from '../../../packages/prediction-core/market-proposals'

export class GeneralQuestionsError extends Error {
  constructor(message: string, public readonly code: string) { super(message) }
}

export function createGeneralQuestionsApi(apiUrl: string, fetcher: typeof fetch = fetch) {
  async function request(path: string, signal?: AbortSignal, body?: unknown) {
    const response = await fetcher(predictionUrl(path, apiUrl), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    })
    const value = await response.json().catch(() => null)
    if (!response.ok) throw new GeneralQuestionsError(value?.message ?? 'This service is temporarily unavailable. Try again.', value?.error ?? 'UNAVAILABLE')
    return value
  }
  const readReceipt = (value: unknown): MarketProposalReceipt => {
    const row = value as MarketProposalReceipt | null
    if (!row || !isProposalId(row.id) || typeof row.question !== 'string' || !['pending', 'approved', 'rejected'].includes(row.status)
      || !Number.isFinite(Date.parse(row.submittedAt))) throw Error('The proposal receipt could not be verified. Keep your reference and check its status.')
    let marketUrl: string | null = null
    if (typeof row.marketUrl === 'string') {
      const url = new URL(row.marketUrl)
      if (url.protocol === 'https:' && url.hostname === 'www.panta.market' && !url.username && !url.password && /^\/dashboard\/user\/event\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.pathname)) marketUrl = url.toString()
    }
    return { id: row.id, question: row.question, status: row.status, submittedAt: row.submittedAt, reviewNote: typeof row.reviewNote === 'string' ? row.reviewNote : null, marketUrl }
  }
  return {
    async markets(query: URLSearchParams, signal: AbortSignal) { return parsePantaPage(await request(`/panta/markets?${query}`, signal)) },
    async market(id: string, signal: AbortSignal) { return parsePantaMarket(await request(`/panta/markets/${encodeURIComponent(id)}`, signal)) },
    async proposalConfig(signal?: AbortSignal): Promise<{ audience: string; available: boolean }> {
      const value = await request('/market/proposals/config', signal)
      if (!value || typeof value.audience !== 'string' || typeof value.available !== 'boolean') throw Error('Market proposals are temporarily unavailable.')
      return value
    },
    async propose(submission: MarketProposalSubmission, signal?: AbortSignal) { return readReceipt(await request('/market/proposals', signal, submission)) },
    async receipt(id: string, signal?: AbortSignal) { return readReceipt(await request(`/market/proposals/${encodeURIComponent(id)}`, signal)) },
  }
}
export type GeneralQuestionsApi = ReturnType<typeof createGeneralQuestionsApi>
