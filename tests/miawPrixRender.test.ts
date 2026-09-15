import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MiawPrixApp } from '../src/components/miawprix/MiawPrixApp'
import { MatchTable } from '../src/components/miawprix/MatchTable'
import { SeasonPanel } from '../src/components/miawprix/SeasonPanel'
import { StandingsTable } from '../src/components/miawprix/StandingsTable'
import { EM_DASH, NO_MARKET_NOTE, PAIRING_LOCK_MS, champion, rankStandings } from '../src/components/miawprix/board'
import {
  MARKETS_FAILED, MARKETS_UNREAD, marketsRead,
  type MiawPrixMarkets, type MiawPrixMatch, type MiawPrixSeason,
} from '../src/components/miawprix/miawPrixSource'

const NOW = Date.parse('2026-09-16T12:00:00.000Z')
/** The catalogue ANSWERED and does not list this match - the only state in
 *  which "no prediction market opened" is a true thing to print. */
const NO_MARKETS = marketsRead(new Map() as MiawPrixMarkets)

const season = (over: Partial<MiawPrixSeason> = {}): MiawPrixSeason => ({
  seasonId: 'solz-00', seasonIndex: 0, startsAt: NOW - 86_400_000, endsAt: NOW + 86_400_000, status: 'live', ...over,
})

const match = (over: Partial<MiawPrixMatch> = {}): MiawPrixMatch => ({
  matchId: '0xMATCH1', displayMatchId: 'MP-014', scheduledStartAt: NOW + 86_400_000, status: 'scheduled',
  definitionId: 'colosseum_team_deathmatch_3v3', title: '', sides: [], result: null, rewardPoolL: null, ...over,
})

const sideA = { teamId: 'team-a', mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', color: '#c7ff00' }
const sideB = { teamId: 'team-b', mint: 'MintB', symbol: '$BETA', name: 'Beta', color: '#ff579d' }

/** Effects do not run in static rendering, so the app's first paint IS its
 *  loading state — exactly what a reader sees before the fetch lands. */
const bootHtml = () => renderToStaticMarkup(createElement(MiawPrixApp, {
  endpoint: '/api/agent-arena', predictionApiUrl: '/api/prediction',
}))

test('the loading state is the tables with their cells un-inked, never a sentence', () => {
  const html = bootHtml()
  // The final surface's structure, headers and column layout are already there.
  expect(html).toContain('<table')
  expect(html).toContain('Matches')
  expect(html).toContain('Reward pool')
  expect(html).toContain('Volume')
  expect(html).toContain('mp-pending')
  expect(html).toContain('aria-busy="true"')
  // No table is replaced by a sentence; the only loading TEXT is the screen
  // reader's, which the skeleton cannot carry because it is aria-hidden.
  expect(html).not.toContain('mp-message-row')
  expect(html.match(/Loading/g) ?? []).toHaveLength(1)
  expect(html).toContain('class="sr-only" role="status"')
})

test('the page renders inside the shared shell and brings no header of its own', () => {
  const html = bootHtml()
  expect(html).toContain('sz-main')
  expect(html).toContain('cc-site-footer')
  expect(html).not.toContain('sz-site-header')
})

test('a match with no prediction market shows an em dash and never a zero', () => {
  const html = renderToStaticMarkup(createElement(MatchTable, {
    variant: 'finished', now: NOW, loading: false, unavailable: '', markets: NO_MARKETS,
    matches: [match({ status: 'settled', sides: [sideA, sideB], result: { winnerTeamId: 'team-b', winnerMint: 'MintB' }, rewardPoolL: 4200 })],
  }))
  expect(html).toContain('No prediction market opened for this match')
  expect(html).toContain(EM_DASH)
  expect(html).not.toContain('$0')
})

test('a market that exists and traded nothing is allowed to say zero', () => {
  const html = renderToStaticMarkup(createElement(MatchTable, {
    variant: 'finished', now: NOW, loading: false, unavailable: '',
    markets: marketsRead(new Map([['0xmatch1', { listed: true, volumeUsd: 0 }]]) as MiawPrixMarkets),
    matches: [match({ status: 'settled', sides: [sideA, sideB], result: { winnerTeamId: 'team-a', winnerMint: 'MintA' } })],
  }))
  expect(html).toContain('$0')
  expect(html).toContain('no trades yet')
})

test('an unlocked pairing counts down instead of inventing an opponent', () => {
  const html = renderToStaticMarkup(createElement(MatchTable, {
    variant: 'upcoming', now: NOW, loading: false, unavailable: '', markets: NO_MARKETS,
    matches: [match({ scheduledStartAt: NOW + PAIRING_LOCK_MS + 7 * 3_600_000 })],
  }))
  expect(html).toContain('Pairing locks in 7h 00m')
  expect(html).not.toContain('$ALPHA')
  expect(html).not.toContain('Team 1')
})

test('a finished match leads with the winning coin and dims the other side', () => {
  const html = renderToStaticMarkup(createElement(MatchTable, {
    variant: 'finished', now: NOW, loading: false, unavailable: '', markets: NO_MARKETS,
    matches: [match({ status: 'settled', sides: [sideA, sideB], result: { winnerTeamId: 'team-b', winnerMint: 'MintB' } })],
  }))
  expect(html).toContain('$BETA')
  expect(html).toContain('mp-coin is-muted')
  expect(html).toContain('is-final')
})

test('a closed season publishes its champion; a running one does not', () => {
  const closedSeason = season({ status: 'closed' as const })
  const rows = rankStandings([{ mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 7, losses: 4, matches: 11 }])
  const closed = renderToStaticMarkup(createElement(SeasonPanel, {
    season: closedSeason, seasons: [], champion: champion(closedSeason, rows), now: NOW, loading: false, onSelect: () => {},
  }))
  expect(closed).toContain('SEASON 00')
  expect(closed).toContain('Champion')
  expect(closed).toContain('$ALPHA')

  const live = renderToStaticMarkup(createElement(SeasonPanel, {
    season: season({ status: 'live' }), seasons: [], champion: null, now: NOW, loading: false, onSelect: () => {},
  }))
  expect(live).not.toContain('Champion')
  expect(live).toContain('Closes in')
})

/* The loading branch used to early-return a panel with no status chip, no
 * champion block and no picker, so the whole page slid upward when data landed.
 * AGENTS.md: loading preserves the final surface's structure and column layout. */
test('the season panel loads as itself with its values un-inked, not as a smaller panel', () => {
  const closedSeason = season({ status: 'closed' as const })
  const ranked = rankStandings([{ mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 7, losses: 4, matches: 11 }])
  const props = {
    season: closedSeason,
    seasons: [season(), season({ seasonId: 'solz-01', seasonIndex: 1, status: 'upcoming' as const })],
    champion: champion(closedSeason, ranked),
    now: NOW,
    onSelect: () => {},
  }
  const pending = renderToStaticMarkup(createElement(SeasonPanel, { ...props, loading: true }))
  const loaded = renderToStaticMarkup(createElement(SeasonPanel, { ...props, loading: false }))

  // Every cell that carries a value in the loaded panel exists while it loads.
  for (const cell of [
    'mp-season-main', 'mp-season-id', 'mp-status', 'mp-season-window',
    'mp-champion', 'mp-champion-label', 'mp-champion-record',
    'mp-season-clock', 'mp-clock-label', 'mp-season-picker',
  ]) {
    expect(pending).toContain(cell)
    expect(loaded).toContain(cell)
  }
  // The closed season keeps its three-column grid class, so the columns do not
  // re-flow underneath the reader either.
  expect(pending).toContain('is-closed')
  expect(pending).toContain('aria-busy="true"')

  // What is missing is the VALUES, and only the values.
  expect(pending).toContain('mp-pending')
  expect(pending).not.toContain('SEASON 00')
  expect(pending).not.toContain('$ALPHA')
  expect(pending).not.toContain('Final')
  expect(loaded).not.toContain('mp-pending')
})

test('the season picker survives a programme with only one season, inert rather than gone', () => {
  const html = renderToStaticMarkup(createElement(SeasonPanel, {
    season: season(), seasons: [season()], champion: null, now: NOW, loading: false, onSelect: () => {},
  }))
  expect(html).toContain('mp-season-picker')
  expect(html).toContain('disabled')
})

test('the standings table states the rule it will be argued about', () => {
  const html = renderToStaticMarkup(createElement(StandingsTable, {
    rows: rankStandings([
      { mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 5, losses: 3, matches: 8 },
      { mint: 'MintB', symbol: '$BETA', name: 'Beta', wins: 5, losses: 1, matches: 6 },
    ]),
    loading: false, unavailable: '',
  }))
  expect(html).toContain('Won on raw wins')
  expect(html).toContain('mp-tie')
  // The coin leads its own row; a positional label never does.
  expect(html).toContain('$BETA')
  expect(html).not.toContain('Team 1')
})

test('an unreachable programme says so instead of showing an empty season', () => {
  const html = renderToStaticMarkup(createElement(StandingsTable, {
    rows: [], loading: false, unavailable: 'Standings are unavailable while the programme is unreachable.',
  }))
  expect(html).toContain('unavailable')
  expect(html).toContain('<table')
})

/* THE BLOCKER, as a reader saw it.
 *
 * `volumeCell` was handed one empty `Map` for the initial state, for the error
 * state and for a real answer, so a fully loaded board with the catalogue still
 * in flight - the normal load window of EVERY page view - published "No
 * prediction market opened for this match" on every row, including rows that
 * carry real volume the moment the join lands. A catalogue that was down said
 * it forever, and silently. */
test('a board that has loaded before the catalogue has answered claims nothing about a market', () => {
  const rows = [
    match({ matchId: '0xMATCH1', status: 'settled', sides: [sideA, sideB], result: { winnerTeamId: 'team-a', winnerMint: 'MintA' } }),
    match({ matchId: '0xMATCH2', status: 'settled', sides: [sideA, sideB], result: { winnerTeamId: 'team-b', winnerMint: 'MintB' } }),
  ]
  const render = (markets: Parameters<typeof MatchTable>[0]['markets']) => renderToStaticMarkup(createElement(MatchTable, {
    variant: 'finished', now: NOW, loading: false, unavailable: '', markets, matches: rows,
  }))

  const unread = render(MARKETS_UNREAD)
  const failed = render(MARKETS_FAILED)

  for (const html of [unread, failed]) {
    // The rows themselves are fully rendered - this is not a loading table.
    expect(html).toContain('$ALPHA')
    expect(html).not.toContain('mp-pending-row')
    // ...and not one of them states a fact about a market that was never read.
    expect(html).not.toContain(NO_MARKET_NOTE)
    expect(html).not.toContain('No prediction market opened')
    // Nor does either invent liquidity in its place.
    expect(html).not.toContain('$0')
    expect(html).not.toContain('mp-volume')
  }

  // Unread is drawn as an un-inked value, like every other value being read.
  expect(unread).toContain('mp-pending--num')
  expect(unread).toContain('Reading the prediction catalogue')
  // Failed says what failed, and says it is not about this match.
  expect(failed).toContain('could not be read')
  expect(failed).toContain('not a statement about this match')
  expect(failed).not.toContain('mp-pending')

  // And once the catalogue HAS answered, the sentence is allowed again.
  expect(render(NO_MARKETS)).toContain(NO_MARKET_NOTE)
})

test('a catalogue outage is disclosed on the page, not only in a title attribute', () => {
  const html = renderToStaticMarkup(createElement(MatchTable, {
    variant: 'finished', now: NOW, loading: false, unavailable: '', markets: MARKETS_FAILED,
    matches: [match({ status: 'settled', sides: [sideA, sideB], result: { winnerTeamId: 'team-a', winnerMint: 'MintA' } })],
  }))
  // Every volume cell is an em dash, which on this page otherwise reads as "we
  // looked and there is no market" - so the cell carries the distinction.
  expect(html).toContain('mp-unknown')
  expect(html).toContain(EM_DASH)
  expect(html).not.toContain(NO_MARKET_NOTE)
})

/* A refresh that fails keeps the rows that already landed AND used to print
 * "unavailable" underneath them, so one table made two contradictory claims. */
test('a table showing rows says they are the last read, and never calls itself unavailable', () => {
  const rows = rankStandings([{ mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 5, losses: 3, matches: 8 }])
  const unavailable = 'Standings are unavailable while the programme is unreachable.'

  const stale = renderToStaticMarkup(createElement(StandingsTable, { rows, loading: false, unavailable }))
  expect(stale).toContain('$ALPHA')
  expect(stale).toContain('last read that landed')
  expect(stale).toContain('is-stale')
  expect(stale).not.toContain(unavailable)
  expect(stale).not.toContain('unavailable')
  // One sentence about the table, not two.
  expect(stale.match(/mp-message-row/g) ?? []).toHaveLength(1)

  // With nothing to show, the outage IS the message.
  const empty = renderToStaticMarkup(createElement(StandingsTable, { rows: [], loading: false, unavailable }))
  expect(empty).toContain(unavailable)
  expect(empty).not.toContain('last read that landed')
  expect(empty.match(/mp-message-row/g) ?? []).toHaveLength(1)
})

test('a match table showing rows says the same thing about itself', () => {
  const matches = [match({ status: 'settled', sides: [sideA, sideB], result: { winnerTeamId: 'team-a', winnerMint: 'MintA' } })]
  const unavailable = 'Results are unavailable while the programme is unreachable.'

  const stale = renderToStaticMarkup(createElement(MatchTable, {
    variant: 'finished', now: NOW, loading: false, unavailable, markets: NO_MARKETS, matches,
  }))
  expect(stale).toContain('$ALPHA')
  expect(stale).toContain('last read that landed')
  expect(stale).not.toContain('unavailable')
  expect(stale.match(/mp-message-row/g) ?? []).toHaveLength(1)

  const empty = renderToStaticMarkup(createElement(MatchTable, {
    variant: 'finished', now: NOW, loading: false, unavailable, markets: NO_MARKETS, matches: [],
  }))
  expect(empty).toContain(unavailable)
  expect(empty).not.toContain('last read that landed')
})

/* The standings table prints a tie chip on the row that LOST the tie; the
 * champion cell stated the winner flatly, so the page disagreed with itself. */
test('a champion that did not win outright says the tie was broken, and on what', () => {
  const closed = season({ status: 'closed' as const })
  const panel = (rows: Parameters<typeof rankStandings>[0]) => renderToStaticMarkup(createElement(SeasonPanel, {
    season: closed, seasons: [], champion: champion(closed, rankStandings(rows)), now: NOW, loading: false, onSelect: () => {},
  }))

  const onLosses = panel([
    { mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 7, losses: 6, matches: 13 },
    { mint: 'MintB', symbol: '$BETA', name: 'Beta', wins: 7, losses: 2, matches: 9 },
  ])
  expect(onLosses).toContain('Champion')
  expect(onLosses).toContain('$BETA')
  expect(onLosses).toContain('mp-champion-tie')
  expect(onLosses).toContain('Tied on 7 wins with 1 other coin')
  expect(onLosses).toContain('fewer losses (2)')

  const onOrder = panel([
    { mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 7, losses: 2, matches: 9 },
    { mint: 'MintB', symbol: '$BETA', name: 'Beta', wins: 7, losses: 2, matches: 9 },
  ])
  expect(onOrder).toContain('reached 7 first')
  expect(onOrder).not.toContain('fewer losses')

  // Won outright: the cell stays as it was, with nothing extra claimed.
  const outright = panel([
    { mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 9, losses: 1, matches: 10 },
    { mint: 'MintB', symbol: '$BETA', name: 'Beta', wins: 4, losses: 6, matches: 10 },
  ])
  expect(outright).toContain('$ALPHA')
  expect(outright).not.toContain('mp-champion-tie')
  expect(outright).not.toContain('Tied on')
})
