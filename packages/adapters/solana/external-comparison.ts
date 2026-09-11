import BN from 'bn.js'
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, unpackMint } from '@solana/spl-token'
import { createBatchUpdateInstruction, createClaimSeatInstruction, createCreateMarketInstruction, getVaultAddress, ManifestClient, Market, OrderType } from '@bonasa-tech/manifest-sdk'
import { ActivationType, BaseFeeMode, CollectFeeMode, CpAmm, CP_AMM_PROGRAM_ID, getBaseFeeParams, MAX_SQRT_PRICE, MIN_SQRT_PRICE } from '@meteora-ag/cp-amm-sdk'
import { decodeConfig, decodeMarket } from './accounts'
import { outcomeMintAddress, type BinaryOutcome } from './outcome-tokens'
import { concat, configAddress, TOKEN_PROGRAM_ID, u64 } from './wire'
import { Buffer } from 'buffer'

export const MANIFEST_PROGRAM_ID = new PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms')
export interface ComparisonMarket {
  programId: PublicKey
  predictionMarket: PublicKey
  collateralMint: PublicKey
  outcome: BinaryOutcome
}
export const EXTERNAL_VENUE_READINESS = Object.freeze({
  productionReady: false,
  blockers: [
    'Direct venue execution does not enforce the prediction cutoff or pause.',
    'Direct venue execution does not collect a mandatory SOLZ platform fee.',
    'Production deployment, funded liquidity, indexer and wallet integration are not verified.',
  ],
})
export function requireLocalComparison(connection: Pick<Connection, 'rpcEndpoint'>): void {
  const url = new URL(connection.rpcEndpoint)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External comparison adapters accept only a local validator; production trading is unavailable')
}
const amount = (value: bigint): BN => { u64(value); if (value <= 0n) throw new RangeError('Expected a positive atomic amount'); return new BN(value.toString()) }

/** SDK 0.2.46's generated core deposit/withdraw encoders append the optional
 * trader hint twice. Rust expects exactly u64 + Option<u32>; reject extra data.
 * https://github.com/Bonasa-Tech/manifest/blob/main/programs/manifest/src/program/processor/deposit.rs
 */
export function manifestTokenMovement(payer: PublicKey, market: PublicKey, mint: PublicKey, atoms: bigint, direction: 'deposit' | 'withdraw'): TransactionInstruction {
  if (direction !== 'deposit' && direction !== 'withdraw') throw new TypeError('Invalid token direction')
  amount(atoms)
  const keys = [payer, market, getAssociatedTokenAddressSync(mint, payer), getVaultAddress(market, mint), TOKEN_PROGRAM_ID, mint].map((pubkey, index) => ({ pubkey, isSigner: index === 0, isWritable: index < 4 }))
  return new TransactionInstruction({ programId: MANIFEST_PROGRAM_ID, keys, data: Buffer.from(concat(Uint8Array.of(direction === 'deposit' ? 2 : 3), u64(atoms), Uint8Array.of(0))) })
}

abstract class ComparisonAdapter {
  readonly baseMint: PublicKey
  constructor(protected readonly connection: Connection, readonly binding: ComparisonMarket) {
    requireLocalComparison(connection)
    this.baseMint = outcomeMintAddress(binding.programId, binding.predictionMarket, binding.outcome)
  }
  /** Validate the claim against the prediction program, not ticker/metadata. */
  protected async validate(trading: boolean): Promise<void> {
    const b = this.binding
    const keys = [configAddress(b.programId), b.predictionMarket, this.baseMint, b.collateralMint]
    const records = await this.connection.getMultipleAccountsInfo(keys, 'confirmed')
    if (records.some(record => !record)) throw new Error('Prediction state or token mint is missing')
    const config = decodeConfig({ ...records[0]!, address: keys[0]! }, b.programId)
    const market = decodeMarket({ ...records[1]!, address: b.predictionMarket }, b.programId)
    const base = unpackMint(this.baseMint, records[2]!, TOKEN_PROGRAM_ID)
    const quote = unpackMint(b.collateralMint, records[3]!, TOKEN_PROGRAM_ID)
    if (!config.mint.equals(b.collateralMint) || !market.mint.equals(b.collateralMint) || market.outcomeCount !== 2 || base.decimals !== 6 || quote.decimals !== 6 || !base.mintAuthority?.equals(b.predictionMarket) || base.freezeAuthority !== null) throw new Error('Expected canonical six-decimal binary claims and configured USDC collateral')
    if (trading) {
      const slot = await this.connection.getSlot('confirmed')
      const now = await this.connection.getBlockTime(slot)
      if (now === null || config.paused || market.paused || market.status > 1 || BigInt(now) < market.startsAtSeconds || BigInt(now) >= market.locksAtSeconds) throw new Error('Prediction market is not accepting trades')
    }
  }
}

/** Classic SPL/core Manifest; integer quantities/prices avoid SDK float rounding. */
export class ManifestComparisonAdapter extends ComparisonAdapter {
  async create(payer: PublicKey, venueMarket: PublicKey): Promise<Transaction> {
    await this.validate(true)
    const lamports = await this.connection.getMinimumBalanceForRentExemption(256)
    return new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: venueMarket, lamports, space: 256, programId: MANIFEST_PROGRAM_ID }),
      createCreateMarketInstruction({ payer, market: venueMarket, baseMint: this.baseMint, quoteMint: this.binding.collateralMint, baseVault: getVaultAddress(venueMarket, this.baseMint), quoteVault: getVaultAddress(venueMarket, this.binding.collateralMint), tokenProgram22: TOKEN_2022_PROGRAM_ID }),
    )
  }
  async read(venueMarket: PublicKey): Promise<Market> {
    const record = await this.connection.getAccountInfo(venueMarket, 'confirmed')
    if (!record?.owner.equals(MANIFEST_PROGRAM_ID)) throw new Error('Not a Manifest market')
    const market = Market.loadFromBuffer({ address: venueMarket, buffer: record.data })
    if (!market.baseMint().equals(this.baseMint) || !market.quoteMint().equals(this.binding.collateralMint)) throw new Error('Manifest market contains another token pair')
    return market
  }
  async deposit(payer: PublicKey, venueMarket: PublicKey, asset: 'outcome' | 'USDC', atoms: bigint): Promise<Transaction> {
    amount(atoms)
    await this.validate(true)
    const market = await this.read(venueMarket)
    const mint = asset === 'outcome' ? this.baseMint : this.binding.collateralMint
    const tx = new Transaction()
    if (!market.hasSeat(payer)) tx.add(createClaimSeatInstruction({ payer, market: venueMarket }))
    return tx.add(manifestTokenMovement(payer, venueMarket, mint, atoms, 'deposit'))
  }
  async limitOrder(payer: PublicKey, venueMarket: PublicKey, side: 'BUY' | 'SELL', quantity: bigint, priceMicros: bigint, lastValidSlot: number): Promise<Transaction> {
    const baseAtoms = amount(quantity)
    if (side !== 'BUY' && side !== 'SELL') throw new TypeError('Invalid side')
    if (priceMicros <= 0n || priceMicros >= 1_000_000n) throw new RangeError('Price must be between zero and one USDC')
    if (!Number.isInteger(lastValidSlot) || lastValidSlot <= 0 || lastValidSlot > 0xffff_ffff) throw new RangeError('A finite order-expiry slot is required; this is not a timestamp cutoff guarantee')
    await this.validate(true); await this.read(venueMarket)
    return new Transaction().add(createBatchUpdateInstruction({ payer, market: venueMarket }, { params: { traderIndexHint: null, cancels: [], orders: [{ baseAtoms, priceMantissa: Number(priceMicros), priceExponent: -6, isBid: side === 'BUY', lastValidSlot, orderType: OrderType.Limit }] } }))
  }
  async cancel(payer: PublicKey, venueMarket: PublicKey, sequence: bigint): Promise<Transaction> {
    u64(sequence); await this.validate(false); await this.read(venueMarket)
    return new Transaction().add(createBatchUpdateInstruction({ payer, market: venueMarket }, { params: { traderIndexHint: null, cancels: [{ orderSequenceNumber: new BN(sequence.toString()), orderIndexHint: null }], orders: [] } }))
  }
  async withdraw(payer: PublicKey, venueMarket: PublicKey, asset: 'outcome' | 'USDC', atoms: bigint): Promise<Transaction> {
    amount(atoms)
    await this.validate(false); await this.read(venueMarket)
    const mint = asset === 'outcome' ? this.baseMint : this.binding.collateralMint
    return new Transaction().add(manifestTokenMovement(payer, venueMarket, mint, atoms, 'withdraw'))
  }
  async swap(payer: PublicKey, venueMarket: PublicKey, side: 'BUY' | 'SELL', inputAtoms: bigint, minimumOutputAtoms: bigint): Promise<Transaction> {
    const inAtoms = amount(inputAtoms); const outAtoms = amount(minimumOutputAtoms)
    if (side !== 'BUY' && side !== 'SELL') throw new TypeError('Invalid side')
    await this.validate(true); await this.read(venueMarket)
    const client = await ManifestClient.getClientReadOnly(this.connection, venueMarket)
    return new Transaction().add(client.swapIx(payer, { inAtoms, outAtoms, isBaseIn: side === 'SELL', isExactIn: true }))
  }
}

/** DAMM v2 is the simple AMM comparison; DLMM bin management is a separate integration. */
export class MeteoraComparisonAdapter extends ComparisonAdapter {
  private readonly amm = new CpAmm(this.connection)
  async create(payer: PublicKey, positionNft: PublicKey, outcomeAtoms: bigint, usdcAtoms: bigint, swapFeeBps: number) {
    const tokenAAmount = amount(outcomeAtoms); const tokenBAmount = amount(usdcAtoms)
    if (usdcAtoms >= outcomeAtoms) throw new RangeError('Initial outcome price must be below one USDC')
    if (!Number.isInteger(swapFeeBps) || swapFeeBps < 1 || swapFeeBps > 100) throw new RangeError('Comparison swap fee must be explicitly selected between 1 and 100 bps')
    await this.validate(true)
    const prepared = this.amm.preparePoolCreationParams({ tokenAAmount, tokenBAmount, minSqrtPrice: MIN_SQRT_PRICE, maxSqrtPrice: MAX_SQRT_PRICE, collectFeeMode: CollectFeeMode.BothToken })
    return this.amm.createCustomPool({ payer, creator: payer, positionNft, tokenAMint: this.baseMint, tokenBMint: this.binding.collateralMint, tokenAAmount, tokenBAmount, sqrtMinPrice: MIN_SQRT_PRICE, sqrtMaxPrice: MAX_SQRT_PRICE, ...prepared, poolFees: { baseFee: getBaseFeeParams({ baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear, feeTimeSchedulerParam: { startingFeeBps: swapFeeBps, endingFeeBps: swapFeeBps, numberOfPeriod: 0, totalDuration: 0 } }), compoundingFeeBps: 0, padding: 0, dynamicFee: null }, hasAlphaVault: false, activationType: ActivationType.Timestamp, activationPoint: null, collectFeeMode: CollectFeeMode.BothToken, tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, isLockLiquidity: false })
  }
  async read(pool: PublicKey) {
    const record = await this.connection.getAccountInfo(pool, 'confirmed')
    if (!record?.owner.equals(CP_AMM_PROGRAM_ID)) throw new Error('Not a Meteora DAMM v2 pool')
    const state = await this.amm.fetchPoolState(pool)
    if (!state.tokenAMint.equals(this.baseMint) || !state.tokenBMint.equals(this.binding.collateralMint)) throw new Error('Meteora pool contains another token pair or orientation')
    return state
  }
  async quote(pool: PublicKey, side: 'BUY' | 'SELL', inputAtoms: bigint, slippagePercent: number) {
    const inAmount = amount(inputAtoms)
    if (side !== 'BUY' && side !== 'SELL') throw new TypeError('Invalid side')
    if (!Number.isFinite(slippagePercent) || slippagePercent < 0 || slippagePercent > 5) throw new RangeError('Comparison slippage must be between zero and five percent')
    await this.validate(true)
    const poolState = await this.read(pool)
    const currentSlot = await this.connection.getSlot('confirmed')
    const currentTime = await this.connection.getBlockTime(currentSlot)
    if (currentTime === null) throw new Error('Chain time unavailable')
    return this.amm.getQuote({ inAmount, inputTokenMint: side === 'BUY' ? this.binding.collateralMint : this.baseMint, slippage: slippagePercent, poolState, currentSlot, currentTime, tokenADecimal: 6, tokenBDecimal: 6, hasReferral: false })
  }
  async swap(payer: PublicKey, pool: PublicKey, side: 'BUY' | 'SELL', inputAtoms: bigint, minimumOutputAtoms: bigint): Promise<Transaction> {
    const amountIn = amount(inputAtoms); const minimumAmountOut = amount(minimumOutputAtoms)
    if (side !== 'BUY' && side !== 'SELL') throw new TypeError('Invalid side')
    await this.validate(true)
    const state = await this.read(pool)
    return this.amm.swap({ payer, pool, inputTokenMint: side === 'BUY' ? this.binding.collateralMint : this.baseMint, outputTokenMint: side === 'BUY' ? this.baseMint : this.binding.collateralMint, amountIn, minimumAmountOut, tokenAMint: this.baseMint, tokenBMint: this.binding.collateralMint, tokenAVault: state.tokenAVault, tokenBVault: state.tokenBVault, tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, referralTokenAccount: null, poolState: state })
  }
  async removeLiquidity(owner: PublicKey, pool: PublicKey, position: PublicKey, positionNftAccount: PublicKey, minOutcomeAtoms: bigint, minUsdcAtoms: bigint): Promise<Transaction> {
    u64(minOutcomeAtoms); u64(minUsdcAtoms)
    await this.validate(false)
    const poolState = await this.read(pool)
    const positionState = await this.amm.fetchPositionState(position)
    if (!positionState.pool.equals(pool)) throw new Error('LP position belongs to another pool')
    const now = await this.connection.getBlockTime(await this.connection.getSlot('confirmed'))
    if (now === null) throw new Error('Chain time unavailable')
    return this.amm.removeAllLiquidityAndClosePosition({ owner, position, positionNftAccount, poolState, positionState, tokenAAmountThreshold: new BN(minOutcomeAtoms.toString()), tokenBAmountThreshold: new BN(minUsdcAtoms.toString()), vestings: [], currentPoint: new BN(now), isSkipReward: false })
  }
}

/** Account allocation deposits and transaction fees are separate from LP capital. */
export async function quoteAccountRent(connection: Connection, accounts: { name: string; bytes: number; count: number }[]) {
  return Promise.all(accounts.map(async item => ({ ...item, lamports: BigInt(await connection.getMinimumBalanceForRentExemption(item.bytes)) * BigInt(item.count) })))
}
