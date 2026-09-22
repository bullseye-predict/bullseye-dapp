import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CatwalkEntry, ProgrammeStandings } from '../src/components/home/CommunitySections'
import type { CatwalkFeed } from '../src/components/catwalk/useCatwalkBoard'
import type { MiawPrixBoard, MiawPrixMatch } from '../src/components/miawprix/miawPrixSource'
import { standingsByMint, type GrandPrixStanding } from '../src/components/solz/catwalkSource'
import type { CatwalkSpot } from '../src/components/solz/model'

/**
 * THE TWO HOME PANELS, which used to be a simulated league table and a
 * simulated bid form. Everything asserted here is a fact the panels may only
 * state because a read produced it.
 */

// Structurally plausible base58 that belongs to nobody, so nothing in this file
// invites somebody to copy a fixture address out of a test and trade on it.
const MINT_A = 'ZqTestM1nt' + 'A'.repeat(34)
const MINT_B = 'YwTestM1nt' + 'B'.repeat(34)

const HOUR = 3_600_000
const NOW = Date.now()

function card(overrides: Partial<MiawPrixMatch> = {}): MiawPrixMatch {
  return {
    matchId: '0xabc',
    displayMatchId: 'GM-TEST',
    scheduledStartAt: NOW - 2 * HOUR,
    matchDurationMs: 300_000,
    status: 'settled',
    definitionId: 'colosseum_grab_bottle_3v3',
    title: 'Grab Bottle · 3v3',
    cycleIndex: 1,
    cycleMatchIndex: 1,
    cycleMatchCount: 30,
    sides: [
      { teamId: 'team-1', mint: MINT_A, symbol: 'ALPHA', name: 'Alpha', color: '#c7ff00' },
      { teamId: 'team-2', mint: MINT_B, symbol: 'BETA', name: 'Beta', color: '#65cfff' },
    ],
    result: { winnerTeamId: 'team-1', winnerMint: MINT_A },
    rewardPoolL: null,
    ...overrides,
  }
}

const PROGRAMME: MiawPrixBoard = {
  season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: NOW - HOUR, endsAt: NOW + HOUR, status: 'live' },
  seasons: [],
  standings: [
    { mint: MINT_A, symbol: 'ALPHA', name: 'Alpha', wins: 9, losses: 2, matches: 11 },
    { mint: MINT_B, symbol: 'BETA', name: 'Beta', wins: 4, losses: 7, matches: 11 },
  ],
  matches: [card(), card({ matchId: '0xdef', scheduledStartAt: NOW + HOUR, status: 'planned', result: null })],
}

test('the programme panel leads with the settled card, winner first', () => {
  const html = renderToStaticMarkup(
    <ProgrammeStandings board={PROGRAMME} loading={false} refreshing={false} />,
  )
  // RECENT MATCHES is the first tab, because a settled card is the one thing on
  // this page that has already happened.
  expect(html).toContain('aria-selected="true"')
  expect(html.indexOf('Recent matches')).toBeLessThan(html.indexOf('Up next'))
  // WHO WON IS SAID THREE TIMES, and none of the three is colour alone - the
  // first pass relied on the winner's ticker being in its coin's own hue, which
  // tells a reader nothing, because nothing says the coloured one won.
  expect(html.indexOf('ALPHA')).toBeLessThan(html.indexOf('BETA'))   // 1. order
  expect(html).toContain('WON')                                      // 2. a chip
  expect(html).toContain('ch-coin ch-coin--lost')                    // 3. weight
  expect(html).toContain('BEAT')
  expect(html).toContain('FINAL')
  // Crest AND ticker. One without the other is unreadable at this size.
  expect(html).toContain('ch-coin-mark')
  expect(html).toContain('SEASON 00')
})

test('a card whose winner is not one of its sides is never reordered into a result', () => {
  // The result names a mint neither side played. `isWinner` matches on the
  // winning MINT precisely so this is reported as no highlight rather than as
  // side one, which is the coin a teamId fallback would have crowned.
  const board: MiawPrixBoard = {
    ...PROGRAMME,
    matches: [card({ result: { winnerTeamId: 'team-1', winnerMint: 'SomeOtherMintEntirely' } })],
  }
  const html = renderToStaticMarkup(<ProgrammeStandings board={board} loading={false} refreshing={false} />)
  expect(html).toContain('NO RESULT')
  expect(html).not.toContain('BEAT')
  // No verdict, so nothing carries a verdict's marks: no WON chip, and neither
  // side is dimmed as the one that lost.
  expect(html).not.toContain('ch-coin-won')
  expect(html).not.toContain('ch-coin--lost')
})

test('the reel only duplicates itself when there is more than the frame holds', () => {
  const short = renderToStaticMarkup(<ProgrammeStandings board={PROGRAMME} loading={false} refreshing={false} />)
  // One settled card is not a reel. No second copy, and nothing animates.
  expect(short).not.toContain('is-rolling')

  const many: MiawPrixBoard = {
    ...PROGRAMME,
    matches: Array.from({ length: 12 }, (_, index) => card({
      matchId: `0x${index}`,
      scheduledStartAt: NOW - (index + 1) * HOUR,
    })),
  }
  const html = renderToStaticMarkup(<ProgrammeStandings board={many} loading={false} refreshing={false} />)
  expect(html).toContain('is-rolling')
  // The duplicate is hidden from assistive technology: it is the same twelve
  // rows again, and announcing them twice is announcing a list that is wrong.
  expect(html).toContain('aria-hidden="true"')
  // Speed is per row, not per reel, so twelve rows and two dozen read alike.
  expect(html).toContain('--ch-reel-duration')
})

test('a programme that could not be read says so instead of reporting an empty season', () => {
  const html = renderToStaticMarkup(<ProgrammeStandings board={null} loading={false} refreshing={false} />)
  expect(html).toContain('could not be read')
  expect(html).not.toContain('No card has been settled this season yet')
})

const SEAT: CatwalkSpot = { spot: 2, askUsdMicros: 250_000_000 }
const RECORDS: GrandPrixStanding[] = [
  { mint: MINT_A, symbol: 'ALPHA', name: 'Alpha', wins: 9, losses: 2, matches: 11 },
]

function feed(overrides: Partial<CatwalkFeed> = {}): CatwalkFeed {
  return {
    board: {
      gameKey: 'solz', activeSlots: 1, lineupSize: 2, lockLeadMs: null, season: null,
      lineup: [{
        spot: 1, mint: MINT_A, lane: 'ranked', active: true, paidUsdMicros: null, marketCapUsd: null,
        team: {
          id: MINT_A, mint: MINT_A, symbol: 'ALPHA', name: 'Alpha', color: '#c7ff00', glyph: 'ALP',
          status: 'qualified', rank: 0, wins: 0, losses: 0, rating: 0, ratingDelta: 0, streak: '',
          matchesHosted: 0, communityPlayers: 0, joinedAt: 0, blurb: '',
          activity: {
            matches: 0, matchesRequired: 0, uniquePlayers: 0, uniquePlayersRequired: 0,
            hostedArenas: 0, hostedArenasRequired: 0, completionRate: 0, progress: 1,
          },
        },
      }],
      seats: null, rankedLane: null, lastSeatPaidAt: null, explorer: null,
    },
    spots: [SEAT],
    outbidSpots: 2,
    ladder: 'open',
    standings: standingsByMint(RECORDS),
    standingRows: RECORDS,
    standingsState: 'read',
    loading: false,
    refreshing: false,
    readAt: NOW,
    error: '',
    ...overrides,
  }
}

test('the entry panel offers the two real doors into MIAW PRIX and sells nothing itself', () => {
  const html = renderToStaticMarkup(<CatwalkEntry feed={feed()} />)
  // The board is the gate, said in the panel's own headline.
  expect(html).toContain('CATWALK board')
  expect(html).toContain('GET ON THE BOARD')
  expect(html).toContain('WALK THE RUNWAY')
  // A seat is a price, and it is bought on /catwalk - nothing here is a sale.
  expect(html).toContain('TAKE SEAT 02 — $250')
  expect(html).toContain('href="/catwalk#outbid"')
  // The mock bid form and its promise of exposure are gone for good.
  expect(html).not.toContain('highlight queue')
  expect(html).not.toContain('exposure')
  expect(html).not.toContain('Place preview bid')
})

test('a ladder that is shut, unreadable, or simply full are three different sentences', () => {
  const closed = renderToStaticMarkup(<CatwalkEntry feed={feed({ ladder: 'closed', spots: [] })} />)
  expect(closed).toContain('shut right now')
  expect(closed).not.toContain('TAKE SEAT')

  const unknown = renderToStaticMarkup(<CatwalkEntry feed={feed({ ladder: 'unknown', spots: [] })} />)
  expect(unknown).toContain('could not be read')
  expect(unknown).not.toContain('TAKE SEAT')

  // Open, read, and every seat standing on. Not an outage and not a closure.
  const full = renderToStaticMarkup(
    <CatwalkEntry feed={feed({ spots: [{ ...SEAT, mint: MINT_B, symbol: 'BETA' }] })} />,
  )
  expect(full).toContain('Every ladder seat is held')
})

test('a board that could not be read publishes no occupancy at all', () => {
  const html = renderToStaticMarkup(
    <CatwalkEntry feed={feed({ board: null, spots: [], ladder: 'unknown', loading: false, error: 'down' })} />,
  )
  // The product's 12-of-36 shape may still be drawn - /catwalk draws its bands
  // before any read too - but the COUNTS are a claim about who is standing on
  // it, and nobody answered.
  expect(html).toContain('how much of it is held is unknown')
  expect(html).not.toContain('on the board · ')
  expect(html).not.toContain('positions are open')
})

test('the leaderboard numbers board positions and marks the ones that walk', () => {
  const html = renderToStaticMarkup(<CatwalkEntry feed={feed()} />)
  expect(html).toContain('ch-board-row is-runway')
  expect(html).toContain('ch-board-spot')
  // The lane the coin arrived through, and the record the standings read found.
  expect(html).toContain('SOLZ RANKED')
  expect(html).toContain('9 / 2')
})

test('a record nobody could read is an em dash, never a nil-all', () => {
  const html = renderToStaticMarkup(
    <CatwalkEntry feed={feed({ standings: new Map(), standingRows: [], standingsState: 'unknown' })} />,
  )
  expect(html).toContain('—')
  expect(html).not.toContain('0 / 0')
})
