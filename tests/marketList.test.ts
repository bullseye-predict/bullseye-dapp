import { expect, test } from 'bun:test'
import { PublicKey } from '@solana/web3.js'
import { catalogueQuestions, eventCatalogueItems, parseMarketList, type CatalogueItem } from '../src/components/markets/marketList'
import { questionMarketAddress } from '../packages/adapters/solana/wire'
import type { PublicPredictionVenue } from '../packages/prediction-core/market-data'

const at = '2026-09-10T00:00:00Z'
const matchId = `0x534f4c5a01010014${Math.floor(Date.parse(at) / 1000).toString(16).padStart(16, '0')}00000000000000000000000000000001`
const questionId = `0x515545530101${'a'.repeat(52)}`
const program = '4RKCgJtgyxenZLaKe2zL4XaHUHLjGRqKZAokZFTbmRnJ'
const venue = { programId: program, manifestProgramId: program, publicRpcUrl: 'https://rpc.example', chainId: 'genesis', collateralToken: program, collateralDecimals: 6 } as unknown as PublicPredictionVenue
const item = (over: Partial<Record<string, unknown>> = {}) => ({
  kind: 'general', eventId: 'lazy-1', matchId, questionId, status: 'live', title: 'Who wins?',
  eventType: 'general', hasHumans: false, startsAt: at, tradeLocksAt: '2026-09-10T00:20:00Z',
  outcomes: [{ id: 'YES', label: 'Yes' }, { id: 'NO', label: 'No' }], ...over,
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

test('every catalogue status maps into a viewable event lifecycle', () => {
  const items = parseMarketList({ items: [
    item({ status: 'scheduled', eventId: 'a' }), item({ status: 'live', eventId: 'b' }), item({ status: 'open', eventId: 'c' }),
    item({ status: 'resolved', eventId: 'd' }), item({ status: 'cancelled', eventId: 'e' }),
  ] }).items
  expect(items).toHaveLength(5)
  const converted = catalogueQuestions(items, venue)
  expect(converted.map(q => [q.eventId, q.status])).toEqual([
    ['a', 'reserved'], ['b', 'live'], ['c', 'live'], ['d', 'settled'], ['e', 'cancelled'],
  ])
})

test('without a venue programId the off-chain event remains listed without a trading binding', () => {
  const items = parseMarketList({ items: [item()] }).items
  for (const unavailable of [null, { ...venue, programId: '' } as PublicPredictionVenue]) {
    const [question] = catalogueQuestions(items, unavailable)
    expect(question?.eventId).toBe('lazy-1')
    expect(question?.marketId).toBe(questionId)
  }
})

test('catalogue presentation survives parsing so match cards keep team identity', () => {
  const presentation = { kind: 'head-to-head', eventTitle: 'CLAW vs STONK', outcomes: [
    { id: 0, label: 'CLAW', teamId: 'MintClaw', imageUrl: 'https://images.example/claw.png' },
    { id: 1, label: 'STONK', teamId: 'MintStonk' },
  ] }
  const [question] = catalogueQuestions(parseMarketList({ items: [item({ presentation, outcomes: [
    { id: 'YES', label: 'CLAW' }, { id: 'NO', label: 'STONK' },
  ] })] }).items, venue)
  expect(question?.presentation).toEqual(presentation)
  expect(question?.outcomes).toEqual(['CLAW', 'STONK'])
})

test('catalogue event metadata survives parsing for filters, numbering and live priority', () => {
  const [parsed] = parseMarketList({ items: [item({
    eventType: 'genesis-ffa', matchNumber: 42, gameMode: 'deathmatch', teamFormat: 'ffa', hasHumans: true,
  })] }).items
  expect(parsed).toMatchObject({ eventType: 'genesis-ffa', matchNumber: 42, gameMode: 'deathmatch', teamFormat: 'ffa', hasHumans: true })
})

test('a scheduled start absent from the row falls back to the kickoff encoded in matchId', () => {
  const [withStart] = catalogueQuestions(parseMarketList({ items: [item()] }).items, venue)
  expect(withStart!.scheduledStartAt).toBe(at)
  const bare = { ...item() } as Record<string, unknown>
  delete bare.startsAt
  const [derived] = catalogueQuestions(parseMarketList({ items: [bare] }).items as CatalogueItem[], venue)
  expect(Date.parse(derived!.scheduledStartAt)).toBe(Date.parse(at))
})

const otherMatch = `0x534f4c5a01010014${Math.floor(Date.parse(at) / 1000).toString(16).padStart(16, '0')}00000000000000000000000000000002`
const question = (suffix: string) => `0x515545530101${suffix.repeat(52).slice(0, 52)}`

test('one event is narrowed out of the whole inventory by any of its three ids', () => {
  // The event page reads the all-status catalogue - thousands of rows - to
  // render one event. Everything downstream costs per row, so the narrowing has
  // to happen before it, and it has to accept whatever id the URL carries.
  const { items } = parseMarketList({ items: [
    item({ eventId: 'event-a', questionId: question('a') }),
    item({ eventId: 'event-a', questionId: question('b') }),
    item({ eventId: 'event-b', matchId: otherMatch, questionId: question('c') }),
  ] })
  for (const id of ['event-a', 'EVENT-A', matchId, matchId.toUpperCase(), question('b')]) {
    // Twelve linked questions share one eventId and are one event with twelve
    // markets, so matching a single question must still return its siblings.
    expect(eventCatalogueItems(items, id).map((row) => row.questionId)).toEqual([question('a'), question('b')])
  }
  expect(eventCatalogueItems(items, question('c')).map((row) => row.eventId)).toEqual(['event-b'])
})

test('an id the catalogue does not carry yields nothing, never the whole inventory', () => {
  // Falling back to every row is what the narrowing exists to prevent, and the
  // arena snapshot and /solana/questions resolve the page without these rows.
  const { items } = parseMarketList({ items: [item()] })
  for (const id of ['', '   ', 'no-such-event', question('f')]) expect(eventCatalogueItems(items, id)).toEqual([])
})

test('a repeated derivation of the same market address returns the same answer', () => {
  // findProgramAddress is a sha256 loop; the catalogue re-derives the same
  // (program, match, question) triple on every poll and the cache is what stops
  // that being seconds of blocked main thread. Correctness of the cached value
  // is the thing worth pinning.
  const { items } = parseMarketList({ items: [item()] })
  const expected = questionMarketAddress(new PublicKey(program), hexBytes(matchId), hexBytes(questionId)).toBase58()
  for (let pass = 0; pass < 3; pass += 1) expect(catalogueQuestions(items, venue)[0]!.marketId).toBe(expected)
})

function hexBytes(value: string) {
  return Uint8Array.from((value.slice(2).match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)))
}
