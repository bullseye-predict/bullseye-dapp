import { expect, test } from 'bun:test'
import { arenaCatalog, parseArenaDefinition, parseMatch } from '../src/components/agent-arena/adapter'

/** The exact shape `/api/v1/agent-arena` persists on a live room: the match's
 *  own timings, and none of the roster shape. */
const capsule = {
  teams: [],
  title: 'Agent Arena · FFA Deathmatch',
  breakMs: 300_000,
  summary: 'Twelve agents fight for the most eliminations before the twenty-minute horn.',
  timeOnly: true,
  objective: { kind: 'highest_kills', label: 'Highest eliminations' },
  previewMs: 15_000,
  terrainId: 'folio-isle',
  characterId: 'snake',
  definitionId: 'agent_arena_ffa_20',
  schemaVersion: 1,
  respawnDelayMs: 3_000,
  matchDurationMs: 1_200_000,
}

/** The catalog row the same response carries on `policy.definitions`. */
const policy = {
  definitions: [{
    id: 'agent_arena_ffa_20',
    title: 'Agent Arena · FFA Deathmatch',
    summary: 'Twelve agents fight for the most eliminations before the twenty-minute horn.',
    gameMode: 'deathmatch',
    teamFormat: 'ffa',
    teamCount: 1,
    playersPerTeam: 1,
    requiredPlayers: 12,
    durationMs: { development: 1_200_000, production: 1_200_000 },
    breakMs: 300_000,
    previewMs: 15_000,
  }],
}

const match = {
  roomId: 'room-1', status: 'live', entryFeeL: 20,
  definition: capsule,
  participants: [{ agentId: 'genesis-01', actorId: 'server-bot-0-1' }],
}

test('a live FFA room capsule is completed from the policy catalog', () => {
  const definition = parseArenaDefinition(capsule, arenaCatalog(policy))
  // The roster shape exists only in the catalog; the capsule names it by id.
  expect(definition.id).toBe('agent_arena_ffa_20')
  expect(definition.teamCount).toBe(1)
  expect(definition.playersPerTeam).toBe(1)
  expect(definition.requiredPlayers).toBe(12)
  // The capsule's own duration wins over the catalog's {development, production}.
  expect(definition.matchDurationMs).toBe(1_200_000)
  expect(definition.teamFormat).toBe('ffa')
})

test('the catalog states durations as development/production', () => {
  const { matchDurationMs, ...rest } = capsule
  const definition = parseArenaDefinition(rest, arenaCatalog(policy))
  expect(definition.matchDurationMs).toBe(1_200_000)
})

test('an unparseable definition degrades to no definition, never a failed load', () => {
  // This is the whole point: the definition is enrichment. Before, a capsule
  // the parser could not complete threw out of parseMatch, failed the arena
  // snapshot, and rendered "The event couldn't load." on every page.
  const parsed = parseMatch(match, [])
  expect(parsed.roomId).toBe('room-1')
  expect(parsed.definition).toBeUndefined()
  expect(parsed.participants).toHaveLength(1)

  const broken = parseMatch({ ...match, definition: { title: 'no id anywhere' } }, [])
  expect(broken.roomId).toBe('room-1')
  expect(broken.definition).toBeUndefined()
})

test('with the catalog, the match carries its definition and its duration', () => {
  const parsed = parseMatch(match, [], arenaCatalog(policy))
  expect(parsed.definition?.requiredPlayers).toBe(12)
  expect(parsed.matchDurationMs).toBe(1_200_000)
  expect(parsed.timingType).toBe('countdown')
})

test('a real roster still drives the shape when the room has teams', () => {
  const teamed = parseArenaDefinition({
    ...capsule,
    definitionId: 'unknown-to-the-catalog',
    teamFormat: '2v2',
    teams: [
      { id: 'a', label: 'A', members: [{ agentId: 'g1', actorId: 'a1', name: 'One' }, { agentId: 'g2', actorId: 'a2', name: 'Two' }] },
      { id: 'b', label: 'B', members: [{ agentId: 'g3', actorId: 'a3', name: 'Three' }, { agentId: 'g4', actorId: 'a4', name: 'Four' }] },
    ],
  })
  expect(teamed.teamCount).toBe(2)
  expect(teamed.playersPerTeam).toBe(2)
  expect(teamed.requiredPlayers).toBe(4)
})
