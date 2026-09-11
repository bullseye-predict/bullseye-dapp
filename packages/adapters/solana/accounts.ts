import { PublicKey } from '@solana/web3.js'
import { address, configAddress, marketAddress, orderStateAddress, positionAddress, questionMarketAddress, vaultAddress, type AddressInput } from './wire'

export interface SolanaAccountRecord { address: AddressInput; owner: AddressInput; data: Uint8Array }
class Reader {
  private offset = 8
  private view: DataView
  constructor(private readonly bytes: Uint8Array, tag: string, length: number) {
    if (bytes.length !== length || new TextDecoder().decode(bytes.subarray(0, 8)) !== tag) throw new Error('Invalid Solana account layout')
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  key(): PublicKey { return new PublicKey(this.take(32)) }
  take(length: number): Uint8Array { const result = this.bytes.slice(this.offset, this.offset + length); this.offset += length; return result }
  u8(): number { return this.take(1)[0]! }
  bool(): boolean { const v = this.u8(); if (v > 1) throw new Error('Invalid boolean'); return v === 1 }
  u64(): bigint { const v = this.view.getBigUint64(this.offset, true); this.offset += 8; return v }
  i64(): bigint { const v = this.view.getBigInt64(this.offset, true); this.offset += 8; return v }
  u128(): bigint { const low = this.u64(); return low + (this.u64() << 64n) }
}
function read(account: SolanaAccountRecord, programId: AddressInput, tag: string, length: number): Reader {
  if (!address(account.owner).equals(address(programId))) throw new Error('Account belongs to another program')
  return new Reader(account.data, tag, length)
}
function requireAddress(account: SolanaAccountRecord, expected: PublicKey): void {
  if (!address(account.address).equals(expected)) throw new Error('Noncanonical account PDA')
}
export function decodeConfig(account: SolanaAccountRecord, programId: AddressInput) {
  const r = read(account, programId, 'SOLZCFG1', 138)
  requireAddress(account, configAddress(programId))
  return { authority: r.key(), oracle: r.key(), mint: r.key(), networkDomain: r.take(32), paused: r.bool(), bump: r.u8() }
}
export function decodeVault(account: SolanaAccountRecord, programId: AddressInput) {
  const r = read(account, programId, 'SOLZVLT2', 203)
  const value = { owner: r.key(), agent: r.key(), mint: r.key(), escrow: r.key(), available: r.u64(), exposure: r.u64(), maxCapital: r.u64(), maxOrderSize: r.u64(), maxExposure: r.u64(), expirySeconds: r.i64(), sessionEpoch: r.u64(), enabled: r.bool(), bump: r.u8(), escrowBump: r.u8(), spentCapital: r.u64() }
  requireAddress(account, vaultAddress(programId, value.owner))
  return value
}
export function decodeMarket(account: SolanaAccountRecord, programId: AddressInput) {
  const v1 = account.data.length === 230
  const v2 = account.data.length === 231
  const r = read(account, programId, v1 ? 'SOLZMKT1' : v2 ? 'SOLZMKT2' : 'SOLZMKT3', v1 ? 230 : v2 ? 231 : 263)
  const matchId = r.take(32)
  const questionId = v1 || v2 ? new Uint8Array(32) : r.take(32)
  const value = { matchId, questionId, mint: r.key(), oracle: r.key(), escrow: r.key(), startsAtSeconds: r.i64(), locksAtSeconds: r.i64(), expirySeconds: r.i64(), createdAtSeconds: r.i64(), status: r.u8(), outcomeCount: r.u8(), winningOutcome: r.u8(), paused: r.bool(), bump: r.u8(), escrowBump: r.u8(), collateralLocked: r.u64(), resultHash: r.take(32), voidSharesRedeemed: r.u128(), manifestGuarded: v1 ? false : r.bool() }
  requireAddress(account, questionId.some(byte => byte !== 0) ? questionMarketAddress(programId, matchId, questionId) : marketAddress(programId, matchId))
  return value
}
export function decodePosition(account: SolanaAccountRecord, programId: AddressInput) {
  const r = read(account, programId, 'SOLZPOS1', 201)
  const value = { vault: r.key(), market: r.key(), balances: Array.from({ length: 16 }, () => r.u64()), bump: r.u8() }
  requireAddress(account, positionAddress(programId, value.market, value.vault))
  return value
}
export function decodeOrderState(account: SolanaAccountRecord, programId: AddressInput) {
  const r = read(account, programId, 'SOLZORD1', 204)
  const value = { vault: r.key(), nonce: r.u64(), sessionEpoch: r.u64(), filled: r.u64(), cancelled: r.bool(), bound: r.bool(), orderBody: r.take(138) }
  requireAddress(account, orderStateAddress(programId, value.vault, value.nonce))
  return value
}
