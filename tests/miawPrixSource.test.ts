import { expect, test } from 'bun:test'
import {
  miawPrixSource,
  moment,
  parseMiawPrixBoard,
  parseMiawPrixMarkets,
  parseMiawPrixSeason,
  standingMarketCapUsd,
} from '../src/components/miawprix/miawPrixSource'

const season = { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1_000, endsAt: 2_000, status: 'live' }

const payload = {
  ok: true,
  season,
  seasons: [season, { seasonId: 'solz-01', seasonIndex: 1, startsAt: 2_000, endsAt: 3_000, status: 'upcoming' }],
  standings: [
    { mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', logoUrl: 'https://cdn.test/a.png', color: '#c7ff00', wins: 7, losses: 4, matches: 11 },
    { mint: 'MintB', symbol: '$BETA', name: 'Beta', wins: 6, losses: 0, matches: 6 },
  ],
  matches: [{
    matchId: '0xMATCH1', displayMatchId: 'MP-014', scheduledStartAt: 5_000, status: 'settled',
    definitionId: 'colosseum_grab_bottle_3v3', title: 'Grab the bottle',
    cycleIndex: 2, cycleMatchIndex: 8, cycleMatchCount: 30,
    sides: [
      { teamId: 'team-a', mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', color: '#c7ff00' },
      { teamId: 'team-b', mint: 'MintB', symbol: '$BETA', name: 'Beta' },
    ],
    result: { winnerTeamId: 'team-b', winnerMint: 'MintB' },
    rewardPoolL: 4200,
  }],
}

test('the programme payload parses into one clock type and coin identity', () => {
  const board = parseMiawPrixBoard(payload)
  expect(board.season).toEqual({ seasonId: 'solz-00', seasonIndex: 0, startsAt: 1_000, endsAt: 2_000, status: 'live' })
  expect(board.seasons).toHaveLength(2)
  expect(board.standings[0]).toMatchObject({ symbol: '$ALPHA', wins: 7, losses: 4, matches: 11 })
  expect(board.matches[0]!.sides.map((side) => side.symbol)).toEqual(['$ALPHA', '$BETA'])
  expect(board.matches[0]!.result).toEqual({ winnerTeamId: 'team-b', winnerMint: 'MintB' })
  expect(board.matches[0]!.rewardPoolL).toBe(4200)
  expect(board.matches[0]).toMatchObject({ cycleIndex: 2, cycleMatchIndex: 8, cycleMatchCount: 30 })
})

test('season 00 is a real season, and a season with no index is not silently numbered zero', () => {
  expect(parseMiawPrixSeason({ ...season, seasonIndex: 0 })!.seasonIndex).toBe(0)
  expect(parseMiawPrixSeason({ seasonId: 'solz-legacy', status: 'closed' })!.seasonIndex).toBe(-1)
  expect(parseMiawPrixSeason({ seasonId: '' })).toBeNull()
})

test('a payload with no season number falls back to the number inside its id', () => {
  // The id is `<game_key>-<index>` by contract, so an older row that omits
  // seasonIndex is still a numbered season and must not be labelled by its key.
  expect(parseMiawPrixSeason({ seasonId: 'solz-07', status: 'closed' })!.seasonIndex).toBe(7)
  expect(parseMiawPrixSeason({ seasonId: 'solz-00', status: 'live' })!.seasonIndex).toBe(0)
  // An id that encodes nothing stays unnumbered rather than guessing zero.
  expect(parseMiawPrixSeason({ seasonId: 'solz-legacy', status: 'closed' })!.seasonIndex).toBe(-1)
})

test('an unknown season status is read as upcoming rather than thrown away', () => {
  expect(parseMiawPrixSeason({ ...season, status: 'paused' })!.status).toBe('upcoming')
})

test('ISO strings and epoch milliseconds both resolve to epoch milliseconds', () => {
  expect(moment('2026-09-20T12:00:00.000Z')).toBe(Date.parse('2026-09-20T12:00:00.000Z'))
  expect(moment(1_700_000_000_000)).toBe(1_700_000_000_000)
  expect(moment('not a date')).toBe(0)
  expect(moment(undefined)).toBe(0)
  const board = parseMiawPrixBoard({
    ...payload,
    matches: [{ ...payload.matches[0], scheduledStartAt: '2026-09-20T12:00:00.000Z' }],
  })
  expect(board.matches[0]!.scheduledStartAt).toBe(Date.parse('2026-09-20T12:00:00.000Z'))
})

test('a match with no canonical id is dropped, because nothing can ever be joined to it', () => {
  const board = parseMiawPrixBoard({ ...payload, matches: [{ ...payload.matches[0], matchId: '' }] })
  expect(board.matches).toHaveLength(0)
})

test('an unbound pairing keeps its empty sides instead of being filled in', () => {
  const board = parseMiawPrixBoard({
    ...payload,
    matches: [{ ...payload.matches[0], status: 'scheduled', sides: [], result: null, rewardPoolL: null }],
  })
  expect(board.matches[0]!.sides).toEqual([])
  expect(board.matches[0]!.result).toBeNull()
  // A missing reward pool is unknown, not zero.
  expect(board.matches[0]!.rewardPoolL).toBeNull()
})

test('a result naming nobody is no result at all', () => {
  const board = parseMiawPrixBoard({
    ...payload,
    matches: [{ ...payload.matches[0], result: { winnerTeamId: '', winnerMint: '' } }],
  })
  expect(board.matches[0]!.result).toBeNull()
})

test('a failed programme read is surfaced, never rendered as an empty season', () => {
  expect(() => parseMiawPrixBoard({ ok: false })).toThrow()
  expect(() => parseMiawPrixBoard(null)).toThrow()
})

test('the catalogue reports whether a market exists separately from what it traded', () => {
  const markets = parseMiawPrixMarkets({
    items: [
      { kind: 'match', matchId: '0xMATCH1', questionId: 'q1' },
      { kind: 'match', matchId: '0xMATCH2', questionId: 'q2', volumeUsd: 120.5 },
      { kind: 'match', matchId: '0xMATCH3', questionId: 'q3', volumeUsdMicros: 2_500_000 },
    ],
  })
  // Listed with no reported figure is a different fact from zero volume.
  expect(markets.get('0xmatch1')).toEqual({ listed: true, volumeUsd: null })
  expect(markets.get('0xmatch2')).toEqual({ listed: true, volumeUsd: 120.5 })
  expect(markets.get('0xmatch3')).toEqual({ listed: true, volumeUsd: 2.5 })
  expect(markets.get('0xmatch9')).toBeUndefined()
})

test('linked binary questions on one match sum into one traded figure', () => {
  const markets = parseMiawPrixMarkets({
    items: [
      { matchId: '0xMATCH1', questionId: 'q1', volumeUsd: 40 },
      { matchId: '0xMATCH1', questionId: 'q2', volumeUsd: 60 },
    ],
  })
  expect(markets.get('0xmatch1')).toEqual({ listed: true, volumeUsd: 100 })
})

test('the source names its proxy kind and carries the selected season', async () => {
  const calls: string[] = []
  const source = miawPrixSource('/api/agent-arena', '/api/prediction', (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ ok: true, season: null, seasons: [], standings: [], matches: [] }), { status: 200 })
  }) as unknown as typeof fetch)

  await source.board()
  await source.board('solz-00')
  expect(calls).toEqual([
    '/api/agent-arena?kind=miawPrix',
    '/api/agent-arena?kind=miawPrix&seasonId=solz-00',
  ])
})

test('an event deep link reads its exact recorded match outside the programme window', async () => {
  const calls: string[] = []
  const source = miawPrixSource('/api/agent-arena', '/api/prediction', (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ ok: true, match: payload.matches[0] }), { status: 200 })
  }) as unknown as typeof fetch)
  const match = await source.match('0xMATCH1')
  expect(calls).toEqual(['/api/agent-arena?kind=miawPrix&matchId=0xMATCH1'])
  expect(match?.result?.winnerMint).toBe('MintB')
  expect(match?.sides.map((side) => side.symbol)).toEqual(['$ALPHA', '$BETA'])
})

test('the catalogue read asks for every status and follows its cursor', async () => {
  const calls: string[] = []
  const pages = [
    { items: [{ matchId: '0xA' }], nextCursor: 'page-2' },
    { items: [{ matchId: '0xB' }], nextCursor: null },
  ]
  const source = miawPrixSource('/api/agent-arena', '/api/prediction', (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 })
  }) as unknown as typeof fetch)

  const markets = await source.markets()
  // A settled match still has traded volume worth reading, so `eligible` will not do.
  expect(calls[0]).toBe('/api/prediction/market/list?status=all&limit=100')
  expect(calls[1]).toBe('/api/prediction/market/list?status=all&limit=100&cursor=page-2')
  expect([...markets.keys()].sort()).toEqual(['0xa', '0xb'])
})

test('an unreachable programme reports its status instead of an empty board', async () => {
  const failing = miawPrixSource('/api/agent-arena', '/api/prediction', (async () => new Response('', { status: 503 })) as unknown as typeof fetch)
  const boardError = await failing.board().catch((error: Error) => error)
  const marketsError = await failing.markets().catch((error: Error) => error)
  expect(String((boardError as Error).message)).toContain('The MIAW PRIX programme is unavailable (503).')
  expect(String((marketsError as Error).message)).toContain('The prediction catalogue is unavailable (503).')
})


/* ── Market capitalisation ────────────────────────────────────────────────── */
/* The field is being added to the programme payload by the service. This client
 * does not get to decide when it lands or what it is called, so it reads every
 * spelling it might arrive as — and reports ABSENCE as absence. */

test('a standings row with no capitalisation reported is unknown, never zero', () => {
  const board = parseMiawPrixBoard(payload)
  // Neither fixture row carries the field at all.
  expect(board.standings[0]!.marketCapUsd).toBeNull()
  expect(board.standings[1]!.marketCapUsd).toBeNull()
  expect(board.standings[0]!.marketCapUsd).not.toBe(0)
})

test('a reported capitalisation is read whichever spelling the payload uses', () => {
  expect(standingMarketCapUsd({ marketCapUsd: 12_400_000 })).toBe(12_400_000)
  expect(standingMarketCapUsd({ marketCap: 900 })).toBe(900)
  expect(standingMarketCapUsd({ market_cap_usd: 42 })).toBe(42)
  // Micros are how this codebase already carries USD on the wire.
  expect(standingMarketCapUsd({ marketCapUsdMicros: 12_400_000_000_000 })).toBe(12_400_000)
  // Postgres serialises `numeric` as a string; that is still a figure.
  expect(standingMarketCapUsd({ marketCapUsd: '250000.5' })).toBe(250_000.5)
})

test('a reported zero is a figure, and everything unreadable is not', () => {
  // Somebody published this. The column may print it.
  expect(standingMarketCapUsd({ marketCapUsd: 0 })).toBe(0)
  // Nobody published these, so the column must say so rather than pick a number.
  expect(standingMarketCapUsd({})).toBeNull()
  expect(standingMarketCapUsd({ marketCapUsd: null })).toBeNull()
  expect(standingMarketCapUsd({ marketCapUsd: 'unknown' })).toBeNull()
  expect(standingMarketCapUsd({ marketCapUsd: -5 })).toBeNull()
  expect(standingMarketCapUsd({ marketCapUsd: Number.NaN })).toBeNull()
  expect(standingMarketCapUsd({ marketCapUsd: {} })).toBeNull()
})

test('a capitalisation on the payload reaches the parsed standing', () => {
  const board = parseMiawPrixBoard({
    ...payload,
    standings: [{ ...payload.standings[0], marketCapUsd: 12_400_000 }],
  })
  expect(board.standings[0]!.marketCapUsd).toBe(12_400_000)
})
