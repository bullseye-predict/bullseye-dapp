import { expect, test } from 'bun:test'
import {
  DEFAULT_CATWALK_EXPLORER,
  catwalkSeasonLabel,
  catwalkSource,
  explorerAddressUrl,
  marketCapLabel,
  parseCatwalkBoard,
  parseCatwalkSpots,
  parseCatwalkTeam,
  parseGrandPrixStandings,
  standingsByMint,
  usdLabel,
} from '../src/components/solz/catwalkSource'

const team = {
  mint: 'MintA', tokenProgram: 'TP', decimals: 6,
  symbol: '$ALPHA', name: 'Alpha', logoUrl: 'https://cdn.test/a.png', color: '#c7ff00',
}

test('the board carries coin identity and keeps walking in separate from on the board', () => {
  const board = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 2, lineupSize: 4,
    season: { seasonId: 'solz-2040-01', seasonIndex: 3, startsAt: 1, endsAt: 2 },
    lineup: [
      { spot: 1, mint: 'MintA', lane: 'outbid', active: true, team, bid: { usdMicros: 4_200_000_000 } },
      { spot: 2, mint: 'MintB', lane: 'ranked', active: true, team: null },
      { spot: 3, mint: 'MintC', lane: 'champion', active: false, team: null },
    ],
  })
  expect(board.season?.seasonId).toBe('solz-2040-01')
  // What a holder paid travels with the holder, so no row ever has to look a
  // price up by position - which is somebody else's price.
  expect(board.lineup[0]!.paidUsdMicros).toBe(4_200_000_000)
  expect(board.lineup[1]!.paidUsdMicros).toBeNull()
  expect(board.lineup.filter((entry) => entry.active)).toHaveLength(2)
  expect(board.lineup[0]!.team).toMatchObject({ mint: 'MintA', symbol: '$ALPHA', logoUrl: 'https://cdn.test/a.png' })
  // A team is its contract address, so the display id is the mint.
  expect(board.lineup[0]!.team!.id).toBe('MintA')
})

test('the season is carried by its index, and labelled from it rather than its key', () => {
  const board = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1,
    season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2 },
    lineup: [],
  })
  expect(board.season?.seasonIndex).toBe(0)
  // SEASON 00, the same label /miaw-prix prints: `solz-00` is a storage key.
  expect(catwalkSeasonLabel(board.season)).toBe('SEASON 00')
  expect(catwalkSeasonLabel({ seasonId: 'solz-11', seasonIndex: 11, startsAt: 0, endsAt: 0 })).toBe('SEASON 11')
  // No index means no label at all, never the raw id as a stand-in.
  expect(catwalkSeasonLabel({ seasonId: 'solz-00', seasonIndex: -1, startsAt: 0, endsAt: 0 })).toBeNull()
  expect(catwalkSeasonLabel(null)).toBeNull()
})

test('an entry with no mint is dropped rather than rendered as a blank slot', () => {
  const board = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null,
    lineup: [{ spot: 1, mint: '', lane: 'ranked', active: true, team: null }],
  })
  expect(board.lineup).toHaveLength(0)
})

test('an unknown lane falls back rather than throwing the whole board away', () => {
  const board = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null,
    lineup: [{ spot: 1, mint: 'MintA', lane: 'something-new', active: true, team: null }],
  })
  expect(board.lineup[0]!.lane).toBe('ranked')
})

test('a failed board read is surfaced, never rendered as an empty board', () => {
  expect(() => parseCatwalkBoard({ ok: false })).toThrow()
  expect(() => parseCatwalkBoard(null)).toThrow()
})

test('spot pricing reports unavailability instead of inventing a price', () => {
  // A closed ladder now also carries WHY it is closed and how many seats the
  // lane is configured for, so the page can say "closed between seasons" rather
  // than the bare "nothing for sale" that reads the same as an outage.
  expect(parseCatwalkSpots({ ok: true, available: false })).toEqual({
    available: false, seasonId: '', outbidSpots: 0, spots: [], configuredSeats: 0, closedReason: '',
  })
  expect(parseCatwalkSpots({ ok: true, available: false, configuredSeats: 3, closedReason: 'season-closed' })).toMatchObject({
    available: false, configuredSeats: 3, closedReason: 'season-closed',
  })
  const priced = parseCatwalkSpots({
    ok: true, available: true, seasonId: 's1', outbidSpots: 4,
    spots: [{ spot: 1, askUsdMicros: 17_006_000_000 }],
  })
  expect(priced.spots[0]).toEqual({ spot: 1, askUsdMicros: 17_006_000_000 })
  // How long the ladder is. It bounds the ladder AS ITS OWN LIST, which is what
  // keeps board positions - numbered by the board, not by the sale - out of it.
  expect(priced.outbidSpots).toBe(4)
  // A server that does not publish the count still published a ladder.
  expect(parseCatwalkSpots({ ok: true, available: true, spots: [{ spot: 1, askUsdMicros: 1 }, { spot: 2, askUsdMicros: 2 }] }).outbidSpots).toBe(2)
  expect(usdLabel(priced.spots[0]!.askUsdMicros)).toBe('$17,006')
})

test('standings lead with the coin and report raw wins', () => {
  const { rows } = parseGrandPrixStandings({
    ok: true, season: { seasonId: 's1', startsAt: 1, endsAt: 2 },
    rows: [{ mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 7, losses: 2, matches: 9 }],
  })
  expect(rows[0]).toMatchObject({ symbol: '$ALPHA', wins: 7, losses: 2, matches: 9 })
})

test('the source calls the proxy by kind and reports a bad status', async () => {
  const calls: string[] = []
  const source = catwalkSource('/api/agent-arena', (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ ok: true, gameKey: 'solz', activeSlots: 0, lineupSize: 0, season: null, lineup: [] }), { status: 200 })
  }) as unknown as typeof fetch)
  await source.board()
  expect(calls).toEqual(['/api/agent-arena?kind=catwalk'])

  const failing = catwalkSource('/api/agent-arena', (async () => new Response('', { status: 503 })) as unknown as typeof fetch)
  await expect(failing.board()).rejects.toThrow('unavailable (503)')
})

test('a priced spot carries who is holding it and what they paid', () => {
  const { spots } = parseCatwalkSpots({
    ok: true, available: true, seasonId: 's1',
    spots: [{
      spot: 4, askUsdMicros: 5_040_000_000, heldUsdMicros: 4_200_000_000,
      mint: 'MintA', symbol: '$GIGA', name: 'Giga', logoUrl: 'https://cdn.test/g.png',
    }],
  })
  expect(spots[0]).toMatchObject({
    spot: 4, askUsdMicros: 5_040_000_000, heldUsdMicros: 4_200_000_000,
    mint: 'MintA', symbol: '$GIGA', name: 'Giga', logoUrl: 'https://cdn.test/g.png',
  })
  // An unheld slot reports no held price rather than a zero someone paid.
  const open = parseCatwalkSpots({ ok: true, available: true, seasonId: 's1', spots: [{ spot: 5, askUsdMicros: 1 }] })
  expect(open.spots[0]!.heldUsdMicros).toBeUndefined()
  expect(open.spots[0]!.mint).toBeUndefined()
})

test('the source reads the spot ladder by its own proxy kind', async () => {
  const calls: string[] = []
  const source = catwalkSource('/api/agent-arena', (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ ok: true, available: false }), { status: 200 })
  }) as unknown as typeof fetch)
  expect(await source.spots()).toEqual({ available: false, seasonId: '', outbidSpots: 0, spots: [], configuredSeats: 0, closedReason: '' })
  expect(calls).toEqual(['/api/agent-arena?kind=catwalkSpots'])
})

/**
 * THE SCHEDULE IS READ FOR ONE FACT: when this board next locks.
 *
 * It goes out on the arena proxy's OWN kind rather than a new one, and comes
 * back through `parseMiawPrixBoard` rather than a second parser - so /catwalk
 * and /miaw-prix can never disagree about what arrived on the wire they share.
 */
test('the source reads the MIAW PRIX schedule through the programme s own parser', async () => {
  const calls: string[] = []
  const source = catwalkSource('/api/agent-arena', (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify({
      ok: true, season: null, seasons: [], standings: [],
      matches: [{ matchId: 'm1', scheduledStartAt: 1_800_000_000_000, status: 'scheduled', sides: [] }],
    }), { status: 200 })
  }) as unknown as typeof fetch)
  const programme = await source.schedule()
  expect(calls).toEqual(['/api/agent-arena?kind=miawPrix'])
  expect(programme.matches[0]).toMatchObject({ matchId: 'm1', scheduledStartAt: 1_800_000_000_000, sides: [] })

  // A programme that could not be read REJECTS. The caller keeps that apart from
  // a programme with nothing scheduled; folding the two would put NO ROTATION
  // SCHEDULED on the hero over a 503.
  const failing = catwalkSource('/api/agent-arena', (async () => new Response('', { status: 503 })) as unknown as typeof fetch)
  await expect(failing.schedule()).rejects.toThrow('unavailable (503)')
})

test('records are indexed from standings only, so a coin that has never walked has none', () => {
  const { rows } = parseGrandPrixStandings({
    ok: true, season: null,
    rows: [{ mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 3, losses: 0, matches: 3 }],
  })
  const index = standingsByMint(rows)
  expect(index.get('MintA')).toMatchObject({ wins: 3, losses: 0, matches: 3 })
  // parseCatwalkTeam zeroes every record field, so a coin the standings have
  // never seen must resolve to nothing at all rather than to 0-0.
  expect(index.get('MintB')).toBeUndefined()
  expect(parseCatwalkTeam({ mint: 'MintB' })!.wins).toBe(0)
})

/* ── MARKET CAP, AND WHY UNKNOWN IS NOT ZERO ─────────────────────────────── */

test('market cap is read from wherever the wire carries it, and absent is null', () => {
  const lineup = (team: Record<string, unknown>, extra: Record<string, unknown> = {}) => parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null,
    lineup: [{ spot: 1, mint: 'MintA', lane: 'ranked', active: true, team: { mint: 'MintA', ...team }, ...extra }],
  }).lineup[0]!

  // What this repo asks upstream for.
  expect(lineup({ marketCapUsd: 4_200_000 }).marketCapUsd).toBe(4_200_000)
  // What DexScreener itself returns, so neither is dropped while the upstream
  // field is still landing.
  expect(lineup({ marketCap: 91_000 }).marketCapUsd).toBe(91_000)
  // FDV last: it is a different quantity, worth showing only when there is no
  // circulating figure at all.
  expect(lineup({ fdv: 7_000_000 }).marketCapUsd).toBe(7_000_000)
  expect(lineup({ marketCap: 91_000, fdv: 7_000_000 }).marketCapUsd).toBe(91_000)
  // Carried beside the team rather than on it, which is just as good.
  expect(lineup({}, { marketCapUsd: 512_000 }).marketCapUsd).toBe(512_000)
  // A string figure is a figure; the wire has been known to quote them.
  expect(lineup({ marketCapUsd: '1234.5' }).marketCapUsd).toBe(1234.5)

  // AND EVERY ABSENCE IS NULL. A zero here would render on the board as "this
  // coin is worth nothing", which is a far larger claim than "nobody published
  // a figure" - and the field is not on the wire yet at all.
  for (const absent of [{}, { marketCapUsd: 0 }, { marketCap: -1 }, { fdv: 'not a number' }, { marketCapUsd: null }]) {
    expect(lineup(absent).marketCapUsd).toBeNull()
  }
})

test('market cap is compacted for comparison down a column', () => {
  expect(marketCapLabel(4_200_000)).toBe('$4.2M')
  expect(marketCapLabel(91_400)).toBe('$91.4K')
  expect(marketCapLabel(2_140_000_000)).toBe('$2.14B')
  expect(marketCapLabel(940)).toBe('$940')
})

/* ── the explorer link, built from the venue and never by hand ───────────── */

test('an address link follows the board’s own chain, or is not drawn at all', () => {
  // Mainnet takes no ?cluster=, exactly as explorerClusterParam reports.
  expect(explorerAddressUrl(DEFAULT_CATWALK_EXPLORER, 'MintA')).toBe('https://explorer.solana.com/address/MintA')
  // A devnet board links to devnet rather than silently resolving to mainnet.
  expect(explorerAddressUrl(
    { family: 'SOLANA', chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', explorerUrl: 'https://explorer.solana.com/' },
    'MintA',
  )).toBe('https://explorer.solana.com/address/MintA?cluster=devnet')
  // An unknown genesis hash names no cluster rather than the wrong one.
  expect(explorerAddressUrl({ family: 'SOLANA', chainId: 'nonsense', explorerUrl: 'https://explorer.solana.com' }, 'MintA'))
    .toBe('https://explorer.solana.com/address/MintA')
  // No venue, no link. The caller renders the copy control alone.
  expect(explorerAddressUrl(null, 'MintA')).toBeUndefined()
  expect(explorerAddressUrl({ family: 'SOLANA' }, 'MintA')).toBeUndefined()
  expect(explorerAddressUrl(DEFAULT_CATWALK_EXPLORER, '')).toBeUndefined()
})

test('the board carries the chain its mints live on when the wire names one', () => {
  const named = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null, lineup: [],
    explorer: { family: 'SOLANA', chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', explorerUrl: 'https://explorer.solana.com' },
  })
  expect(named.explorer).toMatchObject({ family: 'SOLANA', explorerUrl: 'https://explorer.solana.com' })
  // A wire that names none reports none, so the caller falls back deliberately
  // rather than inheriting a half-built venue.
  expect(parseCatwalkBoard({ ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null, lineup: [] }).explorer).toBeNull()
  expect(parseCatwalkBoard({ ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null, lineup: [], explorer: { family: 'SOLANA' } }).explorer).toBeNull()
})

/* ── the seat plan, read all-or-nothing ──────────────────────────────────── */

/**
 * THE GUARANTEE IS A FIGURE THIS REPO DOES NOT HOLD.
 *
 * Four runway seats and twelve line-up seats for OUTBID are BACKEND settings,
 * exactly as a price is. The board either receives the whole plan or it knows
 * nothing about it, and "nothing" is null rather than zero - because a zero here
 * is a stated guarantee of NO seats, which is a real setting an operator can
 * choose and must not be indistinguishable from a field that never arrived.
 *
 * A HALF-READ PLAN IS NOT A PLAN. If the runway parsed and the line-up did not,
 * a rail holding the half would print a guarantee for one band and imply none
 * for the other. One unreadable lane collapses the whole field.
 */
const plan = (seats: unknown) => parseCatwalkBoard({
  ok: true, gameKey: 'solz', activeSlots: 12, lineupSize: 36, season: null, lineup: [], seats,
}).seats

test('the seat plan arrives whole or not at all, and never as a zero', () => {
  expect(plan({
    runway: { outbid: 4, champion: 3, ranked: 5 },
    lineup: { outbid: 12, champion: 0, ranked: 12 },
  })).toEqual({
    runway: { outbid: 4, champion: 3, ranked: 5 },
    lineup: { outbid: 12, champion: 0, ranked: 12 },
  })
  // A guarantee of zero is a real setting and survives as one.
  expect(plan({ runway: { outbid: 0, champion: 0, ranked: 0 }, lineup: { outbid: 0, champion: 0, ranked: 0 } }))
    .toMatchObject({ runway: { outbid: 0 } })

  // A server that has not shipped the field is not a board guaranteeing nothing.
  expect(plan(undefined)).toBeNull()
  expect(plan(null)).toBeNull()
  expect(plan([])).toBeNull()
  expect(plan('4')).toBeNull()
  // One band missing takes the whole plan with it.
  expect(plan({ runway: { outbid: 4, champion: 3, ranked: 5 } })).toBeNull()
  // One LANE missing does too - a partial band is not a band.
  expect(plan({ runway: { outbid: 4, champion: 3 }, lineup: { outbid: 12, champion: 0, ranked: 12 } })).toBeNull()
  // And anything that is not a whole non-negative count is not a seat count.
  for (const bad of ['4', 4.5, -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
    expect(plan({ runway: { outbid: bad, champion: 3, ranked: 5 }, lineup: { outbid: 12, champion: 0, ranked: 12 } })).toBeNull()
  }
})

/**
 * THE RANKED READ HAS ALWAYS BEEN ON THE WIRE AND WAS ALWAYS DROPPED.
 *
 * Without it the ranked lane cannot tell "the registry has not been read" from
 * "the registry lists nobody" - and both carry `candidates: 0`, so a page
 * reading the count alone states the second every time the network blinks. The
 * state is carried verbatim, including a word this page does not recognise: a
 * renderer that guessed at an unknown state would be guessing about a read.
 */
test('the ranked lane read is carried whole, state and count together', () => {
  const lane = (rankedLane: unknown) => parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null, lineup: [], rankedLane,
  }).rankedLane

  const empty = { projects: [], registryTokens: null, registryUpdatedAt: null }

  expect(lane({ state: 'ready', candidates: 41 })).toEqual({ state: 'ready', candidates: 41, ...empty })
  // 'cold' and 'unavailable' both come through with their zero intact, because
  // the STATE is what tells a renderer not to print it.
  expect(lane({ state: 'cold', candidates: 0 })).toEqual({ state: 'cold', candidates: 0, ...empty })
  expect(lane({ state: 'unavailable', candidates: 0 })).toEqual({ state: 'unavailable', candidates: 0, ...empty })
  // Extra fields upstream carries - `source`, `observedAt` - are STILL not read
  // here. observedAt dates the REGISTRY read and is not a board movement;
  // relabelling it as one is the mistake this parser refuses to make possible.
  expect(lane({ state: 'ready', candidates: 2, source: 'x', observedAt: 1 }))
    .toEqual({ state: 'ready', candidates: 2, ...empty })

  // A count with no state is not a read this page can reason about.
  expect(lane({ candidates: 3 })).toBeNull()
  expect(lane({ state: 'ready' })).toBeNull()
  expect(lane(undefined)).toBeNull()
  expect(lane(null)).toBeNull()
  expect(lane('ready')).toBeNull()
})

/**
 * THE LADDER ROWS, READ FIGURE BY FIGURE.
 *
 * The MINT is identity and a row without one is dropped whole, exactly as a
 * lineup entry without one is. Every FIGURE degrades on its own: the coin is
 * still on the ladder when one of its counters is unreadable, and the cell that
 * did not parse is null - which renders as an em dash and never as a zero,
 * because a coin with no finalized matches and a coin nobody could read are two
 * different claims about that coin.
 */
test('the ranked ladder rows carry their figures as digits, or as nothing', () => {
  const lane = (rankedLane: unknown) => parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null, lineup: [], rankedLane,
  }).rankedLane

  const read = lane({
    state: 'ready',
    candidates: 2,
    registryTokens: 3,
    registryUpdatedAt: '2026-08-12T00:00:00.000Z',
    projects: [
      { mint: 'soLZmint', symbol: 'SOLZ', name: 'Solz', logoUrl: 'https://cdn.test/s.png', matches: '1427', playerEntries: '8194', poolBaseUnits: '1208317450000000', poolDecimals: 6 },
      // No mint: dropped entirely, because the mint IS the row's identity.
      { symbol: 'GHOST', matches: '9' },
      // A figure that is not a string of digits nulls THAT CELL and keeps the
      // row - including a NUMBER, which has already lost the precision the
      // string exists to keep.
      // A real-length mint the identity file does not name.
      { mint: 'pumP' + 'x'.repeat(36) + 'mint', matches: 1427, playerEntries: '', poolBaseUnits: '12.5', poolDecimals: 300 },
    ],
  })

  expect(read?.candidates).toBe(2)
  expect(read?.registryTokens).toBe(3)
  expect(read?.registryUpdatedAt).toBe('2026-08-12T00:00:00.000Z')
  expect(read?.projects).toHaveLength(2)
  expect(read?.projects[0]).toEqual({
    mint: 'soLZmint', symbol: 'SOLZ', name: 'Solz', logoUrl: 'https://cdn.test/s.png',
    matches: '1427', playerEntries: '8194', poolBaseUnits: '1208317450000000', poolDecimals: 6,
  })
  // A mint the identity file does not name is SHOWN by its address, head and
  // tail - never hidden, because the ladder is as deep as the chain is.
  const unnamed = 'pumP' + 'x'.repeat(36) + 'mint'
  expect(read?.projects[1]).toEqual({
    mint: unnamed, symbol: 'pumP…mint', name: unnamed, logoUrl: null,
    matches: null, playerEntries: null, poolBaseUnits: null, poolDecimals: null,
  })

  // A u128 past MAX_SAFE_INTEGER survives byte for byte. Number() would not
  // throw on it, it would round - and the wrong figure looks entirely plausible.
  const huge = (2n ** 80n).toString()
  const big = lane({ state: 'ready', candidates: 1, projects: [{ mint: 'm', poolBaseUnits: huge, poolDecimals: 6 }] })
  expect(big?.projects[0]?.poolBaseUnits).toBe(huge)

  // A server that has not shipped the rows yet is not a ladder with nobody on
  // it: the list is empty and the renderer gates on the STATE, never on length.
  expect(lane({ state: 'ready', candidates: 2 })?.projects).toEqual([])
  expect(lane({ state: 'ready', candidates: 2, projects: 'soon' })?.projects).toEqual([])
  // And the registry depth omits the half it cannot state rather than guessing.
  expect(lane({ state: 'ready', candidates: 2 })?.registryTokens).toBeNull()
  expect(lane({ state: 'ready', candidates: 2, registryTokens: '3' })?.registryTokens).toBeNull()
})

/**
 * WHEN A SEAT WAS LAST PAID FOR - the one change on this board that carries a
 * real timestamp. ZERO IS NOT AN INSTANT: an absent, malformed or zero field
 * dates nothing, and a renderer given 0 would date the last sale to 1970.
 */
test('the last paid seat is an instant or nothing, never the epoch', () => {
  const at = (lastSeatPaidAt: unknown) => parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 1, season: null, lineup: [], lastSeatPaidAt,
  }).lastSeatPaidAt

  expect(at(1_770_000_000_000)).toBe(1_770_000_000_000)
  for (const bad of [0, -1, 1.5, '1770000000000', Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
    expect(at(bad)).toBeNull()
  }
})
