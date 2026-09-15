import { expect, test } from 'bun:test'
import { PublicKey } from '@solana/web3.js'
import { catalogueQuestions, parseMarketList, type CatalogueItem } from '../src/components/markets/marketList'
import { questionMarketAddress } from '../packages/adapters/solana/wire'
import type { PublicPredictionVenue } from '../packages/prediction-core/market-data'

const at = '2026-09-10T00:00:00Z'
const matchId = `0x534f4c5a01010014${Math.floor(Date.parse(at) / 1000).toString(16).padStart(16, '0')}00000000000000000000000000000001`
const questionId = `0x515545530101${'a'.repeat(52)}`
const program = '4RKCgJtgyxenZLaKe2zL4XaHUHLjGRqKZAokZFTbmRnJ'
const venue = { programId: program, manifestProgramId: program, publicRpcUrl: 'https://rpc.example', chainId: 'genesis', collateralToken: program, collateralDecimals: 6 } as unknown as PublicPredictionVenue
const item = (over: Partial<Record<string, unknown>> = {}) => ({
  kind: 'general', eventId: 'lazy-1', matchId, questionId, status: 'live', title: 'Who wins?',
  startsAt: at, tradeLocksAt: '2026-09-10T00:20:00Z', outcomes: [{ id: 'YES', label: 'Yes' }, { id: 'NO', label: 'No' }], ...over,
})

test('the envelope is read, and a row that cannot seed a PDA is dropped rather than trusted', () => {
  const parsed = parseMarketList({
    items: [
      item(),
      item({ matchId: '0xdeadbeef' }),
      item({ questionId: 'not-hex' }),
      item({ kind: 'wager' }),
      item({ status: 'pending' }),
      item({ outcomes: [{ id: 'YES', label: 'Yes' }] }),
      item({ tradeLocksAt: 'whenever' }),
      'nonsense',
    ],
    nextCursor: 'page-2',
    asOf: at,
  })
  expect(parsed.items).toHaveLength(1)
  expect(parsed.nextCursor).toBe('page-2')
  expect(parsed.asOf).toBe(Date.parse(at))
})

test('an absent envelope degrades to empty rather than throwing', () => {
  for (const value of [null, undefined, {}, { items: 'no' }, 42]) expect(parseMarketList(value).items).toEqual([])
  expect(parseMarketList({ items: [], nextCursor: '' }).nextCursor).toBeNull()
})

test('the market address is derived from the two canonical ids, never read off the wire', () => {
  // MARKET_LIST_API.md:120 - a catalogue row must not be able to redirect a client
  // to an arbitrary market. Feed a hostile address and prove it is not used.
  const hostile = parseMarketList({ items: [{ ...item(), marketId: '11111111111111111111111111111111' }] })
  const [question] = catalogueQuestions(hostile.items, venue)
  const expected = questionMarketAddress(new PublicKey(program), Uint8Array.from(Buffer.from(matchId.slice(2), 'hex')), Uint8Array.from(Buffer.from(questionId.slice(2), 'hex'))).toBase58()
  expect(question!.marketId).toBe(expected)
  expect(question!.marketId).not.toBe('11111111111111111111111111111111')
  expect(Object.keys(hostile.items[0]!)).not.toContain('marketId')
})

test('status maps into the pipeline vocabulary, and an untradable item is not converted', () => {
  const items = parseMarketList({ items: [
    item({ status: 'scheduled', eventId: 'a' }), item({ status: 'live', eventId: 'b' }), item({ status: 'open', eventId: 'c' }),
    item({ status: 'resolved', eventId: 'd' }), item({ status: 'cancelled', eventId: 'e' }),
  ] }).items
  expect(items).toHaveLength(5)
  const converted = catalogueQuestions(items, venue)
  expect(converted.map(q => [q.eventId, q.status])).toEqual([['a', 'reserved'], ['b', 'live'], ['c', 'live']])
})

test('without a venue programId nothing can be derived, so nothing is offered', () => {
  const items = parseMarketList({ items: [item()] }).items
  expect(catalogueQuestions(items, null)).toEqual([])
  expect(catalogueQuestions(items, { ...venue, programId: '' } as PublicPredictionVenue)).toEqual([])
})

test('a scheduled start absent from the row falls back to the kickoff encoded in matchId', () => {
  const [withStart] = catalogueQuestions(parseMarketList({ items: [item()] }).items, venue)
  expect(withStart!.scheduledStartAt).toBe(at)
  const bare = { ...item() } as Record<string, unknown>
  delete bare.startsAt
  const [derived] = catalogueQuestions(parseMarketList({ items: [bare] }).items as CatalogueItem[], venue)
  expect(Date.parse(derived!.scheduledStartAt)).toBe(Date.parse(at))
})
