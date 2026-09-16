import { Connection, PublicKey } from '@solana/web3.js'
import type { Balance, Market, Outcome, SignedOrder } from '../../prediction-core/types'
import { effectiveMarket, integer, invariant, record, textField, validateMarket } from '../../prediction-core/validation'
import { decodeConfig, decodeMarket, decodeVault } from './accounts'
import { configAddress, TOKEN_PROGRAM_ID, vaultCollateralAddress } from './wire'
import { verifySolanaOrder, verifySolanaRequest, type SolanaVenueConfig } from './SolanaPredictionVenue'
import { predictionCollateralSymbol } from '../config'

export interface SolanaGatewayConfig {
  family: 'SOLANA'
  venue: 'SOLANA'
  /** The RPC genesis hash, rather than an ambiguous label such as "devnet". */
  chainId: string
  rpcUrl: string
  programId: string
  networkDomain: string
  collateralToken: string
  collateralDecimals: number
  collateralSymbol?: string
  oracleAuthority: string
  /** Trusted label registry; program state commits outcome count, not display names. */
  markets: Record<string, { matchId: string; outcomes: Outcome[] }>
}

export function parseSolanaConfig(input: unknown): SolanaGatewayConfig {
  const value = record(input)
  invariant(value.family === 'SOLANA' && value.venue === 'SOLANA', 'INVALID_CONFIG', 'Expected a Solana venue configuration.')
  const publicKey = (key: string) => new PublicKey(textField(value[key], key)).toBase58()
  const rpcUrl = new URL(textField(value.rpcUrl, 'rpcUrl', 2048))
  invariant(['http:', 'https:'].includes(rpcUrl.protocol), 'INVALID_CONFIG', 'RPC must use HTTP or HTTPS.')
  const networkDomain = textField(value.networkDomain, 'networkDomain')
  invariant(/^[0-9a-f]{64}$/.test(networkDomain), 'INVALID_CONFIG', 'networkDomain must be 32 bytes encoded as lowercase hex.')
  const markets = Object.fromEntries(Object.entries(record(value.markets)).map(([id, metadata]) => {
    new PublicKey(id)
    const row = record(metadata)
    const matchId = textField(row.matchId, 'matchId')
    invariant(/^0x[0-9a-f]{64}$/.test(matchId), 'INVALID_CONFIG', 'Registered matchId must match the program bytes32 identifier.')
    invariant(Array.isArray(row.outcomes) && row.outcomes.length >= 2 && row.outcomes.length <= 16, 'INVALID_CONFIG', 'Registered market needs 2–16 outcome labels.')
    const outcomes = row.outcomes.map((item, index) => {
      const outcome = record(item)
      invariant(outcome.id === index, 'INVALID_CONFIG', 'Outcome IDs must be contiguous from zero.')
      return { id: index, label: textField(outcome.label, 'label', 100), ...(outcome.entityId === undefined ? {} : { entityId: textField(outcome.entityId, 'entityId') }) }
    })
    return [id, { matchId, outcomes }]
  }))
  return { family: 'SOLANA', venue: 'SOLANA', chainId: publicKey('chainId'), rpcUrl: rpcUrl.toString(), programId: publicKey('programId'), networkDomain, collateralToken: publicKey('collateralToken'), collateralDecimals: integer(value.collateralDecimals, 'collateralDecimals', 0, 18), collateralSymbol: predictionCollateralSymbol(value.collateralSymbol), oracleAuthority: publicKey('oracleAuthority'), markets }
}

/** Pinocchio/SPL RPC boundary. Solana keeps funds in owner-controlled vault PDAs. */
export class SolanaChainGateway {
  private readonly connection: Connection
  private readonly deployment: SolanaVenueConfig
  constructor(readonly config: SolanaGatewayConfig, private readonly now = Date.now) {
    // web3 invokes fetch as a function; Bun's additional fetch.preconnect is not used here.
    const rpcFetch = ((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10_000) })) as typeof fetch
    this.connection = new Connection(config.rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: rpcFetch })
    this.deployment = { programId: config.programId, chainId: config.chainId, networkDomain: Uint8Array.from(config.networkDomain.match(/../g)!, value => parseInt(value, 16)), readAccount: async account => this.connection.getAccountInfo(account, 'confirmed'), now }
  }

  private async checkChain(): Promise<void> {
    invariant(await this.connection.getGenesisHash() === this.config.chainId, 'WRONG_CHAIN', 'RPC genesis hash does not match configured chain.')
  }
  private async account(address: PublicKey) {
    const info = await this.connection.getAccountInfo(address, 'confirmed')
    invariant(info, 'MISSING_ACCOUNT', 'Required Solana account does not exist.')
    return { address, owner: info.owner, data: info.data }
  }
  private async globalConfig() {
    const config = decodeConfig(await this.account(configAddress(this.config.programId)), this.config.programId)
    const domain = Array.from(config.networkDomain, value => value.toString(16).padStart(2, '0')).join('')
    invariant(domain === this.config.networkDomain && config.mint.toBase58() === this.config.collateralToken && config.oracle.toBase58() === this.config.oracleAuthority, 'WRONG_DEPLOYMENT', 'Solana config does not match this deployment.')
    return config
  }
  async getMarket(id: string): Promise<Market> {
    const metadata = this.config.markets[id]
    invariant(metadata, 'UNREGISTERED_MARKET', 'Market display metadata must be explicitly registered.')
    await this.checkChain()
    const [global, value, mint] = await Promise.all([
      this.globalConfig(),
      this.account(new PublicKey(id)).then(account => decodeMarket(account, this.config.programId)),
      this.account(new PublicKey(this.config.collateralToken)),
    ])
    invariant(mint.owner.equals(TOKEN_PROGRAM_ID) && mint.data.length === 82 && mint.data[45] === 1 && mint.data[44] === this.config.collateralDecimals, 'INVALID_COLLATERAL', 'Expected the configured classic SPL mint and decimals.')
    const matchId = `0x${Array.from(value.matchId, value => value.toString(16).padStart(2, '0')).join('')}`
    // Markets retain their creation-time oracle for layout compatibility. The
    // program authorizes settlement against global.oracle, which is rotatable.
    invariant(matchId === metadata.matchId && value.outcomeCount === metadata.outcomes.length && value.mint.equals(global.mint) && value.status >= 0 && value.status <= 4, 'WRONG_MARKET', 'Market state does not match registered metadata or collateral.')
    const market: Market = {
      matchingEngine: value.manifestGuarded ? 'MANIFEST' : 'CUSTOM',
      id, matchId, venue: 'SOLANA', chainId: this.config.chainId, marketAddress: id,
      collateralToken: this.config.collateralToken, collateralDecimals: this.config.collateralDecimals, outcomes: structuredClone(metadata.outcomes),
      status: (['PENDING', 'TRADING', 'LOCKED', 'RESOLVED', 'VOIDED'] as const)[value.status]!,
      createdAt: Number(value.createdAtSeconds) * 1000, tradingStartsAt: Number(value.startsAtSeconds) * 1000,
      tradingLocksAt: Number(value.locksAtSeconds) * 1000, expiresAt: Number(value.expirySeconds) * 1000,
      paused: global.paused || value.paused, ...(value.status === 3 ? { winningOutcomeId: value.winningOutcome } : {}),
    }
    validateMarket(market)
    return effectiveMarket(market, this.now())
  }
  async verifyOrder(order: Readonly<SignedOrder>): Promise<boolean> {
    await this.checkChain()
    await this.globalConfig()
    return verifySolanaOrder(order, this.deployment)
  }
  async verifyRequest(account: string, message: string, signature: string, request?: { method: string; path: string }): Promise<boolean> {
    await this.checkChain()
    await this.globalConfig()
    return verifySolanaRequest(account, message, signature, this.deployment, request)
  }
  async getBalance(account: string): Promise<Balance> {
    await this.checkChain()
    const global = await this.globalConfig()
    const vault = decodeVault(await this.account(new PublicKey(account)), this.config.programId)
    const expectedEscrow = vaultCollateralAddress(this.config.programId, account)
    invariant(vault.mint.equals(global.mint) && vault.escrow.equals(expectedEscrow), 'INVALID_VAULT', 'Vault uses another collateral or escrow account.')
    const escrow = await this.account(expectedEscrow)
    invariant(escrow.owner.equals(TOKEN_PROGRAM_ID) && escrow.data.length === 165 && new PublicKey(escrow.data.subarray(0, 32)).equals(global.mint) && new PublicKey(escrow.data.subarray(32, 64)).toBase58() === account, 'INVALID_ESCROW', 'Invalid SPL escrow owner or mint.')
    const collateral = new DataView(escrow.data.buffer, escrow.data.byteOffset, escrow.data.byteLength).getBigUint64(64, true)
    invariant(collateral >= vault.available, 'INVALID_ESCROW', 'Escrow does not cover the vault balance.')
    return { account, collateralToken: this.config.collateralToken, total: vault.available, available: vault.available, reserved: 0n }
  }
}
