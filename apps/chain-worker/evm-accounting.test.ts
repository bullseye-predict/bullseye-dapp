import { expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { accountingFor, EvmAccountingIndex, outcomeTokenId, replayEvmAccounting, type AccountingEvent } from '../../packages/adapters/evm/accounting'
import type { Market } from '../../packages/prediction-core/types'

const owner = `0x${'01'.repeat(20)}`
const other = `0x${'02'.repeat(20)}`
const settlement = `0x${'03'.repeat(20)}` as const
const token = `0x${'04'.repeat(20)}` as const
const market: Market = { id: `0x${'05'.repeat(32)}`, matchId: `0x${'06'.repeat(32)}`, venue: 'EVM', chainId: '1', marketAddress: settlement, collateralToken: `0x${'07'.repeat(20)}`, collateralDecimals: 6, outcomes: [{ id: 0, label: 'A' }, { id: 1, label: 'B' }, { id: 2, label: 'C' }], status: 'TRADING', createdAt: 1000, tradingStartsAt: 1000, tradingLocksAt: 10000, expiresAt: 20000, paused: false }
function history() {
  const events: AccountingEvent[] = []
  let index = 0
  const add = (name: string, args: Record<string, unknown>, tx: string, emitter = settlement as string) => events.push({ name, args, emitter, transactionHash: tx, blockNumber: 1n, logIndex: index++ })
  add('MarketRegistered', { marketId: market.id, matchId: market.matchId, collateral: market.collateralToken, outcomeCount: 3 }, 'create')
  const set = (name: 'PositionSplit' | 'PositionMerged' | 'PositionRedeemed', amounts: bigint[], value: bigint, tx: string) => {
    add('TransferBatch', { operator: settlement, from: name === 'PositionSplit' ? zeroAddress : owner, to: name === 'PositionSplit' ? owner : zeroAddress, ids: [0, 1, 2].map(outcome => outcomeTokenId(market.id, outcome)), values: amounts }, tx, token)
    add(name, name === 'PositionRedeemed' ? { marketId: market.id, account: owner, collateralAmount: value, sharesBurned: amounts.reduce((sum, v) => sum + v, 0n) } : { marketId: market.id, account: owner, amount: value }, tx)
  }
  return { events, add, set }
}

test('average cost split/merge/sell/redemption conserves atomic dust and retains realized losses', () => {
  const h = history()
  h.set('PositionSplit', [11n, 11n, 11n], 11n, 'split')
  h.set('PositionMerged', [2n, 2n, 2n], 2n, 'merge')
  h.add('TransferSingle', { operator: settlement, from: owner, to: other, id: outcomeTokenId(market.id, 0), value: 3n }, 'sell', token)
  h.add('TradeExecuted', { marketId: market.id, buyer: other, seller: owner, outcomeId: 0, price: 500000n, quantity: 3n, collateralAmount: 2n }, 'sell')
  h.add('MarketResolved', { marketId: market.id, winningOutcomeId: 0 }, 'result')
  h.set('PositionRedeemed', [6n, 9n, 9n], 6n, 'redeem')
  const values = [...replayEvmAccounting(h.events, [market], owner, settlement, token, true).values()]
  expect(values.map(value => value.realizedPnl)).toEqual([5n, -3n, -3n])
  expect(values.every(value => value.complete && value.quantity === 0n && value.costBasis === 0n)).toBe(true)
  expect(values.reduce((sum, row) => sum + row.realizedPnl, 0n)).toBe(-1n)
})

test('void pays the actual receipt amount with deterministic proportional dust allocation', () => {
  const h = history()
  h.set('PositionSplit', [11n, 11n, 11n], 11n, 'split')
  h.add('MarketVoided', { marketId: market.id }, 'void')
  h.set('PositionRedeemed', [11n, 11n, 11n], 11n, 'redeem')
  const rows = [...replayEvmAccounting(h.events, [market], owner, settlement, token, true).values()]
  expect(rows.map(row => row.realizedPnl)).toEqual([0n, 0n, 0n])
  expect(rows.every(row => row.complete)).toBe(true)
})

test('unexplained incoming/outgoing transfers and missing history remain unknown after holdings reach zero', () => {
  const h = history()
  h.add('TransferSingle', { operator: other, from: other, to: owner, id: outcomeTokenId(market.id, 0), value: 5n }, 'in', token)
  h.add('TransferSingle', { operator: owner, from: owner, to: other, id: outcomeTokenId(market.id, 0), value: 5n }, 'out', token)
  const result = accountingFor(replayEvmAccounting(h.events, [market], owner, settlement, token, true), market.id, 0)!
  expect(result.quantity).toBe(0n)
  expect(result.complete).toBe(false)
  expect([...replayEvmAccounting(h.events.slice(1), [market], owner, settlement, token, true).values()].every(row => !row.complete)).toBe(true)
  expect([...replayEvmAccounting(h.events, [market], owner, settlement, token, false).values()].every(row => !row.complete)).toBe(true)
})

test('concurrent accounting reads share an incremental cache and reorgs force full replay', async () => {
  const ranges: Array<[bigint, bigint]> = []
  let fork = 'a'
  const client = {
    getCode: async () => undefined,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: `0x${fork}${blockNumber}` }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { ranges.push([fromBlock, toBlock]); return [] },
  } as unknown as ConstructorParameters<typeof EvmAccountingIndex>[0]
  const index = new EvmAccountingIndex(client, settlement, token)
  expect((await Promise.all([index.snapshot(5n), index.snapshot(5n)])).every(value => value.complete)).toBe(true)
  expect(ranges).toEqual([[0n, 5n]])
  await index.snapshot(6n)
  expect(ranges[1]).toEqual([6n, 6n])
  fork = 'b'
  await index.snapshot(7n)
  expect(ranges[2]).toEqual([0n, 7n])
})
