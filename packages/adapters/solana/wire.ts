import { Buffer } from 'buffer'
import { fixEncoderSize, getBytesEncoder, getI64Encoder, getStructEncoder, getU8Encoder } from '@solana/kit'
import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction, type AccountMeta } from '@solana/web3.js'

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111')
export const SOLANA_MAX_OUTCOMES = 16
export const SOLANA_PRICE_SCALE = 1_000_000n
export const ORDER_BODY_LENGTH = 138
export const FILL_DATA_LENGTH = 485
export const ORDER_DOMAIN = new TextEncoder().encode('SOLZ_PREDICTION_ORDER_V1')
export const CREATE_QUESTION_DOMAIN = new TextEncoder().encode('SOLZ_CREATE_QUESTION_V1')
export const CREATE_QUESTION_DATA_LENGTH = 201
export const INSTRUCTION = {
  initializeConfig: 0, createMarket: 1, initializeVault: 2, initializePosition: 3,
  deposit: 4, withdraw: 5, split: 6, merge: 7, redeem: 8, lockMarket: 9,
  resolveMarket: 10, voidMarket: 11, pauseGlobal: 12, pauseMarket: 13,
  authorizeAgent: 14, revokeAgent: 15, fillOrders: 16, initializeOrCancelNonce: 17,
  cancelAllOrders: 18,
  createQuestionMarket: 27,
  rotateOracle: 29,
  rotateAuthority: 30,
} as const
export type AddressInput = PublicKey | string
export const address = (value: AddressInput): PublicKey => typeof value === 'string' ? new PublicKey(value) : value
const encoder = new TextEncoder()
const keyBytes = (value: AddressInput) => address(value).toBytes()
export function fixedBytes(value: Uint8Array, length: number): Uint8Array {
  if (value.length !== length) throw new RangeError(`Expected ${length} bytes`)
  return Uint8Array.from(value)
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
export function u64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError('Value exceeds u64')
  const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, value, true); return bytes
}
export function timestampSeconds(value: bigint): Uint8Array {
  if (value < 0n || value > 0x7fff_ffff_ffff_ffffn) throw new RangeError('Timestamp exceeds nonnegative i64')
  return u64(value)
}
/** Round expiries down, never allowing the program to trade past an API cutoff. */
export function millisecondsToSeconds(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Expected nonnegative Unix milliseconds')
  return BigInt(Math.floor(value / 1000))
}
function byte(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Expected u8')
  return Uint8Array.of(value)
}
const flag = (value: boolean) => byte(Number(value))
const data = (tag: number, ...parts: Uint8Array[]) => concat(byte(tag), ...parts)
const meta = (value: AddressInput, isWritable = false, isSigner = false): AccountMeta => ({ pubkey: address(value), isWritable, isSigner })
const ix = (programId: AddressInput, keys: AccountMeta[], bytes: Uint8Array): TransactionInstruction => new TransactionInstruction({ programId: address(programId), keys, data: Buffer.from(bytes) })
const pda = (programId: AddressInput, ...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, address(programId))[0]
export const configAddress = (programId: AddressInput) => pda(programId, encoder.encode('prediction_config'))
export const marketAddress = (programId: AddressInput, matchId: Uint8Array) => pda(programId, encoder.encode('market'), fixedBytes(matchId, 32))
export const questionMarketAddress = (programId: AddressInput, matchId: Uint8Array, questionId: Uint8Array) => pda(programId, encoder.encode('market'), fixedBytes(matchId, 32), fixedBytes(questionId, 32))
export const vaultAddress = (programId: AddressInput, owner: AddressInput) => pda(programId, encoder.encode('agent_vault'), keyBytes(owner))
export const positionAddress = (programId: AddressInput, market: AddressInput, vault: AddressInput) => pda(programId, encoder.encode('position'), keyBytes(market), keyBytes(vault))
export const orderStateAddress = (programId: AddressInput, vault: AddressInput, nonce: bigint) => pda(programId, encoder.encode('order'), keyBytes(vault), u64(nonce))
export const vaultCollateralAddress = (programId: AddressInput, vault: AddressInput) => pda(programId, encoder.encode('vault_collateral'), keyBytes(vault))
export const marketCollateralAddress = (programId: AddressInput, market: AddressInput) => pda(programId, encoder.encode('market_collateral'), keyBytes(market))
/** Derived here rather than imported from ./manifest/wire, which imports this file. */
export const predictionManifestConfigAddress = (programId: AddressInput) => pda(programId, encoder.encode('manifest_config'))

export interface SolanaOrder {
  signer: AddressInput
  /** The user-owned AgentVault PDA is the maker; signer is its owner or session. */
  vault: AddressInput
  market: AddressInput
  outcomeId: number
  side: 'BUY' | 'SELL'
  price: bigint
  quantity: bigint
  nonce: bigint
  expirySeconds: bigint
  sessionEpoch: bigint
}
export function encodeOrderBody(order: SolanaOrder): Uint8Array {
  if (order.outcomeId < 0 || order.outcomeId >= SOLANA_MAX_OUTCOMES) throw new RangeError('Invalid outcome')
  if (order.side !== 'BUY' && order.side !== 'SELL') throw new TypeError('Invalid side')
  if (order.price <= 0n || order.price > SOLANA_PRICE_SCALE || order.quantity <= 0n) throw new RangeError('Invalid price or quantity')
  return concat(keyBytes(order.signer), keyBytes(order.vault), keyBytes(order.market), byte(order.outcomeId), byte(order.side === 'BUY' ? 0 : 1), u64(order.price), u64(order.quantity), u64(order.nonce), timestampSeconds(order.expirySeconds), u64(order.sessionEpoch))
}
/** Canonical preimage. Wallets sign its 32-byte SHA-256 digest, not this preimage. */
export function encodeOrderMessage(programId: AddressInput, networkDomain: Uint8Array, order: SolanaOrder): Uint8Array {
  return concat(ORDER_DOMAIN, keyBytes(programId), fixedBytes(networkDomain, 32), encodeOrderBody(order))
}
export async function orderDigest(programId: AddressInput, networkDomain: Uint8Array, order: SolanaOrder): Promise<Uint8Array> {
  const message = encodeOrderMessage(programId, networkDomain, order)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(message).buffer))
}
export async function questionCreationDigest(input: { programId: AddressInput; networkDomain: Uint8Array; payer: AddressInput; matchId: Uint8Array; questionId: Uint8Array; expirySeconds: bigint }): Promise<Uint8Array> {
  const message = concat(CREATE_QUESTION_DOMAIN, keyBytes(input.programId), fixedBytes(input.networkDomain, 32), keyBytes(input.payer), fixedBytes(input.matchId, 32), fixedBytes(input.questionId, 32), timestampSeconds(input.expirySeconds))
  return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(message).buffer))
}
export function encodeQuestionCreationEd25519Descriptor(createInstructionIndex: number): Uint8Array {
  if (!Number.isInteger(createInstructionIndex) || createInstructionIndex < 1 || createInstructionIndex > 65534) throw new RangeError('Invalid create instruction index')
  const result = new Uint8Array(16); result[0] = 1
  const view = new DataView(result.buffer)
  ;[137, createInstructionIndex, 65, createInstructionIndex, 105, 32, createInstructionIndex].forEach((field, index) => view.setUint16(2 + index * 2, field, true))
  return result
}
export function encodeEd25519Descriptors(fillInstructionIndex: number): Uint8Array {
  if (!Number.isInteger(fillInstructionIndex) || fillInstructionIndex < 1 || fillInstructionIndex > 65534) throw new RangeError('Invalid fill instruction index')
  const result = new Uint8Array(30); result[0] = 2
  const view = new DataView(result.buffer)
  const descriptors = [[357, fillInstructionIndex, 1, fillInstructionIndex, 293, 32, fillInstructionIndex], [421, fillInstructionIndex, 139, fillInstructionIndex, 325, 32, fillInstructionIndex]]
  descriptors.forEach((fields, i) => fields.forEach((field, j) => view.setUint16(2 + i * 14 + j * 2, field, true)))
  return result
}
export interface FillOrdersInput {
  programId: AddressInput
  networkDomain: Uint8Array
  buy: SolanaOrder
  sell: SolanaOrder
  buySignature: Uint8Array
  sellSignature: Uint8Array
  quantity: bigint
  executionPrice: bigint
  /** Position of Fill in the whole transaction, after any compute-budget instructions. */
  fillInstructionIndex?: number
}
/** Insert these instructions consecutively. Both positions and nonce PDAs must exist. */
export async function buildFillOrders(input: FillOrdersInput): Promise<[TransactionInstruction, TransactionInstruction]> {
  const { programId, buy, sell, quantity, executionPrice } = input
  if (buy.side !== 'BUY' || sell.side !== 'SELL' || !address(buy.market).equals(address(sell.market)) || buy.outcomeId !== sell.outcomeId || address(buy.vault).equals(address(sell.vault))) throw new Error('Orders do not match')
  if (quantity <= 0n || quantity > buy.quantity || quantity > sell.quantity || executionPrice < sell.price || executionPrice > buy.price) throw new RangeError('Invalid fill')
  const quote = (quantity * executionPrice + SOLANA_PRICE_SCALE - 1n) / SOLANA_PRICE_SCALE
  if (quote * SOLANA_PRICE_SCALE > quantity * buy.price) throw new RangeError('Atomic rounding exceeds buyer limit')
  const [buyHash, sellHash] = await Promise.all([orderDigest(programId, input.networkDomain, buy), orderDigest(programId, input.networkDomain, sell)])
  const payload = data(INSTRUCTION.fillOrders, encodeOrderBody(buy), encodeOrderBody(sell), u64(quantity), u64(executionPrice), buyHash, sellHash, fixedBytes(input.buySignature, 64), fixedBytes(input.sellSignature, 64))
  const keys = [meta(configAddress(programId)), meta(buy.market, true), meta(buy.vault, true), meta(sell.vault, true), meta(positionAddress(programId, buy.market, buy.vault), true), meta(positionAddress(programId, sell.market, sell.vault), true), meta(orderStateAddress(programId, buy.vault, buy.nonce), true), meta(orderStateAddress(programId, sell.vault, sell.nonce), true), meta(vaultCollateralAddress(programId, buy.vault), true), meta(vaultCollateralAddress(programId, sell.vault), true), meta(SYSVAR_INSTRUCTIONS_PUBKEY), meta(TOKEN_PROGRAM_ID)]
  return [ix(ED25519_PROGRAM_ID, [], encodeEd25519Descriptors(input.fillInstructionIndex ?? 1)), ix(programId, keys, payload)]
}
export function initializeConfig(programId: AddressInput, admin: AddressInput, collateralMint: AddressInput, oracle: AddressInput, networkDomain: Uint8Array): TransactionInstruction {
  return ix(programId, [meta(admin, true, true), meta(configAddress(programId), true), meta(collateralMint), meta(programId, false, true), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)], data(INSTRUCTION.initializeConfig, keyBytes(oracle), fixedBytes(networkDomain, 32)))
}
export function createMarket(programId: AddressInput, admin: AddressInput, collateralMint: AddressInput, input: { matchId: Uint8Array; outcomeCount: number; startsAtSeconds: bigint; locksAtSeconds: bigint; expirySeconds: bigint }): TransactionInstruction {
  if (input.outcomeCount < 2 || input.outcomeCount > SOLANA_MAX_OUTCOMES) throw new RangeError('Expected 2–16 outcomes')
  if (input.startsAtSeconds >= input.locksAtSeconds || input.locksAtSeconds >= input.expirySeconds) throw new RangeError('Invalid market times')
  const market = marketAddress(programId, input.matchId)
  return ix(programId, [meta(admin, true, true), meta(configAddress(programId)), meta(market, true), meta(marketCollateralAddress(programId, market), true), meta(collateralMint), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)], data(INSTRUCTION.createMarket, fixedBytes(input.matchId, 32), byte(input.outcomeCount), timestampSeconds(input.startsAtSeconds), timestampSeconds(input.locksAtSeconds), timestampSeconds(input.expirySeconds)))
}
export interface QuestionCreationPermit {
  authority: AddressInput
  expirySeconds: bigint
  digest: Uint8Array
  signature: Uint8Array
}
const questionCreationEncoder = getStructEncoder([
  ['tag', getU8Encoder()],
  ['matchId', fixEncoderSize(getBytesEncoder(), 32)],
  ['questionId', fixEncoderSize(getBytesEncoder(), 32)],
  ['authority', fixEncoderSize(getBytesEncoder(), 32)],
  ['expirySeconds', getI64Encoder()],
  ['digest', fixEncoderSize(getBytesEncoder(), 32)],
  ['signature', fixEncoderSize(getBytesEncoder(), 64)],
])
export function encodeQuestionCreationInstructionData(matchId: Uint8Array, questionId: Uint8Array, permit: QuestionCreationPermit): Uint8Array {
  const payload = questionCreationEncoder.encode({ tag:INSTRUCTION.createQuestionMarket, matchId:fixedBytes(matchId,32), questionId:fixedBytes(questionId,32), authority:keyBytes(permit.authority), expirySeconds:permit.expirySeconds, digest:fixedBytes(permit.digest,32), signature:fixedBytes(permit.signature,64) })
  if (payload.length !== CREATE_QUESTION_DATA_LENGTH) throw new Error('Invalid question creation payload')
  return Uint8Array.from(payload)
}
/** The first trader funds rent and submits both instructions. The backend only
 * signs the short-lived canonical question digest and never sends a transaction. */
export function buildCreateQuestionMarket(programId: AddressInput, payer: AddressInput, collateralMint: AddressInput, matchId: Uint8Array, questionId: Uint8Array, permit: QuestionCreationPermit, createInstructionIndex = 1): [TransactionInstruction, TransactionInstruction] {
  const market = questionMarketAddress(programId, matchId, questionId)
  const payload = encodeQuestionCreationInstructionData(matchId, questionId, permit)
  return [
    ix(ED25519_PROGRAM_ID, [], encodeQuestionCreationEd25519Descriptor(createInstructionIndex)),
    // The trailing manifest config decides the execution engine at creation, so
    // it cannot be raced for afterwards. Read-only, and unset on a deployment
    // that has not frozen a Manifest venue.
    ix(programId, [meta(payer, true, true), meta(configAddress(programId)), meta(market, true), meta(marketCollateralAddress(programId, market), true), meta(collateralMint), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID), meta(SYSVAR_INSTRUCTIONS_PUBKEY), meta(predictionManifestConfigAddress(programId))], payload),
  ]
}
export function initializeVault(programId: AddressInput, owner: AddressInput, collateralMint: AddressInput, maxCapital: bigint): TransactionInstruction {
  const vault = vaultAddress(programId, owner)
  return ix(programId, [meta(owner, true, true), meta(configAddress(programId)), meta(vault, true), meta(vaultCollateralAddress(programId, vault), true), meta(collateralMint), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)], data(INSTRUCTION.initializeVault, u64(maxCapital)))
}
export function initializePosition(programId: AddressInput, payer: AddressInput, market: AddressInput, vault: AddressInput): TransactionInstruction {
  return ix(programId, [meta(payer, true, true), meta(market), meta(vault), meta(positionAddress(programId, market, vault), true), meta(SystemProgram.programId)], data(INSTRUCTION.initializePosition))
}
export function moveVaultCollateral(programId: AddressInput, owner: AddressInput, ownerTokenAccount: AddressInput, amount: bigint, direction: 'deposit' | 'withdraw'): TransactionInstruction {
  const vault = vaultAddress(programId, owner); const escrow = vaultCollateralAddress(programId, vault)
  const source = direction === 'deposit' ? ownerTokenAccount : escrow; const destination = direction === 'deposit' ? escrow : ownerTokenAccount
  return ix(programId, [meta(owner, false, true), meta(configAddress(programId)), meta(vault, true), meta(source, true), meta(destination, true), meta(TOKEN_PROGRAM_ID)], data(INSTRUCTION[direction], u64(amount)))
}
export function changePosition(programId: AddressInput, actor: AddressInput, market: AddressInput, vault: AddressInput, operation: 'split' | 'merge' | 'redeem', amount?: bigint): TransactionInstruction {
  if (operation !== 'redeem' && (amount === undefined || amount <= 0n)) throw new RangeError('A positive amount is required')
  return ix(programId, [meta(actor, false, true), meta(configAddress(programId)), meta(market, true), meta(vault, true), meta(positionAddress(programId, market, vault), true), meta(vaultCollateralAddress(programId, vault), true), meta(marketCollateralAddress(programId, market), true), meta(TOKEN_PROGRAM_ID)], data(INSTRUCTION[operation], ...(operation === 'redeem' ? [] : [u64(amount!)])))
}
export function lockMarket(programId: AddressInput, actor: AddressInput, market: AddressInput): TransactionInstruction {
  return ix(programId, [meta(actor, false, true), meta(configAddress(programId)), meta(market, true)], data(INSTRUCTION.lockMarket))
}
export function resolveMarket(programId: AddressInput, oracle: AddressInput, market: AddressInput, winner: number, resultHash: Uint8Array, endedAtSeconds: bigint): TransactionInstruction {
  return ix(programId, [meta(oracle, false, true), meta(configAddress(programId)), meta(market, true)], data(INSTRUCTION.resolveMarket, byte(winner), fixedBytes(resultHash, 32), timestampSeconds(endedAtSeconds)))
}
export function voidMarket(programId: AddressInput, actor: AddressInput, market: AddressInput, resultHash: Uint8Array): TransactionInstruction {
  return ix(programId, [meta(actor, false, true), meta(configAddress(programId)), meta(market, true)], data(INSTRUCTION.voidMarket, fixedBytes(resultHash, 32)))
}
/** Admin-only recovery while globally paused. Replaces the resolver for every open market. */
export function rotateOracle(programId: AddressInput, admin: AddressInput, newOracle: AddressInput): TransactionInstruction {
  return ix(programId, [meta(admin, false, true), meta(configAddress(programId), true)], data(INSTRUCTION.rotateOracle, keyBytes(newOracle)))
}
/** Globally paused two-party handover. Both the current and replacement admin sign. */
export function rotateAuthority(programId: AddressInput, currentAdmin: AddressInput, newAdmin: AddressInput): TransactionInstruction {
  return ix(programId, [meta(currentAdmin, false, true), meta(newAdmin, false, true), meta(configAddress(programId), true)], data(INSTRUCTION.rotateAuthority))
}
export function setPause(programId: AddressInput, admin: AddressInput, paused: boolean, market?: AddressInput): TransactionInstruction {
  return ix(programId, [meta(admin, false, true), meta(configAddress(programId), market === undefined), ...(market === undefined ? [] : [meta(market, true)])], data(market === undefined ? INSTRUCTION.pauseGlobal : INSTRUCTION.pauseMarket, flag(paused)))
}
/** maxCapital is cumulative gross agent BUY spend per owner-authorized policy,
 * not the vault token balance; sells and additional deposits cannot refill it. */
export interface SessionPolicy { agent: AddressInput; maxCapital: bigint; maxOrderSize: bigint; maxExposure: bigint; expirySeconds: bigint }
export function authorizeAgent(programId: AddressInput, owner: AddressInput, policy: SessionPolicy): TransactionInstruction {
  if (policy.maxCapital <= 0n || policy.maxOrderSize <= 0n || policy.maxOrderSize > policy.maxCapital || policy.maxExposure <= 0n) throw new RangeError('Invalid session capital or exposure policy')
  return ix(programId, [meta(owner, false, true), meta(vaultAddress(programId, owner), true)], data(INSTRUCTION.authorizeAgent, keyBytes(policy.agent), u64(policy.maxCapital), u64(policy.maxOrderSize), u64(policy.maxExposure), timestampSeconds(policy.expirySeconds)))
}
export function revokeAgent(programId: AddressInput, owner: AddressInput): TransactionInstruction {
  return ix(programId, [meta(owner, false, true), meta(vaultAddress(programId, owner), true)], data(INSTRUCTION.revokeAgent))
}
export function cancelAllOrders(programId: AddressInput, owner: AddressInput): TransactionInstruction {
  return ix(programId, [meta(owner, false, true), meta(vaultAddress(programId, owner), true)], data(INSTRUCTION.cancelAllOrders))
}
export function initializeOrCancelNonce(programId: AddressInput, payerOrAuthorizedSigner: AddressInput, vault: AddressInput, nonce: bigint, cancel = false): TransactionInstruction {
  return ix(programId, [meta(payerOrAuthorizedSigner, true, true), meta(vault), meta(orderStateAddress(programId, vault, nonce), true), meta(SystemProgram.programId)], data(INSTRUCTION.initializeOrCancelNonce, u64(nonce), flag(cancel)))
}
