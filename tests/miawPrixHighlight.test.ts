import { expect, test } from 'bun:test'
import { chooseHighlight, programmeOrder } from '../src/components/home/useMiawPrixHighlight'
import type { MiawPrixMatch } from '../src/components/miawprix/miawPrixSource'

const NOW = Date.parse('2026-09-18T21:20:00.000Z')

function match(matchId: string, scheduledStartAt: number, status: string): MiawPrixMatch {
  return {
    matchId,
    displayMatchId: matchId,
    scheduledStartAt,
    matchDurationMs: 60 * 60_000,
    status,
    definitionId: 'colosseum_team_deathmatch_3v3',
    title: 'Team Deathmatch',
    cycleIndex: 0,
    cycleMatchIndex: 0,
    cycleMatchCount: 30,
    sides: [
      { teamId: 'team-1', mint: 'mint-1', symbol: 'SPYx', name: 'SPYx' },
      { teamId: 'team-2', mint: 'mint-2', symbol: 'AMZNx', name: 'AMZNx' },
    ],
    result: null,
    rewardPoolL: null,
  }
}

test('a missed planned kickoff cannot displace the next watchable highlight', () => {
  const missed = match('SPY-AMZN', NOW - 14 * 60_000, 'planned')
  const next = match('QQQ-PLTR', NOW + 48 * 60_000, 'planned')
  expect(programmeOrder([missed, next], NOW).map((item) => item.matchId)).toEqual([next.matchId])
  expect(chooseHighlight([missed, next], NOW)?.matchId).toBe(next.matchId)
})

test('an actual live room stays the highlight until its scheduled window ends', () => {
  const live = match('SPY-AMZN', NOW - 14 * 60_000, 'live')
  const next = match('QQQ-PLTR', NOW + 48 * 60_000, 'planned')
  expect(chooseHighlight([live, next], NOW)?.matchId).toBe(live.matchId)
  expect(chooseHighlight([live, next], NOW + 47 * 60_000)?.matchId).toBe(next.matchId)
})
