import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Keypair } from '@solana/web3.js'
import { parsePantaCreateDraft } from '../packages/prediction-core/panta'
import { parsePantaEvent } from '../src/components/panta/pantaApi'
import { PantaEventView } from '../src/components/panta/PantaEventApp'
import { PantaCreateForm, prestocksTemplate } from '../src/components/panta/PantaCreateForm'

const id = Keypair.generate().publicKey.toBase58()
const market = { marketId: id, title: 'Will bitcoin hit $100,000 by 31 Dec 2026?', description: 'Resolves Yes if BTC trades at $100,000.', category: 'crypto', phase: 'secondary', startTime: 1_790_000_000, endTime: 1_798_671_600, resolutionTime: 1_798_675_200, volumeUsdc: '5321.00', yesPrice: '0.31', noPrice: '0.69', images: ['https://cdn.example.com/btc.png'], marketType: 'breaking' }
const tracked = { marketId: id, title: market.title, category: 'crypto', phase: 'secondary', endTime: market.endTime, imageUrl: null, groupId: null, groupTitle: null, source: 'imported', trackedSince: '2026-09-25T05:00:00.000Z', lastYes: '0.31', lastNo: '0.69', lastAt: '2026-09-25T05:00:00.000Z', creatorWallet: null }
const view = (over: Record<string, unknown> = {}) => parsePantaEvent({ kind: 'market', marketId: id, market, live: 'ok', tracked, history: [[1_790_000_000, '0.30', '0.70'], [1_790_003_600, '0.31', '0.69']], tradeUrl: `https://www.panta.market/dashboard/user/event/${id}`, ...over })

test('a PANTA page shows USDC prices in trading colours and sends trading to PANTA', () => {
  const html = renderToStaticMarkup(<PantaEventView id={id} state={{ phase: 'loaded', view: view() }}/>)
  expect(html).toContain('is-yes')
  expect(html).toContain('$0.310')
  expect(html).toContain('$0.690')
  expect(html).toContain('USDC per share')
  expect(html).toContain('Trade on PANTA')
  expect(html).toContain('rel="noopener noreferrer"')
  expect(html).toContain('Powered by PANTA')
  // Our own history, labelled as one price for every trader.
  expect(html).toContain('PANTA Yes price over time')
  expect(html).toContain('One price for everyone')
  expect(html).not.toContain('%')
})

test('an untracked market says there is no history rather than drawing an empty chart', () => {
  const html = renderToStaticMarkup(<PantaEventView id={id} state={{ phase: 'loaded', view: view({ tracked: null, history: [] }) }}/>)
  expect(html).toContain('not recording this market yet')
})

test('when PANTA is down the page falls back to the last snapshot and says so', () => {
  const html = renderToStaticMarkup(<PantaEventView id={id} state={{ phase: 'loaded', view: view({ market: null, live: 'unavailable' }) }}/>)
  expect(html).toContain('last recorded snapshot')
  expect(html).toContain('$0.310')
})

test('loading keeps the page shape, and a link off PANTA is refused', () => {
  const loading = renderToStaticMarkup(<PantaEventView id={id} state={{ phase: 'loading' }}/>)
  expect(loading).toContain('pe-skeleton')
  expect(loading).toContain('Loading PANTA market')
  expect(() => view({ tradeUrl: 'https://evil.example/steal' })).toThrow()
})

test('the create form states the real cost and chain before any wallet prompt', () => {
  const html = renderToStaticMarkup(<PantaCreateForm apiUrl="https://backend.test" onClose={() => {}}/>)
  expect(html).toContain('Solana mainnet')
  expect(html).toContain('50 for a standard market, 20 for a breaking one')
  expect(html).toContain('Connect a Solana wallet to create')
  expect(html).toContain('type="submit" disabled=""')
  expect(html).toContain('SPACEX')
})

test('a PreStocks template is a draft PANTA would accept', () => {
  const now = new Date('2026-09-25T06:00:00Z')
  const fields = prestocksTemplate('ANTHROPIC', now)
  const seconds = (local: string) => Math.floor(new Date(local).getTime() / 1000)
  const draft = parsePantaCreateDraft({
    question: fields.question, category: fields.category, marketType: fields.marketType,
    startTime: seconds(fields.startsAt), endTime: seconds(fields.endsAt), resolutionTime: seconds(fields.resolvesAt),
    resolutionRule: fields.resolutionRule, sourcesOfTruth: fields.sources.split('\n'), imageUrl: fields.imageUrl,
  }, Math.floor(now.getTime() / 1000))
  expect(draft.category).toBe('finance')
  expect(draft.sourcesOfTruth[0]).toContain('geckoterminal.com/solana/pools/EZyszDEx1LZDt7TsSFV8xdPi49sDKC3mdfv2MVMEQLtU')
})
