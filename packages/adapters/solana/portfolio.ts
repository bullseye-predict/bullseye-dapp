import { Connection, PublicKey } from '@solana/web3.js'
import type { Market } from '../../prediction-core/types'
import type { PortfolioPosition } from '../../prediction-core/market-data'
import { invariant } from '../../prediction-core/validation'
import type { SolanaGatewayConfig } from './gateway'
import { decodeConfig, decodeMarket, decodePosition, decodeVault } from './accounts'
import { configAddress, positionAddress, TOKEN_PROGRAM_ID } from './wire'
import { SolanaAccountingReader, type AccountingMarket, type SolanaAccountingOptions } from './accounting'

/** Finalized PDA snapshots plus complete, reconciled direct-program history where available. */
export class SolanaChainPortfolio {
  readonly connection: Connection
  private readonly accounting: SolanaAccountingReader
  constructor(readonly config: SolanaGatewayConfig, private readonly options: { maxBlockAgeMs?: number; now?: () => number } & SolanaAccountingOptions = {}) {
    this.connection = new Connection(config.rpcUrl, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })) as typeof fetch })
    this.accounting = new SolanaAccountingReader(this.connection, config.programId, config.collateralToken, options)
  }
  async readPositions(account: string, markets: Market[]): Promise<PortfolioPosition[]> {
    invariant(await this.connection.getGenesisHash() === this.config.chainId, 'WRONG_CHAIN', 'RPC genesis hash differs from configuration.')
    const vault = new PublicKey(account)
    const positions: PortfolioPosition[] = []
    const accountingMarkets: AccountingMarket[] = []
    let vaultExists = false
    let minContextSlot = 0
    // Each batch binds its vault, config, mint, markets and positions to ONE finalized slot.
    for (let offset = 0; offset < Math.max(markets.length, 1); offset += 40) {
      const batch = markets.slice(offset, offset + 40)
      const keys = [configAddress(this.config.programId), vault, new PublicKey(this.config.collateralToken), ...batch.flatMap(market => [new PublicKey(market.id), positionAddress(this.config.programId, market.id, vault)])]
      const snapshot = await this.connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'finalized', minContextSlot })
      minContextSlot = snapshot.context.slot
      const blockTime = await this.connection.getBlockTime(snapshot.context.slot)
      const now = (this.options.now ?? Date.now)()
      invariant(blockTime !== null && blockTime * 1000 >= now - (this.options.maxBlockAgeMs ?? 120_000), 'STALE_CHAIN', 'RPC has no fresh finalized slot.')
      const configInfo = snapshot.value[0]; const vaultInfo = snapshot.value[1]; const mintInfo = snapshot.value[2]
      invariant(configInfo && mintInfo, 'MISSING_DEPLOYMENT', 'Configured program or collateral is unavailable.')
      const global = decodeConfig({ ...configInfo, address: keys[0]! }, this.config.programId)
      invariant(global.mint.toBase58() === this.config.collateralToken && global.oracle.toBase58() === this.config.oracleAuthority && Buffer.from(global.networkDomain).toString('hex') === this.config.networkDomain && mintInfo.owner.equals(TOKEN_PROGRAM_ID) && mintInfo.data.length === 82 && mintInfo.data[45] === 1 && mintInfo.data[44] === this.config.collateralDecimals, 'WRONG_DEPLOYMENT', 'Collateral, oracle or domain does not match configuration.')
      if (vaultInfo) invariant(decodeVault({ ...vaultInfo, address: vault }, this.config.programId).mint.equals(global.mint), 'WRONG_VAULT', 'Vault uses another collateral.')
      vaultExists ||= vaultInfo !== null
      batch.forEach((market, index) => {
        const marketInfo = snapshot.value[3 + index * 2]; const positionInfo = snapshot.value[4 + index * 2]
        invariant(market.venue === 'SOLANA' && market.chainId === this.config.chainId && marketInfo, 'WRONG_MARKET', 'Portfolio market is missing or belongs to another chain.')
        const value = decodeMarket({ ...marketInfo, address: market.id }, this.config.programId)
        // `value.oracle` is the creation-time key. Resolution authority is
        // global.oracle, so an oracle rotation must not invalidate a market.
        invariant(value.mint.equals(global.mint) && value.outcomeCount === market.outcomes.length && `0x${Buffer.from(value.matchId).toString('hex')}` === market.matchId, 'WRONG_MARKET', 'Market deployment or metadata differs from chain state.')
        accountingMarkets.push({ id: market.id, outcomes: value.outcomeCount, slot: snapshot.context.slot, status: value.status, winner: value.winningOutcome })
        const position = positionInfo ? decodePosition({ ...positionInfo, address: keys[4 + index * 2]! }, this.config.programId) : undefined
        invariant(!position || vaultInfo && position.vault.equals(vault) && position.market.toBase58() === market.id, 'WRONG_POSITION', 'Position is bound to another vault or market.')
        for (const outcome of market.outcomes) positions.push({ account, venue: 'SOLANA', chainId: this.config.chainId, marketId: market.id, outcomeId: outcome.id, quantity: position?.balances[outcome.id] ?? 0n, reservedQuantity: 0n, costBasis: null, realizedPnl: null, accountingComplete: false, provenance: { source: 'ONCHAIN', observedAt: now, finality: 'FINALIZED', slot: snapshot.context.slot } })
      })
    }
    const result = await this.accounting.attach(account, accountingMarkets, positions, vaultExists)
    invariant(positions.every(position => position.provenance!.observedAt >= (this.options.now ?? Date.now)() - (this.options.maxBlockAgeMs ?? 120_000)), 'STALE_CHAIN', 'Position snapshots expired while reconstructing history; retry.')
    return result
  }
}
