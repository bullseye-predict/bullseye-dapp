import { decodeEventLog, encodeAbiParameters, keccak256, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from 'viem'
import type { Market } from '../../prediction-core/types'

export const ACCOUNTING_ABI = parseAbi([
  'event MarketRegistered(bytes32 indexed marketId,bytes32 indexed matchId,address collateral,uint8 outcomeCount)',
  'event PositionSplit(bytes32 indexed marketId,address indexed account,uint256 amount)',
  'event PositionMerged(bytes32 indexed marketId,address indexed account,uint256 amount)',
  'event PositionRedeemed(bytes32 indexed marketId,address indexed account,uint256 collateralAmount,uint256 sharesBurned)',
  'event TradeExecuted(bytes32 indexed marketId,bytes32 indexed buyOrderHash,bytes32 indexed sellOrderHash,address buyer,address seller,uint8 outcomeId,uint64 price,uint128 quantity,uint256 collateralAmount)',
  'event MarketResolved(bytes32 indexed marketId,uint8 winningOutcomeId,bytes32 stateHash)',
  'event MarketVoided(bytes32 indexed marketId,bytes32 stateHash)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)',
])
export interface AccountingEvent { name: string; args: Record<string, unknown>; emitter: string; transactionHash: string; blockNumber: bigint; logIndex: number }
export interface EvmAccountingPosition { quantity: bigint; costBasis: bigint; realizedPnl: bigint; complete: boolean }
const lower = (value: unknown) => String(value).toLowerCase()
const rowKey = (marketId: string, outcome: number) => JSON.stringify([marketId.toLowerCase(), outcome])
export const outcomeTokenId = (marketId: string, outcome: number): bigint => BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint8' }], [marketId as Hex, outcome])))

/** Equal split, or proportional allocation, with integer remainder assigned by outcome ID. */
function allocate(amount: bigint, weights: bigint[]): bigint[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0n)
  if (total === 0n) return weights.map(() => 0n)
  const parts = weights.map(weight => amount * weight / total)
  let remainder = amount - parts.reduce((sum, value) => sum + value, 0n)
  for (let index = 0; remainder > 0n && index < parts.length; index++) if (weights[index]! > 0n) { parts[index] = parts[index]! + 1n; remainder-- }
  return parts
}

/** Replay only supplies known costs when every token movement has an economic explanation. */
export function replayEvmAccounting(events: AccountingEvent[], markets: Market[], account: string, settlement: string, token: string, historyComplete: boolean): Map<string, EvmAccountingPosition> {
  const owner = account.toLowerCase()
  const rows = new Map<string, EvmAccountingPosition>()
  const byMarket = new Map(markets.map(market => [market.id.toLowerCase(), market]))
  const byToken = new Map<string, { marketId: string; outcome: number }>()
  const registered = new Set<string>()
  const outcomes = new Map<string, { winner?: number; voided?: boolean }>()
  for (const market of markets) for (const outcome of market.outcomes) {
    rows.set(rowKey(market.id, outcome.id), { quantity: 0n, costBasis: 0n, realizedPnl: 0n, complete: historyComplete })
    byToken.set(outcomeTokenId(market.id, outcome.id).toString(), { marketId: market.id, outcome: outcome.id })
  }
  const entries = (market: Market) => market.outcomes.map(outcome => rows.get(rowKey(market.id, outcome.id))!)
  const taint = (market: Market) => entries(market).forEach(row => { row.complete = false })
  const take = (row: EvmAccountingPosition, quantity: bigint): bigint => {
    if (quantity > row.quantity || quantity < 0n) { row.complete = false; row.quantity = 0n; row.costBasis = 0n; return 0n }
    const cost = quantity === row.quantity ? row.costBasis : row.costBasis * quantity / row.quantity
    row.quantity -= quantity; row.costBasis -= cost
    return cost
  }
  const groups = new Map<string, AccountingEvent[]>()
  for (const event of events) { const group = groups.get(event.transactionHash) ?? []; group.push(event); groups.set(event.transactionHash, group) }
  for (const group of groups.values()) {
    const actual = new Map<string, bigint>()
    const expected = new Map<string, bigint>()
    const transferKey = (operator: unknown, from: unknown, to: unknown, id: bigint) => JSON.stringify([lower(operator), lower(from), lower(to), id.toString()])
    const movement = (destination: Map<string, bigint>, operator: unknown, from: unknown, to: unknown, id: bigint, quantity: bigint) => {
      if (quantity === 0n || lower(from) === lower(to) || lower(from) !== owner && lower(to) !== owner || !byToken.has(id.toString())) return
      const key = transferKey(operator, from, to, id); destination.set(key, (destination.get(key) ?? 0n) + quantity)
    }
    const expectedMovement = (market: Market, outcome: number, from: string, to: string, quantity: bigint) => movement(expected, settlement, from, to, outcomeTokenId(market.id, outcome), quantity)
    for (const event of group) {
      const a = event.args
      if (event.emitter.toLowerCase() === token.toLowerCase()) {
        if (event.name === 'TransferSingle') movement(actual, a.operator, a.from, a.to, a.id as bigint, a.value as bigint)
        if (event.name === 'TransferBatch') (a.ids as bigint[]).forEach((id, index) => movement(actual, a.operator, a.from, a.to, id, (a.values as bigint[])[index]!))
        continue
      }
      if (event.emitter.toLowerCase() !== settlement.toLowerCase()) continue
      const market = byMarket.get(lower(a.marketId))
      if (!market) continue
      const positions = entries(market)
      if (event.name === 'MarketRegistered') {
        if (lower(a.matchId) !== market.matchId.toLowerCase() || lower(a.collateral) !== market.collateralToken.toLowerCase() || a.outcomeCount !== market.outcomes.length) taint(market)
        else registered.add(market.id.toLowerCase())
      } else if (event.name === 'MarketResolved') outcomes.set(market.id.toLowerCase(), { winner: Number(a.winningOutcomeId) })
      else if (event.name === 'MarketVoided') outcomes.set(market.id.toLowerCase(), { voided: true })
      else if (event.name === 'PositionSplit' && lower(a.account) === owner) {
        const amount = a.amount as bigint
        const costs = allocate(amount, positions.map(() => 1n))
        positions.forEach((row, outcome) => { row.quantity += amount; row.costBasis += costs[outcome]!; expectedMovement(market, outcome, zeroAddress, owner, amount) })
      } else if (event.name === 'PositionMerged' && lower(a.account) === owner) {
        const amount = a.amount as bigint
        const proceeds = allocate(amount, positions.map(() => 1n))
        positions.forEach((row, outcome) => { row.realizedPnl += proceeds[outcome]! - take(row, amount); expectedMovement(market, outcome, owner, zeroAddress, amount) })
      } else if (event.name === 'TradeExecuted' && (lower(a.buyer) === owner || lower(a.seller) === owner)) {
        const outcome = Number(a.outcomeId); const row = positions[outcome]
        if (!row) { taint(market); continue }
        const quantity = a.quantity as bigint; const collateral = a.collateralAmount as bigint; const price = a.price as bigint
        if (quantity <= 0n || collateral !== (quantity * price + 999999n) / 1000000n || lower(a.buyer) === lower(a.seller)) taint(market)
        if (lower(a.seller) === owner) row.realizedPnl += collateral - take(row, quantity)
        if (lower(a.buyer) === owner) { row.quantity += quantity; row.costBasis += collateral }
        expectedMovement(market, outcome, lower(a.seller), lower(a.buyer), quantity)
      } else if (event.name === 'PositionRedeemed' && lower(a.account) === owner) {
        const quantity = positions.reduce((sum, row) => sum + row.quantity, 0n)
        const payout = a.collateralAmount as bigint
        const result = outcomes.get(market.id.toLowerCase())
        if (quantity !== a.sharesBurned || !result || !result.voided && (result.winner === undefined || positions[result.winner]?.quantity !== payout)) taint(market)
        const proceeds = result?.voided ? allocate(payout, positions.map(row => row.quantity)) : positions.map((_row, index) => index === result?.winner ? payout : 0n)
        positions.forEach((row, outcome) => { expectedMovement(market, outcome, owner, zeroAddress, row.quantity); row.realizedPnl += proceeds[outcome]! - take(row, row.quantity) })
      }
    }
    // Comparing every ERC1155 edge detects unrelated transfers even when a transaction
    // also contains valid trading events. Missing logs cannot be silently costed as zero.
    for (const key of new Set([...expected.keys(), ...actual.keys()])) if (expected.get(key) !== actual.get(key)) {
      const [_operator, from, to, tokenId] = JSON.parse(key) as string[]
      const item = byToken.get(tokenId!)!
      const row = rows.get(rowKey(item.marketId, item.outcome))!
      row.complete = false
      const delta = (actual.get(key) ?? 0n) - (expected.get(key) ?? 0n)
      row.quantity += to === owner ? delta : from === owner ? -delta : 0n
    }
  }
  for (const market of markets) if (!registered.has(market.id.toLowerCase())) taint(market)
  return rows
}

/** Incremental in-process cache; a restart replays from the proven deployment boundary. */
export class EvmAccountingIndex {
  private events: AccountingEvent[] = []
  private through: bigint | undefined
  private throughHash: Hex | null = null
  private originSafe: boolean | undefined
  private exhausted = false
  private refreshing: Promise<{ events: AccountingEvent[]; complete: boolean }> | undefined
  constructor(private readonly client: Pick<PublicClient, 'getCode' | 'getBlock' | 'getLogs'>, private readonly settlement: Address, private readonly token: Address, private readonly start = 0n) {}
  async snapshot(blockNumber: bigint): Promise<{ events: AccountingEvent[]; complete: boolean }> {
    const current = (this.refreshing ?? Promise.resolve()).then(() => this.refresh(blockNumber))
    this.refreshing = current
    try { return await current } finally { if (this.refreshing === current) this.refreshing = undefined }
  }
  private async refresh(target: bigint): Promise<{ events: AccountingEvent[]; complete: boolean }> {
    try {
      if (this.through !== undefined && (this.through > target || (await this.client.getBlock({ blockNumber: this.through })).hash !== this.throughHash)) {
        this.events = []; this.through = undefined; this.originSafe = undefined; this.exhausted = false
      }
      if (this.originSafe === undefined) {
        const prior = await this.client.getCode({ address: this.settlement, blockNumber: this.start > 0n ? this.start - 1n : 0n })
        this.originSafe = !prior || prior === '0x'
      }
      if (!this.originSafe || this.exhausted) return { events: this.events, complete: false }
      let from = this.through === undefined ? this.start : this.through + 1n
      // Bound initial catch-up per request; incomplete catch-up returns unknown accounting.
      for (let batch = 0; from <= target && batch < 4; batch++) {
        const to = from + 1999n < target ? from + 1999n : target
        const logs = await this.client.getLogs({ address: [this.settlement, this.token], fromBlock: from, toBlock: to })
        const additions: AccountingEvent[] = []
        for (const log of logs) {
          if (log.removed || log.blockNumber === null || log.logIndex === null || !log.transactionHash) throw new Error('Unconfirmed accounting log')
          try {
            const event = decodeEventLog({ abi: ACCOUNTING_ABI, topics: log.topics, data: log.data, strict: true })
            additions.push({ name: event.eventName, args: event.args, emitter: log.address, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex })
          } catch { /* Approval and administrative logs do not affect position accounting. */ }
        }
        if (this.events.length + additions.length > 250000) { this.exhausted = true; break }
        additions.sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex)
        this.events.push(...additions)
        this.through = to; this.throughHash = (await this.client.getBlock({ blockNumber: to })).hash
        from = to + 1n
      }
      return { events: this.events, complete: this.originSafe && !this.exhausted && this.through === target }
    } catch { return { events: this.events, complete: false } }
  }
}

export function accountingFor(rows: Map<string, EvmAccountingPosition>, marketId: string, outcome: number): EvmAccountingPosition | undefined { return rows.get(rowKey(marketId, outcome)) }
