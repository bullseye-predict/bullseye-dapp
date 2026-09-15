import { expect, test } from 'bun:test'
import { createArenaFeed, currentMatchDrafts, matchQuestions, tradingCollateral } from '../src/components/home/arenaFeed'
import { applyPredictionArena } from '../src/components/home/predictionArena'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'

const agents = [{agentId:'genesis-01',slot:0,codename:'COKE',archetype:'BREACHER',balanceCentilitres:'100000'}]
const match = {roomId:'real-match',status:'live' as const,entryFeeL:20,gameMode:'deathmatch',teamFormat:'ffa',participants:[{agentId:'genesis-01',actorId:'server-bot-0-0',teamId:null,kills:null,deaths:null,won:null}]}
const canonicalMatchId = `0x534f4c5a01010014${'01'.repeat(24)}`
const canonicalQuestionId = `0x515545530101${'02'.repeat(26)}`
test('homepage reads Neon-backed prediction feed without requesting Elysia or sample data',async()=>{
  const calls:string[]=[]
  const read=createArenaFeed('/api/agent-arena', async input=>{calls.push(String(input));return Response.json({ok:true,agents,current:match,matches:[match]})},'https://prediction.test')
  const feed=await read(new AbortController().signal)
  expect(calls).toEqual(['https://prediction.test/arena/feed'])
  expect(feed.current?.roomId).toBe('real-match')
  expect(matchQuestions(feed.current!,feed.agents)).toEqual([{id:'arena-real-match-winner-genesis-01',subjectId:'server-bot-0-0',agentId:'genesis-01',label:'Will COKE win?',answer:null}])
})
test('profiles alone do not invent participants; network collateral stays separate',()=>{
  expect(matchQuestions({...match,participants:[]},agents)).toEqual([])
  expect(tradingCollateral('SOLANA','5031')).toBe('fUSDC')
  expect(tradingCollateral('SOMNIA','5031')).toBe('USDso')
  expect(tradingCollateral('SOMNIA','50312')).toBe('tUSDC')
})
test('a real reserved Genesis room missing its legacy roster still exposes all twelve recorded channel entrants', async () => {
  const genesisAgents = Array.from({ length: 12 }, (_, slot) => ({ agentId: `genesis-${String(slot + 1).padStart(2, '0')}`, slot, codename: `AGENT ${slot + 1}`, archetype: 'ARENA', balanceCentilitres: '100000' }))
  const reserved = { roomId: 'reserved-room', status: 'reserved', entryFeeL: 20, gameMode: 'deathmatch', teamFormat: 'ffa' }
  const calls: string[] = []
  const read = createArenaFeed('/api/agent-arena', async input => {
    const kind = new URL(String(input), 'http://localhost').searchParams.get('kind')
    calls.push(kind ?? '')
    if (kind === 'agents') return Response.json({ ok: true, agents: genesisAgents })
    if (kind === 'current') return Response.json({ ok: true, policy: { participants: 12 }, match: reserved })
    if (kind === 'schedule') return Response.json({ ok: true, upcoming: [] })
    return new Response('', { status: 502 })
  }, '', true)
  const feed = await read(new AbortController().signal)
  expect(feed.current?.participants).toHaveLength(12)
  expect(currentMatchDrafts(feed).events[0]?.questions).toHaveLength(12)
  expect(currentMatchDrafts(feed).events[0]?.questions[0]).toMatchObject({ agentId: 'genesis-01', answer: null })
  expect(calls).toEqual(['agents', 'current', 'schedule'])
})
test('a live Genesis room whose current endpoint omits participants still creates all twelve winner drafts', async () => {
  const genesisAgents = Array.from({ length: 12 }, (_, slot) => ({ agentId: `genesis-${String(slot + 1).padStart(2, '0')}`, slot, codename: `AGENT ${slot + 1}`, archetype: 'ARENA', balanceCentilitres: '100000' }))
  const live = { roomId: 'live-room', status: 'live', entryFeeL: 20, gameMode: 'deathmatch', teamFormat: 'ffa' }
  const read = createArenaFeed('/api/agent-arena', async input => {
    const kind = new URL(String(input), 'http://localhost').searchParams.get('kind')
    if (kind === 'agents') return Response.json({ ok: true, agents: genesisAgents })
    if (kind === 'schedule') return Response.json({ ok: true, upcoming: [] })
    return Response.json({ ok: true, policy: { participants: 12 }, match: live })
  }, '', true)
  const feed = await read(new AbortController().signal)
  expect(feed.current?.participants).toHaveLength(12)
  expect(currentMatchDrafts(feed).events[0]?.questions).toHaveLength(12)
})
test('the current match policy supplies the authoritative game duration', async () => {
  const live = { ...match, startedAt: new Date(1_000).toISOString() }
  const read = createArenaFeed('/api/agent-arena', async input => {
    const kind = new URL(String(input), 'http://localhost').searchParams.get('kind')
    if (kind === 'agents') return Response.json({ ok: true, agents: agents.map(agent => ({ ...agent, matchesPlayed: 0 })) })
    if (kind === 'current') return Response.json({ ok: true, policy: { participants: 1, matchDurationMs: 900_000 }, match: live })
    if (kind === 'schedule') return Response.json({ ok: true, upcoming: [] })
    return Response.json({ ok: true, matches: [live], nextCursor: null })
  })
  const feed = await read(new AbortController().signal)
  expect(feed.current).toMatchObject({ matchDurationMs: 900_000, timingType: 'countdown' })
  expect(feed.matches[0]).toMatchObject({ matchDurationMs: 900_000, timingType: 'countdown' })
})
test('a signed 3v3 room keeps its teams, five-minute clock, and scheduled rotation', async () => {
  const roster = Array.from({ length: 6 }, (_, slot) => ({ agentId: `genesis-${String(slot + 1).padStart(2, '0')}`, slot, codename: `AGENT ${slot + 1}`, archetype: 'ARENA', balanceCentilitres: '100000' }))
  const teams = [
    { id: 'team-1', label: 'Team 1', members: roster.slice(0, 3).map((agent, slot) => ({ agentId: agent.agentId, actorId: `server-bot-0-${slot}`, name: agent.codename })) },
    { id: 'team-2', label: 'Team 2', members: roster.slice(3).map((agent, slot) => ({ agentId: agent.agentId, actorId: `server-bot-0-${slot + 3}`, name: agent.codename })) },
  ]
  const live = {
    roomId: 'team-room', status: 'live', entryFeeL: 20, gameMode: 'deathmatch', teamFormat: '3v3',
    definition: { definitionId: 'team_deathmatch_3v3', title: 'Team Deathmatch · 3v3', summary: 'Most eliminations wins.', matchDurationMs: 300_000, breakMs: 120_000, previewMs: 15_000, teams },
    participants: teams.flatMap(team => team.members.map(member => ({ ...member, teamId: team.id, kills: 0, deaths: 0, won: null }))),
  }
  const planned = { id: 'grab_bottle_3v3', title: 'Grab Bottle · 3v3', summary: 'Control the bottle.', gameMode: 'hotzone', teamFormat: '3v3', teamCount: 2, playersPerTeam: 3, requiredPlayers: 6, matchDurationMs: 300_000, breakMs: 120_000, previewMs: 15_000 }
  const read = createArenaFeed('/api/agent-arena', async input => {
    const kind = new URL(String(input), 'http://localhost').searchParams.get('kind')
    if (kind === 'agents') return Response.json({ ok: true, agents: roster })
    if (kind === 'current') return Response.json({ ok: true, match: live })
    if (kind === 'schedule') return Response.json({ ok: true, upcoming: [{ state: 'planned', definition: planned }] })
    return new Response('', { status: 502 })
  }, '', true)
  const feed = await read(new AbortController().signal)
  expect(feed.current).toMatchObject({ matchDurationMs: 300_000, definition: { id: 'team_deathmatch_3v3', teamFormat: '3v3' } })
  expect(feed.upcoming.map(item => item.definition.title)).toEqual(['Grab Bottle · 3v3'])
  const snapshot = applyPredictionArena(await createSolzDataSource().load(), feed, currentMatchDrafts(feed))
  expect(snapshot.matches[0]).toMatchObject({ mode: 'Team Deathmatch · 3v3', durationMs: 300_000 })
  expect(snapshot.matches[0]?.teams.map(team => [team.name, team.agentIds.length])).toEqual([['Team 1', 3], ['Team 2', 3]])
})
test('feed errors are surfaced, not replaced with fake markets',async()=>{
  const read=createArenaFeed('/api/agent-arena',async()=>new Response('',{status:503}),'https://prediction.test')
  await expect(read(new AbortController().signal)).rejects.toThrow('503')
})
test('Neon event drafts replace the homepage match predictions with one YES/NO market per recorded agent', async () => {
  const base = await createSolzDataSource().load()
  const canonicalMatch = { ...match, matchId: canonicalMatchId }
  const feed = { agents, current: canonicalMatch, matches: [canonicalMatch], upcoming: [], historyError: null, readAt: 1_700_000_000_000 }
  const snapshot = applyPredictionArena(base, feed, { events: [{
    eventId: `arena-${canonicalMatchId.slice(2)}`, matchId: canonicalMatchId, roomId: 'real-match', status: 'live', questions: [
      { questionId: canonicalQuestionId, agentId: 'genesis-01', actorId: 'server-bot-0-0', answer: null },
    ],
  }] })
  expect(snapshot.highlightMatchId).toBe(`arena-${canonicalMatchId.slice(2)}`)
  expect(snapshot.markets).toHaveLength(1)
  expect(snapshot.markets[0]).toMatchObject({ id: canonicalQuestionId, matchId: `arena-${canonicalMatchId.slice(2)}`, title: 'Will COKE win?', status: 'indicative' })
  expect(snapshot.markets[0]?.outcomes.map(value => value.label)).toEqual(['YES', 'NO'])
})
