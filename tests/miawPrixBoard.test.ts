import { expect, test } from 'bun:test'
import {
  EM_DASH, MARKET_CAP_UNKNOWN_NOTE, NO_MARKET_NOTE, PAIRING_LOCK_MS, champion, championNote, countdown, isWinner,
  kickoffLabel, marketCapCell, matchState, marketsNotice, orderSeasons, pairingNotice, programmeLabel, rankStandings,
  rewardLabel, seasonClock, seasonLabel, seasonMismatch, sectionCount, splitMatches, usdCompact, volumeCell,
} from '../src/components/miawprix/board'
import {
  MARKETS_FAILED, MARKETS_UNREAD, marketsRead,
  type MiawPrixMarkets, type MiawPrixMatch, type MiawPrixSeason,
} from '../src/components/miawprix/miawPrixSource'

const NOW = Date.parse('2026-09-16T12:00:00.000Z')

const season = (over: Partial<MiawPrixSeason> = {}): MiawPrixSeason => ({
  seasonId: 'solz-00', seasonIndex: 0, startsAt: NOW - 86_400_000, endsAt: NOW + 86_400_000, status: 'live', ...over,
})

const match = (over: Partial<MiawPrixMatch> = {}): MiawPrixMatch => ({
  matchId: '0xMATCH1', displayMatchId: 'MP-014', scheduledStartAt: NOW + 86_400_000, status: 'scheduled',
  definitionId: 'colosseum_team_deathmatch_3v3', title: '', sides: [], result: null, rewardPoolL: null, ...over,
})

const sideA = { teamId: 'team-a', mint: 'MintA', symbol: '$ALPHA', name: 'Alpha' }
const sideB = { teamId: 'team-b', mint: 'MintB', symbol: '$BETA', name: 'Beta' }

const standing = (mint: string, wins: number, losses: number, matches: number) =>
  ({ mint, symbol: `$${mint}`, name: mint, wins, losses, matches })

test('the season is numbered and padded, so SEASON 00 sorts beside SEASON 11', () => {
  expect(seasonLabel(season())).toBe('SEASON 00')
  expect(seasonLabel(season({ seasonIndex: 11 }))).toBe('SEASON 11')
  expect(seasonLabel(season({ seasonIndex: 100 }))).toBe('SEASON 100')
  expect(seasonLabel(null)).toBe('NO SEASON')
})

/* This replaces an assertion that pinned `SEASON SOLZ-LEGACY` — the raw
 * `season_id` printed as the season's name. RANKED_TERMINOLOGY 4.110 forbids
 * showing the id at all: it is a database key, and a reader who sees it cannot
 * tell which season it is. An unnumbered season says it has no number. */
test('a season the programme never numbered is not named by its raw id', () => {
  const legacy = season({ seasonIndex: -1, seasonId: 'solz-legacy' })
  expect(seasonLabel(legacy)).toBe('SEASON UNNUMBERED')
  expect(seasonLabel(legacy).toLowerCase()).not.toContain('solz-legacy')
})

test('a season that could not be served is named by number, and the substitution is stated', () => {
  const live = season({ seasonId: 'solz-02', seasonIndex: 2 })
  const asked = season({ seasonId: 'solz-01', seasonIndex: 1, status: 'closed' })
  const listed = [live, asked]

  // Nothing requested, or the right season served: no notice at all.
  expect(seasonMismatch('', live, listed)).toBeNull()
  expect(seasonMismatch('solz-02', live, listed)).toBeNull()

  const swapped = seasonMismatch('solz-01', live, listed)!
  expect(swapped).toContain('SEASON 01')
  expect(swapped).toContain('SEASON 02')
  // The id is the request handle, never the reader's name for a season.
  expect(swapped.toLowerCase()).not.toContain('solz-01')
  expect(swapped.toLowerCase()).not.toContain('solz-02')

  // A requested season the programme does not list cannot be numbered, so it is
  // described rather than spelled out as its id.
  const unknown = seasonMismatch('solz-99', live, listed)!
  expect(unknown).toContain('The season you asked for')
  expect(unknown).toContain('SEASON 02')
  expect(unknown).not.toContain('99')

  // A response with no season at all is still a failed request, not a blank page.
  expect(seasonMismatch('solz-01', null, listed)).toContain('SEASON 01')
})

test('the selector opens on the season being played', () => {
  const ordered = orderSeasons([season({ seasonId: 'a', seasonIndex: 0 }), season({ seasonId: 'c', seasonIndex: 2 }), season({ seasonId: 'b', seasonIndex: 1 })])
  expect(ordered.map((entry) => entry.seasonId)).toEqual(['c', 'b', 'a'])
})

test('a season is won on RAW WINS, not on win rate', () => {
  // Beta is perfect from six; Alpha ground out seven wins and four losses.
  // Raw wins is the rule, so Alpha leads. This is the argument the table settles.
  const ranked = rankStandings([standing('MintB', 6, 0, 6), standing('MintA', 7, 4, 11)])
  expect(ranked.map((row) => row.mint)).toEqual(['MintA', 'MintB'])
  expect(ranked[0]!.rank).toBe(1)
  expect(ranked[0]!.tiedOnWins).toBe(false)
})

test('a tie on wins is broken by losses and is marked as a tie', () => {
  const ranked = rankStandings([standing('MintA', 5, 3, 8), standing('MintB', 5, 1, 6)])
  expect(ranked.map((row) => row.mint)).toEqual(['MintB', 'MintA'])
  expect(ranked[1]!.tiedOnWins).toBe(true)
})

test('rows level on wins and losses keep the order the server sent', () => {
  // The server orders by reached_wins_at, which the wire shape does not carry;
  // re-sorting by anything else here would silently reorder a settled season.
  const ranked = rankStandings([standing('First', 4, 2, 6), standing('Second', 4, 2, 6)])
  expect(ranked.map((row) => row.mint)).toEqual(['First', 'Second'])
})

test('a leader is not a champion until the season closes', () => {
  const ranked = rankStandings([standing('MintA', 7, 4, 11)])
  expect(champion(season({ status: 'live' }), ranked)).toBeNull()
  expect(champion(season({ status: 'upcoming' }), ranked)).toBeNull()
  expect(champion(season({ status: 'closed' }), ranked)!.mint).toBe('MintA')
  expect(champion(season({ status: 'closed' }), [])).toBeNull()
})

/* The standings table prints a tie chip on the row that LOST the tie, while the
 * champion cell stated the winner flatly. Two surfaces, one season, and only one
 * of them admitted the title was not won on the visible numbers. */
test('a title won on a level win count discloses the tie and what broke it', () => {
  const closed = season({ status: 'closed' })

  // Won outright: nothing extra to say.
  const outright = champion(closed, rankStandings([standing('MintA', 7, 4, 11), standing('MintB', 5, 2, 7)]))!
  expect(outright.mint).toBe('MintA')
  expect(outright.tieBreak).toBeNull()
  expect(championNote(outright)).toBe('')
  expect(championNote(null)).toBe('')

  // Level on wins, separated by losses.
  const onLosses = champion(closed, rankStandings([standing('MintA', 7, 6, 13), standing('MintB', 7, 2, 9)]))!
  expect(onLosses.mint).toBe('MintB')
  expect(onLosses.tieBreak).toEqual({ level: 1, on: 'losses', wins: 7, losses: 2 })
  expect(championNote(onLosses)).toContain('Tied on 7 wins with 1 other coin')
  expect(championNote(onLosses)).toContain('fewer losses (2)')

  // Level on wins AND losses: the order the server sent decided it, and saying
  // "fewer losses" there would be false.
  const onOrder = champion(closed, rankStandings([standing('First', 7, 2, 9), standing('Second', 7, 2, 9)]))!
  expect(onOrder.mint).toBe('First')
  expect(onOrder.tieBreak).toEqual({ level: 1, on: 'order', wins: 7, losses: 2 })
  expect(championNote(onOrder)).toContain('Tied on 7 wins and 2 losses')
  expect(championNote(onOrder)).toContain('reached 7 first')
  expect(championNote(onOrder)).not.toContain('fewer losses')

  // Three coins level counts the other two, not itself.
  const crowd = champion(closed, rankStandings([
    standing('MintA', 7, 1, 8), standing('MintB', 7, 3, 10), standing('MintC', 7, 5, 12),
  ]))!
  expect(crowd.tieBreak).toEqual({ level: 2, on: 'losses', wins: 7, losses: 1 })
  expect(championNote(crowd)).toContain('2 other coins')
})

test('a published result outranks whatever the status string still says', () => {
  expect(matchState(match({ status: 'live', result: { winnerTeamId: 'team-a', winnerMint: 'MintA' } }))).toBe('final')
  expect(matchState(match({ status: 'settled' }))).toBe('final')
  expect(matchState(match({ status: 'live' }))).toBe('live')
  expect(matchState(match({ status: 'cancelled' }))).toBe('cancelled')
  expect(matchState(match({ status: 'reserved' }))).toBe('upcoming')
  expect(matchState(match({ status: 'planned' }))).toBe('upcoming')
})

test('upcoming runs forward and results run backward', () => {
  const soon = match({ matchId: 'soon', scheduledStartAt: NOW + 3_600_000 })
  const later = match({ matchId: 'later', scheduledStartAt: NOW + 7_200_000 })
  const old = match({ matchId: 'old', scheduledStartAt: NOW - 7_200_000, status: 'settled' })
  const recent = match({ matchId: 'recent', scheduledStartAt: NOW - 3_600_000, status: 'settled' })
  const { upcoming, finished } = splitMatches([later, old, soon, recent])
  expect(upcoming.map((entry) => entry.matchId)).toEqual(['soon', 'later'])
  expect(finished.map((entry) => entry.matchId)).toEqual(['recent', 'old'])
})

test('a cancelled match belongs with what is done, not with what is coming', () => {
  const { upcoming, finished } = splitMatches([match({ status: 'cancelled' })])
  expect(upcoming).toHaveLength(0)
  expect(finished).toHaveLength(1)
})

test('countdowns are read in minutes, never seconds', () => {
  expect(countdown(0)).toBe('0m')
  expect(countdown(-5_000)).toBe('0m')
  expect(countdown(18 * 60_000)).toBe('18m')
  expect(countdown(4 * 3_600_000 + 12 * 60_000)).toBe('4h 12m')
  expect(countdown(12 * 86_400_000 + 4 * 3_600_000)).toBe('12d 04h')
})

test('the season clock says what a reader is waiting for', () => {
  expect(seasonClock(season({ status: 'live', endsAt: NOW + 7_200_000 }), NOW)).toBe('Closes in 2h 00m')
  expect(seasonClock(season({ status: 'upcoming', startsAt: NOW + 3_600_000 }), NOW)).toBe('Opens in 1h 00m')
  expect(seasonClock(season({ status: 'closed' }), NOW)).toBe('Final')
  expect(seasonClock(null, NOW)).toBe(EM_DASH)
})

test('an unbound pairing counts down to the lock instead of inventing teams', () => {
  const kickoff = NOW + PAIRING_LOCK_MS + 7 * 3_600_000
  expect(pairingNotice(match({ scheduledStartAt: kickoff }), NOW)).toBe('Pairing locks in 7h 00m')
  // Past the lock with nothing bound is a stalled grid, not a fixture.
  expect(pairingNotice(match({ scheduledStartAt: NOW + 3_600_000 }), NOW)).toBe('Pairing pending')
  expect(pairingNotice(match({ scheduledStartAt: 0 }), NOW)).toBe('Not scheduled')
  expect(pairingNotice(match({ status: 'settled' }), NOW)).toBe('No pairing recorded')
})

test('a bound pairing has no notice, so the row renders its coins', () => {
  expect(pairingNotice(match({ sides: [sideA, sideB] }), NOW)).toBeNull()
})

test('the programme is named by its definition, not by whatever the title says', () => {
  expect(programmeLabel(match({ definitionId: 'colosseum_team_deathmatch_3v3', title: 'Whatever' }))).toBe('Team Deathmatch 3v3')
  expect(programmeLabel(match({ definitionId: 'colosseum_grab_bottle_3v3' }))).toBe('Grab Bottle 3v3')
  expect(programmeLabel(match({ definitionId: 'colosseum_new_mode_2v2', title: 'New mode' }))).toBe('New mode')
  expect(programmeLabel(match({ definitionId: 'colosseum_new_mode_2v2' }))).toBe('new mode 2v2')
  expect(programmeLabel(match({ definitionId: '' }))).toBe(EM_DASH)
})

test('an unreported reward pool is unknown, not zero', () => {
  expect(rewardLabel(match({ rewardPoolL: null }))).toBe(EM_DASH)
  expect(rewardLabel(match({ rewardPoolL: 0 }))).toBe('0 Soda')
  expect(rewardLabel(match({ rewardPoolL: 12_500 }))).toBe('12,500 Soda')
})

const catalogue: MiawPrixMarkets = new Map([
  ['0xtraded', { listed: true, volumeUsd: 1_284.4 }],
  ['0xquiet', { listed: true, volumeUsd: 0 }],
  ['0xunreported', { listed: true, volumeUsd: null }],
])

test('VOLUME keeps three different facts apart and only ever prints one of them', () => {
  const markets = marketsRead(catalogue)
  // No market at all: an em dash. Printing $0 here would report liquidity that
  // was never possible.
  expect(volumeCell('0xMISSING', markets).text).toBe(EM_DASH)
  // Listed but unreported is also not zero.
  expect(volumeCell('0xUNREPORTED', markets).text).toBe(EM_DASH)
  // A market that exists and traded nothing IS zero, and says so.
  expect(volumeCell('0xQUIET', markets).text).toBe('$0')
  expect(volumeCell('0xTRADED', markets).text).toBe('$1,284')
  // The three cases never share a note, so the title text explains which it is.
  const notes = ['0xMISSING', '0xUNREPORTED', '0xQUIET'].map((id) => volumeCell(id, markets).note)
  expect(new Set(notes).size).toBe(3)
})

/* THE BLOCKER, at the level it was introduced.
 *
 * The initial state and the error state were both `new Map()`, the same value a
 * successful read of a catalogue that does not list this match produces. So
 * "nobody has answered" and "the catalogue is down" both rendered as the one
 * sentence that is a claim about the MATCH. */
test('an unread catalogue and a failed one never say a market was not opened', () => {
  for (const markets of [MARKETS_UNREAD, MARKETS_FAILED]) {
    const cell = volumeCell('0xTRADED', markets)
    expect(cell.note).not.toBe(NO_MARKET_NOTE)
    expect(cell.note).not.toContain('No prediction market opened')
    // Nor may either invent liquidity to fill the gap.
    expect(cell.text).not.toContain('$')
  }
  // Unread claims nothing at all - not even the em dash this page spends on
  // "we looked and there is none".
  expect(volumeCell('0xTRADED', MARKETS_UNREAD).reading).toBe('pending')
  expect(volumeCell('0xTRADED', MARKETS_UNREAD).text).toBe('')
  // A failure is about the catalogue, explicitly not about the match.
  const failed = volumeCell('0xTRADED', MARKETS_FAILED)
  expect(failed.reading).toBe('unreadable')
  expect(failed.text).toBe(EM_DASH)
  expect(failed.note).toContain('could not be read')
  expect(failed.note).toContain('not a statement about this match')
})

test('only a catalogue that answered may report a match has no market', () => {
  // The identical match id, read against all three states.
  expect(volumeCell('0xMISSING', MARKETS_UNREAD).reading).toBe('pending')
  expect(volumeCell('0xMISSING', MARKETS_FAILED).reading).toBe('unreadable')
  expect(volumeCell('0xMISSING', marketsRead(catalogue)).reading).toBe('unopened')
  expect(volumeCell('0xMISSING', marketsRead(catalogue)).note).toBe(NO_MARKET_NOTE)
  // An empty catalogue that ANSWERED is still an answer about the match.
  expect(volumeCell('0xMISSING', marketsRead(new Map())).note).toBe(NO_MARKET_NOTE)
  // All five readings are distinguishable, so no two can be collapsed later.
  const readings = [
    volumeCell('0xMISSING', MARKETS_UNREAD), volumeCell('0xMISSING', MARKETS_FAILED),
    volumeCell('0xMISSING', marketsRead(catalogue)), volumeCell('0xUNREPORTED', marketsRead(catalogue)),
    volumeCell('0xQUIET', marketsRead(catalogue)), volumeCell('0xTRADED', marketsRead(catalogue)),
  ]
  expect(new Set(readings.map((cell) => cell.reading)).size).toBe(6)
  expect(new Set(readings.map((cell) => cell.note)).size).toBe(6)
})

test('an unopened market and a market with no trades stay different facts', () => {
  const unopened = volumeCell('0xMISSING', marketsRead(catalogue))
  const quiet = volumeCell('0xQUIET', marketsRead(catalogue))
  expect(unopened.text).toBe(EM_DASH)
  expect(quiet.text).toBe('$0')
  expect(unopened.note).not.toBe(quiet.note)
})

test('the catalogue outage is disclosed in words, and only when it happened', () => {
  expect(marketsNotice(MARKETS_UNREAD)).toBe('')
  expect(marketsNotice(marketsRead(catalogue))).toBe('')
  expect(marketsNotice(marketsRead(new Map()))).toBe('')
  const notice = marketsNotice(MARKETS_FAILED)
  expect(notice).toContain('could not be read')
  expect(notice).not.toContain('No prediction market opened')
})

test('volume joins on the canonical match id regardless of its casing', () => {
  const markets = marketsRead(new Map([['0xabc', { listed: true, volumeUsd: 10 }]]))
  expect(volumeCell('0xABC', markets).text).toBe('$10')
})

test('the winner is matched on the coin, and an unknown winner highlights nobody', () => {
  const settled = match({ sides: [sideA, sideB], result: { winnerTeamId: 'team-b', winnerMint: 'MintB' } })
  expect(isWinner(settled, sideA)).toBe(false)
  expect(isWinner(settled, sideB)).toBe(true)
  const stranger = match({ sides: [sideA, sideB], result: { winnerTeamId: '', winnerMint: 'MintZ' } })
  expect(isWinner(stranger, sideA)).toBe(false)
  expect(isWinner(stranger, sideB)).toBe(false)
  expect(isWinner(match({ sides: [sideA] }), sideA)).toBe(false)
})

test('an unscheduled kickoff is an em dash rather than the epoch', () => {
  expect(kickoffLabel(0)).toBe(EM_DASH)
  expect(kickoffLabel(NOW)).not.toBe(EM_DASH)
})

// A count taken from the stand-in empty board after a failed read is not zero,
// it is unknown — and "0 settled" printed under "the programme is unavailable"
// asserts exactly what the banner above it just said could not be known.
test('a section count says unavailable after a failed read, never zero', () => {
  const reading = { loading: true, counted: false }
  const failed = { loading: false, counted: false }
  const read = { loading: false, counted: true }
  const label = { one: 'coin on the board', many: 'coins on the board', unavailable: 'Standings unavailable' }

  expect(sectionCount(reading, 0, label)).toBe('Reading the season')
  expect(sectionCount(failed, 0, label)).toBe('Standings unavailable')
  expect(sectionCount(failed, 0, label)).not.toContain('0')

  // A genuinely empty season still states its zero — that is a real answer.
  expect(sectionCount(read, 0, label)).toBe('0 coins on the board')
  expect(sectionCount(read, 1, label)).toBe('1 coin on the board')
  expect(sectionCount(read, 7, label)).toBe('7 coins on the board')
})


/* ── Market capitalisation ────────────────────────────────────────────────── */

test('an unpriced coin is UNKNOWN, and says so; it is never worth zero', () => {
  for (const absent of [null, undefined]) {
    const cell = marketCapCell(absent)
    expect(cell.known).toBe(false)
    expect(cell.text).toBe(EM_DASH)
    expect(cell.note).toBe(MARKET_CAP_UNKNOWN_NOTE)
    expect(cell.text).not.toBe('$0')
  }
})

test('a reported figure is printed, including a reported zero', () => {
  expect(marketCapCell(12_400_000).text).toBe('$12.4M')
  expect(marketCapCell(12_400_000).known).toBe(true)
  // Published by somebody, so it is a fact rather than an absence, and it does
  // NOT carry the "not reported" note that an unpriced coin does.
  expect(marketCapCell(0).known).toBe(true)
  expect(marketCapCell(0).text).toBe('$0')
  expect(marketCapCell(0).note).not.toBe(MARKET_CAP_UNKNOWN_NOTE)
})

test('capitalisations are compact, so a nine-figure number cannot out-shout the win count', () => {
  expect(usdCompact(0)).toBe('$0')
  expect(usdCompact(942.5)).toBe('$942.5')
  expect(usdCompact(12_400_000)).toBe('$12.4M')
  expect(usdCompact(3_200_000_000)).toBe('$3.2B')
})
