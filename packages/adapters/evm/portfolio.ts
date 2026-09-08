import { createPublicClient, http, isAddress, parseAbi } from 'viem'
import type { EvmVenueConfig } from '../config'
import type { Market } from '../../prediction-core/types'
import type { PortfolioPosition } from '../../prediction-core/market-data'
import { invariant } from '../../prediction-core/validation'
import { accountingFor, EvmAccountingIndex, outcomeTokenId, replayEvmAccounting } from './accounting'

const ABI = parseAbi([
  'function outcomeToken() view returns(address)',
  'function settlement() view returns(address)',
  'function balanceOfBatch(address[] accounts,uint256[] ids) view returns(uint256[])',
])

/** Quantities include direct ERC1155 transfers; acquisition costs need a complete transfer index. */
export class EvmChainPortfolio {
  readonly client
  private accounting: EvmAccountingIndex | undefined
  constructor(readonly config: EvmVenueConfig, private readonly options: { confirmations?: number; maxBlockAgeMs?: number; discoveryStartBlock?: bigint; now?: () => number } = {}) {
    this.client = createPublicClient({ transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 1 }) })
  }
  async readPositions(account: string, markets: Market[]): Promise<PortfolioPosition[]> {
    invariant(isAddress(account) && String(await this.client.getChainId()) === this.config.chainId, 'WRONG_CHAIN', 'Invalid account or RPC chain.')
    const confirmations = this.options.confirmations ?? 2
    invariant(Number.isSafeInteger(confirmations) && confirmations >= 1, 'INVALID_CONFIG', 'Invalid confirmation count.')
    const head = await this.client.getBlockNumber({ cacheTime: 0 })
    invariant(head >= BigInt(confirmations - 1), 'CHAIN_NOT_READY', 'Insufficient chain confirmations.')
    const blockNumber = head - BigInt(confirmations - 1)
    const block = await this.client.getBlock({ blockNumber })
    const now = (this.options.now ?? Date.now)()
    invariant(Number(block.timestamp) * 1000 >= now - (this.options.maxBlockAgeMs ?? 120_000), 'STALE_CHAIN', 'RPC has not produced a fresh confirmed block.')
    const [token, settlement] = await Promise.all([
      this.client.readContract({ address: this.config.settlementAddress, abi: ABI, functionName: 'outcomeToken', blockNumber }),
      this.client.readContract({ address: this.config.factoryAddress, abi: ABI, functionName: 'settlement', blockNumber }),
    ])
    invariant(settlement.toLowerCase() === this.config.settlementAddress.toLowerCase(), 'WRONG_DEPLOYMENT', 'Factory points to a different settlement.')
    const rows = markets.flatMap(market => {
      invariant(market.venue === this.config.venue && market.chainId === this.config.chainId && market.marketAddress.toLowerCase() === settlement.toLowerCase() && market.collateralToken.toLowerCase() === this.config.collateralToken.toLowerCase(), 'WRONG_MARKET', 'Portfolio market belongs to another deployment.')
      return market.outcomes.map(outcome => ({ market, outcome, tokenId: outcomeTokenId(market.id, outcome.id) }))
    })
    const positions: PortfolioPosition[] = []
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100)
      const balances = await this.client.readContract({ address: token, abi: ABI, functionName: 'balanceOfBatch', args: [batch.map(() => account), batch.map(row => row.tokenId)], blockNumber })
      invariant(balances.length === batch.length, 'INVALID_RPC', 'Incomplete token balance response.')
      batch.forEach(({ market, outcome }, index) => positions.push({ account, venue: this.config.venue, chainId: this.config.chainId, marketId: market.id, outcomeId: outcome.id, quantity: balances[index]!, reservedQuantity: 0n, costBasis: null, realizedPnl: null, accountingComplete: false, provenance: { source: 'ONCHAIN', observedAt: now, finality: 'CONFIRMED', blockNumber: blockNumber.toString() } }))
    }
    this.accounting ??= new EvmAccountingIndex(this.client, this.config.settlementAddress, token, this.options.discoveryStartBlock ?? 0n)
    const history = await this.accounting.snapshot(blockNumber)
    const accounting = replayEvmAccounting(history.events, markets, account, settlement, token, history.complete)
    invariant((await this.client.getBlock({ blockNumber })).hash === block.hash, 'REORG_DURING_READ', 'Chain changed during portfolio read; retry.')
    return positions.map(position => {
      const value = accountingFor(accounting, position.marketId, position.outcomeId)
      return value?.complete && value.quantity === position.quantity ? { ...position, costBasis: value.costBasis, realizedPnl: value.realizedPnl, accountingComplete: true } : position
    })
  }
}
