import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { marketProposalMessage, parseMarketProposal } from '../packages/prediction-core/market-proposals'
import { parsePantaMarket, parsePantaPage } from '../packages/prediction-core/panta'
import { createGeneralQuestionsApi } from '../src/components/markets/generalQuestionsApi'
import { PantaMarketCard, PantaMarkets } from '../src/components/markets/PantaMarkets'
import { MarketProposalForm } from '../src/components/markets/MarketProposalForm'
import { MarketDirectory } from '../src/components/markets/MarketsDirectoryApp'

const id = '11111111111111111111111111111111'
const row = { marketId: id, title: 'Will a crewed mission land on the Moon?', description: 'Official mission records.', category: 'science', phase: 'primary', startTime: 1_900_000_000, endTime: 1_900_086_400, resolutionTime: 1_900_090_000, volumeUsdc: '1200.25', yesPrice: '0.52', noPrice: '0.48' }
const now = 1_900_000_000_000
const draft = { question: 'Will a crewed mission land on the Moon?', category: 'science', closesAt: new Date(now + 86_400_000).toISOString(), resolutionRule: 'Resolves Yes if NASA confirms a crewed lunar landing before the deadline; otherwise No.', sourcesOfTruth: ['https://www.nasa.gov/'] }

test('PANTA list prices stay unavailable; detail retains per-share prices without normalizing to percentages', () => {
  expect(parsePantaPage({ items: [row], nextCursor: null }).items[0]).toMatchObject({ yesPrice: null, noPrice: null })
  expect(parsePantaMarket({ ...row, yesPrice: '1.24', noPrice: null })).toMatchObject({ yesPrice: '1.24', noPrice: null })
  expect(() => parsePantaPage({ items: [row], nextCursor: 'https://evil.test/' })).toThrow()
  expect(() => parsePantaMarket({ ...row, endTime: NaN })).toThrow()
  expect(() => parsePantaMarket({ ...row, phase: 'invented' })).toThrow()
})

test('proposal validation canonicalizes sources and enforces verifiable inputs and future closing time', () => {
  expect(parseMarketProposal({ ...draft, question: `  ${draft.question} `, sourcesOfTruth: ['https://www.nasa.gov', 'https://www.nasa.gov/'] }, now)).toEqual(draft)
  for (const sourcesOfTruth of [[], ['javascript:alert(1)'], ['http://www.nasa.gov'], ['https://user:secret@nasa.gov'], ['https://127.0.0.1']]) expect(() => parseMarketProposal({ ...draft, sourcesOfTruth }, now)).toThrow()
  expect(() => parseMarketProposal({ ...draft, closesAt: new Date(now + 3_599_000).toISOString() }, now)).toThrow()
  expect(() => parseMarketProposal({ ...draft, resolutionRule: 'Maybe.' }, now)).toThrow()
})

test('signed message binds the audience, wallet, exact proposal and request reference', () => {
  const submission = { id: crypto.randomUUID(), wallet: id, submittedAt: now, draft: parseMarketProposal(draft, now) }
  const original = marketProposalMessage('https://app.test', submission)
  expect(original).toContain('No transaction or payment is authorized.')
  expect(marketProposalMessage('https://other.test', submission)).not.toBe(original)
  expect(marketProposalMessage('https://app.test', { ...submission, draft: { ...submission.draft, question: 'Will another mission reach the Moon?' } })).not.toBe(original)
})

test('PANTA cards and skeletons use a separate source and never imply Manifest odds', () => {
  const api = createGeneralQuestionsApi('https://backend.test')
  const html = renderToStaticMarkup(<PantaMarketCard api={api} market={parsePantaMarket(row, false)}/>)
  expect(html).toContain('Will a crewed mission')
  expect(html).toContain('View prices &amp; details')
  expect(html).not.toContain('52%')
  expect(html).not.toContain('/events/')
  expect(html).not.toContain('Manifest')
  const loading = renderToStaticMarkup(<PantaMarkets apiUrl="https://backend.test"/>)
  expect(loading).toContain('aria-label="Loading PANTA markets"')
  expect(loading).toContain('gq-panta-grid')
  expect(loading).toContain('gq-panta-pending')
})

test('directory filters and sorts but never hosts the proposal form; disconnected users can prepare a draft', () => {
  const html = renderToStaticMarkup(<MarketDirectory snapshot={null} questions={[]} loaded error="" retry={() => {}}/>)
  expect(html).toContain('General questions')
  expect(html).toContain('Highest volume')
  expect(html).not.toContain('Propose a market')
  expect(html).not.toContain('Create on PANTA')
  const form = renderToStaticMarkup(<MarketProposalForm apiUrl="https://backend.test" standalone/>)
  expect(form).toContain('<h1')
  expect(form).toContain('Resolution rules')
  expect(form).toContain('Sources of truth')
  expect(form).toContain('Connect a Solana wallet to submit')
  expect(form).toContain('type="submit" disabled=""')
})

test('client preserves the configured API origin, abort signal and provider errors', async () => {
  let seen = ''
  const api = createGeneralQuestionsApi('https://backend.test', (async (input, init) => {
    seen = String(input)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return Response.json({ error: 'PANTA_NOT_CONFIGURED', message: 'PANTA markets are not connected yet.' }, { status: 503 }) as never
  }) as typeof fetch)
  await expect(api.markets(new URLSearchParams({ category: 'science' }), new AbortController().signal)).rejects.toMatchObject({ code: 'PANTA_NOT_CONFIGURED' })
  expect(seen).toBe('https://backend.test/panta/markets?category=science')
})
