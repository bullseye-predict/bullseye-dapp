import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { decodeAbiParameters, encodeFunctionData, toFunctionSelector } from 'viem'
import { GameDemoService, questionFromArena } from './game-service'
import { gameCreationAbi, gameCreationArgs, gameQuestionDefinition, type DreamDexGameCreator } from '../../packages/adapters/dreamdex/game-creation'
import { dreamDexNetwork } from '../../packages/adapters/dreamdex/event-reader'

const now = 1_789_100_000_000
function fixture() {
  const raw = { ok: true, policy: { participants: 12, matchDurationMs: 1_200_000 }, match: { roomId: 'room-1', matchId: '0x1234', status: 'live', scheduledStartAt: new Date(now - 60_000).toISOString(), participants: Array.from({ length: 12 }, (_, i) => ({ agentId: `genesis-${i + 1}`, actorId: `server-bot-0-${i}` })) } }
  const agents = { ok: true, agents: raw.match.participants.map(p => ({ agentId: p.agentId, codename: p.agentId })) }
  const game = questionFromArena(raw, agents, 'arena-1234', 'genesis-1', 'https://game.example', now)
  return { raw, agents, game }
}
describe('real twelve-agent DreamDEX questions', () => {
  test('keeps the exact match and participant, with ordered YES/NO and a room-scoped result source', () => {
    const { game } = fixture(), def = gameQuestionDefinition(game)
    expect(def.questionText).toContain('server-bot-0-0')
    expect(def.questionText).toContain('room-1')
    expect(def.validAnswers.discreteOutcomes).toEqual(['YES', 'NO'])
    expect(def.sources[0]!.sourceType).toBe(0)
    expect(decodeAbiParameters([{ type: 'string' }, { type: 'bool' }, { type: 'uint8' }], def.sources[0]!.params)).toEqual(['https://game.example/api/v1/agent-arena/matches/room-1/logs', false, 0])
    expect(def.questionText).not.toMatch(/BTC|ETH|price/)
  })
  test('uses the deployed creation selector, not the event signature', () => {
    const args = gameCreationArgs(fixture().game, 22, `0x${'12'.repeat(32)}`, dreamDexNetwork('50312').addresses)
    const data = encodeFunctionData({ abi: gameCreationAbi, functionName: 'scheduleAndCreateMarket', args })
    expect(data.slice(0, 10)).toBe('0x94f9fdc7')
    expect(toFunctionSelector(gameCreationAbi[0])).toBe('0x94f9fdc7')
    expect(args[4].referenceQuestionId).toBe(0n)
  })
  test('rejects stale matches, unknown agents, incomplete rosters and closed trading windows', () => {
    const { raw, agents } = fixture()
    const read = (eventId = 'arena-1234', agent = 'genesis-1', at = now) => questionFromArena(raw, agents, eventId, agent, 'https://game.example', at)
    expect(() => read('arena-other')).toThrow('current')
    expect(() => read('arena-1234', 'stranger')).toThrow('roster')
    expect(() => read('arena-1234', 'genesis-1', now + 1_100_000)).toThrow('finish')
    raw.match.participants.pop()
    expect(() => read()).toThrow('roster')
  })
  test('confirmed creation is idempotent across service restarts; uncertain submission is not repeated', async () => {
    const db = new Database(':memory:'), { game } = fixture()
    const creator = { config: { chainId: '50312', markets: [] } } as unknown as DreamDexGameCreator
    const service = new GameDemoService(db, creator, 'https://game.example')
    const binding = { eventId: 'arena-1234', subjectId: 'genesis-1' }
    db.query('INSERT INTO dreamdex_game_creations VALUES (?,?,?,?,?)').run(JSON.stringify(['arena-1234', 'genesis-1']), JSON.stringify(game), 'CONFIRMED', '0x123', JSON.stringify(binding))
    expect((await service.create('arena-1234', 'genesis-1')).market).toEqual(binding)
    expect(new GameDemoService(db, creator, 'https://game.example').publicConfig().markets).toEqual([{ ...binding, creationTxHash: '0x123' } as never])
    db.query('INSERT INTO dreamdex_game_creations VALUES (?,?,?,?,?)').run(JSON.stringify(['arena-1234', 'genesis-2']), JSON.stringify(game), 'SUBMITTING', null, null)
    expect(service.create('arena-1234', 'genesis-2')).rejects.toThrow('reconciliation')
    db.close()
  })
  test('demo funding sends bounded test amounts once per wallet and rejects uncertain retry', async () => {
    const db = new Database(':memory:'), writes: unknown[] = []
    const address = `0x${'12'.repeat(20)}`
    const creator = {
      wallet: { account: { address: `0x${'34'.repeat(20)}` },
        writeContract: async (p: unknown) => { writes.push(p); return `0x${'01'.repeat(32)}` },
        sendTransaction: async (p: unknown) => { writes.push(p); return `0x${'02'.repeat(32)}` } },
      resources: { reader: { network: { addresses: { collateral: `0x${'56'.repeat(20)}` } } }, client: { getViemClient: () => ({
        getChainId: async () => 50312, readContract: async () => 100_000_000n,
        getBalance: async () => 5_000_000_000_000_000_000n,
        simulateContract: async (request: unknown) => ({ request }), waitForTransactionReceipt: async () => ({ status: 'success' }),
      }) } },
    } as unknown as DreamDexGameCreator
    const service = new GameDemoService(db, creator, 'https://game.example')
    expect((await service.fund(address)).message).toContain('10 tUSDC')
    expect((writes[0] as any).args[1]).toBe(10_000_000n)
    expect((writes[1] as any).value).toBe(200_000_000_000_000_000n)
    await service.fund(address)
    expect(writes.length).toBe(2)
    db.query("UPDATE dreamdex_demo_funding SET native_hash='SUBMITTING'").run()
    await expect(service.fund(address)).rejects.toThrow('reconciliation')
    expect(writes.length).toBe(2)
    db.close()
  })
  test('a failed later liquidity transaction never repeats confirmed game creation', async () => {
    const db = new Database(':memory:'), { raw, agents } = fixture()
    raw.match.scheduledStartAt = new Date().toISOString()
    let creations = 0
    const market = { eventId: 'arena-1234', subjectId: 'genesis-1', marketId: `0x${'01'.repeat(32)}` }
    const creator = { config: { chainId: '50312', markets: [] },
      create: async (_: unknown, before: () => void, submitted: (hash: string) => void) => { creations++; before(); submitted(`0x${'02'.repeat(32)}`); return { hash: `0x${'02'.repeat(32)}`, market } },
      seed: async () => { throw Error('Liquidity transaction failed') },
    } as unknown as DreamDexGameCreator
    const fetcher = (async (url: URL) => Response.json(url.pathname.endsWith('genesis-agents') ? agents : raw)) as typeof fetch
    const service = new GameDemoService(db, creator, 'https://game.example', fetcher)
    expect((await service.create('arena-1234', 'genesis-1')).market).toEqual(market)
    expect((await service.create('arena-1234', 'genesis-1')).market).toEqual(market)
    expect(creations).toBe(1)
    db.close()
  })
})
