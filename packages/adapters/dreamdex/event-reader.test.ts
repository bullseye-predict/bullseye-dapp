import { describe, expect, test } from 'bun:test'
import { DreamDexEventReader, dreamDexNetwork, SOMNIA_SHANNON_TUSDC_ADDRESS, type DreamDexEventBinding, type DreamDexEventReads } from './event-reader'
import { eventMarketKey } from '../../prediction-core/event-market'
import { parseDreamDexInspection } from '../../../apps/dreamdex/inspect'

const marketId = `0x${'ab'.repeat(32)}` as const
const address = `0x${'12'.repeat(20)}` as const
const network = dreamDexNetwork('5031')
const binding: DreamDexEventBinding = { matchId: 'casual-1', venue: 'DREAMDEX', chainId: '5031', marketId, oracleQuestionId: 77n, tradingStartsAt: 1000, tradingLocksAt: 60000, voidPolicy: 0 }

function fixture() {
  let target: unknown
  let verified = 0
  const reads: DreamDexEventReads = {
    async verifyNetwork() { verified++ },
    async getEventRecord() { return { oracleQuestionId: 77n, slots: 2, collateral: network.addresses.collateral!, oracleAdapter: network.addresses.oracleHub!, start: 1n, expiry: 60n, voidPolicy: 0 } },
    async getMarketOnchain() { return { marketAddress: address, outcomeToken: address, yesId: 1n, noId: 2n, pool: address, nonce: 1n, collateral: network.addresses.collateral!, status: 1, backing: 0n, finalized: false, expiry: 60n, decimals: 18, winningOutcome: 0, isResolved: false, isVoided: false, voidPolicy: 0 } },
    async getMarketStats24h(input) { target = input; return { volume24h: 123456789012345678901n, baseVolume24h: 0n, trades24h: 7, priceChange24h: 0n, high24h: null, low24h: null, openPrice24h: null } },
    async quoteCreateMarketValue() { return 123n },
  }
  return { reads, reader: new DreamDexEventReader('5031', reads, () => 2000), target: () => target, verified: () => verified }
}

describe('DreamDEX game-event adapter', () => {
  test('read-only host requires an explicit question ID and never accepts a pool as market ID', () => {
    const config = { chainId: '5031', indexerUrl: 'https://indexer.example.test', wsRpcUrl: 'wss://rpc.example.test', binding: { ...binding, oracleQuestionId: '77' } }
    expect(parseDreamDexInspection(config).binding.oracleQuestionId).toBe(77n)
    expect(() => parseDreamDexInspection({ ...config, binding: { ...config.binding, marketId: address } })).toThrow('bytes32')
    expect(() => parseDreamDexInspection({ ...config, binding: { ...config.binding, oracleQuestionId: undefined } })).toThrow('oracleQuestionId')
  })
  test('mainnet is USDso; testnet is explicitly different; other EVMs cannot reuse DreamDEX', () => {
    expect(network.collateralSymbol).toBe('USDso')
    expect(network.collateralDecimals).toBe(18)
    expect(dreamDexNetwork('50312').collateralSymbol).toBe('tUSDC')
    expect(dreamDexNetwork('50312').addresses.collateral).toBe(SOMNIA_SHANNON_TUSDC_ADDRESS)
    expect(() => dreamDexNetwork('1')).toThrow('only for Somnia')
  })
  test('same match has independent market scope on each network', () => {
    expect(eventMarketKey(binding)).not.toBe(eventMarketKey({ ...binding, venue: 'SOLANA', chainId: 'devnet' }))
    expect(eventMarketKey(binding)).not.toBe(eventMarketKey({ ...binding, chainId: '50312' }))
  })
  test('volume remains bigint USDso quote units and is requested by immutable market ID', async () => {
    const f = fixture()
    const volume = await f.reader.volume(binding)
    expect(volume.volume24h).toBe(123456789012345678901n)
    expect(volume.collateralSymbol).toBe('USDso')
    expect(f.target()).toEqual({ marketId })
    expect(f.verified()).toBe(1)
  })
  test('rejects wrong chain before making RPC reads', async () => {
    const f = fixture()
    await expect(f.reader.inspect({ ...binding, chainId: '50312' })).rejects.toThrow('another network')
    expect(f.verified()).toBe(0)
  })
  test('does not relabel another oracle question as this match', async () => {
    await expect(fixture().reader.inspect({ ...binding, oracleQuestionId: 78n })).rejects.toThrow('oracle question')
  })
  test('rejects collateral and decimal mismatches', async () => {
    const f = fixture()
    const original = await f.reads.getMarketOnchain(marketId)
    f.reads.getMarketOnchain = async () => ({ ...original, decimals: 6 })
    await expect(f.reader.inspect(binding)).rejects.toThrow('collateral')
    f.reads.getMarketOnchain = async () => ({ ...original, collateral: address })
    await expect(f.reader.inspect(binding)).rejects.toThrow('collateral')
  })
  test('enforces exact on-chain cutoff and void policy', async () => {
    await expect(fixture().reader.inspect({ ...binding, tradingLocksAt: 61000 })).rejects.toThrow('trading window')
    await expect(fixture().reader.inspect({ ...binding, voidPolicy: 2 })).rejects.toThrow('void rules')
  })
  test('transport errors are not represented as zero volume', async () => {
    const f = fixture()
    f.reads.getMarketStats24h = async () => { throw new Error('indexer unavailable') }
    await expect(f.reader.volume(binding)).rejects.toThrow('indexer unavailable')
  })
  test('creation quote includes protocol native value, not gas or a market receipt', async () => {
    const question = { questionText: 'Will team A win casual-1?', sources: [{ sourceType: 1, params: '0x1234' as const }], validAnswers: { answerType: 1, discreteOutcomes: ['YES', 'NO'], numericIntervals: [], numericDecimals: 0n }, resolutionTime: 60n, minAgreement: 1n, subcommitteeSize: 3n, subcommitteeThreshold: 2n }
    const f = fixture()
    const quote = await f.reader.quoteCreation(question)
    expect(quote.requiredValue).toBe(123n)
    expect(quote.gasIncluded).toBe(false)
    expect('marketId' in quote).toBe(false)
    await expect(f.reader.quoteCreation({ ...question, sources: [] })).rejects.toThrow('oracle source')
    await expect(f.reader.quoteCreation({ ...question, validAnswers: { ...question.validAnswers, discreteOutcomes: ['NO', 'YES'] } })).rejects.toThrow('ordered discrete')
    await expect(f.reader.quoteCreation({ ...question, resolutionTime: 1n })).rejects.toThrow('timing')
  })
})
