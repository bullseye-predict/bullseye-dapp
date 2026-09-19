import { Buffer } from 'buffer'
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { concat, configAddress, positionAddress, predictionManifestConfigAddress, TOKEN_PROGRAM_ID, u64, vaultAddress, vaultCollateralAddress } from '../wire'
export type Outcome = 0 | 1
const pda = (program: PublicKey, seed: string, question: PublicKey, outcome: Outcome) => {
  if (outcome !== 0 && outcome !== 1) throw new RangeError('Expected YES=0 or NO=1')
  return PublicKey.findProgramAddressSync([Buffer.from(seed), question.toBuffer(), Buffer.from([outcome])], program)[0]
}
export const bindingAddress = (program: PublicKey, question: PublicKey, outcome: Outcome) => pda(program, 'manifest_binding', question, outcome)
export const manifestConfigAddress = (program: PublicKey) => predictionManifestConfigAddress(program)
export const bookAddress = (program: PublicKey, question: PublicKey, outcome: Outcome) => pda(program, 'manifest_book', question, outcome)
export const claimMintAddress = (program: PublicKey, question: PublicKey, outcome: Outcome) => pda(program, 'manifest_outcome', question, outcome)
export const freezeAuthority = (program: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('claims_authority')], program)[0]
export const venueVault = (program: PublicKey, book: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('vault'), book.toBuffer(), mint.toBuffer()], program)[0]
/** Zero-data PDA used as the Manifest trader and rent payer for one prediction
 * vault. It is distinct from the data-bearing vault because System Program may
 * only debit a data-empty account during Manifest market expansion. */
export const manifestAgentTraderAddress = (program: PublicKey, owner: PublicKey) => {
  const vault = vaultAddress(program, owner)
  return PublicKey.findProgramAddressSync([Buffer.from('manifest_agent'), vault.toBuffer()], program)[0]
}
export const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner })
export interface ManifestBinding { question: PublicKey; program: PublicKey; venue: PublicKey; mint: PublicKey; collateral: PublicKey; recipient: PublicKey; bps: number; outcome: Outcome }
export function decodeBinding(program: PublicKey, key: PublicKey, owner: PublicKey, data: Buffer): ManifestBinding {
  if (!owner.equals(program) || data.length !== 204 || data.subarray(0, 8).toString() !== 'SOLZMAN1') throw new Error('Invalid Manifest binding account')
  const k = (offset: number) => new PublicKey(data.subarray(offset, offset + 32))
  const result = { question: k(8), program: k(40), venue: k(72), mint: k(104), collateral: k(136), recipient: k(168), bps: data.readUInt16LE(200), outcome: data[202]! as Outcome }
  if (!bindingAddress(program, result.question, result.outcome).equals(key) || !bookAddress(program, result.question, result.outcome).equals(result.venue) || !claimMintAddress(program, result.question, result.outcome).equals(result.mint) || result.bps < 1 || result.bps > 10000) throw new Error('Noncanonical Manifest binding')
  return result
}
export function configureManifest(program: PublicKey, admin: PublicKey, manifest: PublicKey, recipient: PublicKey, takerFeeBps: number) {
  if (!Number.isInteger(takerFeeBps) || takerFeeBps < 1 || takerFeeBps > 10000) throw new RangeError('Explicit taker fee from 1 to 10000 bps required')
  const bps = Buffer.alloc(2); bps.writeUInt16LE(takerFeeBps)
  return new TransactionInstruction({ programId: program, keys: [meta(admin, true, true), meta(configAddress(program)), meta(manifestConfigAddress(program), true), meta(manifest), meta(SystemProgram.programId)], data: Buffer.from(concat(Uint8Array.of(28), recipient.toBytes(), bps)) })
}
export function registerBinding(program: PublicKey, payer: PublicKey, question: PublicKey, manifest: PublicKey, outcome: Outcome) {
  return new TransactionInstruction({ programId: program, keys: [meta(payer, true, true), meta(configAddress(program)), meta(question, true), meta(bindingAddress(program, question, outcome), true), meta(manifestConfigAddress(program)), meta(SystemProgram.programId), meta(manifest), meta(bookAddress(program, question, outcome))], data: Buffer.from([22, outcome]) })
}
export function initializeClaimMint(program: PublicKey, payer: PublicKey, b: ManifestBinding) {
  return new TransactionInstruction({ programId: program, keys: [meta(payer,true,true),meta(configAddress(program)),meta(b.question),meta(bindingAddress(program,b.question,b.outcome)),meta(b.mint,true),meta(b.collateral),meta(SystemProgram.programId),meta(TOKEN_PROGRAM_ID),meta(b.program),meta(freezeAuthority(b.program))], data: Buffer.from([23]) })
}
export function activateBook(program: PublicKey, payer: PublicKey, b: ManifestBinding) {
  return new TransactionInstruction({ programId: program, keys: [meta(payer,true,true),meta(configAddress(program)),meta(b.question),meta(bindingAddress(program,b.question,b.outcome)),meta(b.venue,true),meta(b.mint),meta(b.collateral),meta(venueVault(b.program,b.venue,b.mint),true),meta(venueVault(b.program,b.venue,b.collateral),true),meta(b.program),meta(SystemProgram.programId),meta(TOKEN_PROGRAM_ID),meta(TOKEN_2022_PROGRAM_ID),meta(freezeAuthority(b.program))], data: Buffer.from([26]) })
}
export function prepareClaimAccount(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return createAssociatedTokenAccountIdempotentInstruction(payer,getAssociatedTokenAddressSync(mint,owner),owner,mint)
}
export function moveClaims(program: PublicKey, owner: PublicKey, b: ManifestBinding, atoms: bigint, direction: 'export' | 'import') {
  if (atoms <= 0n || !['export','import'].includes(direction)) throw new RangeError('Invalid claim movement')
  const vault=vaultAddress(program,owner)
  return new TransactionInstruction({ programId:program, keys:[meta(owner,false,true),meta(configAddress(program)),meta(b.question),meta(vault,true),meta(positionAddress(program,b.question,vault),true),meta(bindingAddress(program,b.question,b.outcome)),meta(b.mint,true),meta(getAssociatedTokenAddressSync(b.mint,owner),true),meta(b.program),meta(freezeAuthority(b.program)),meta(TOKEN_PROGRAM_ID)],data:Buffer.from(concat(Uint8Array.of(direction==='export'?24:25),u64(atoms))) })
}
/** Fee is paid by the incoming trader, on actual executed USDC notional.
 * Resting/unfilled quantities and cancellations incur no platform fee. */
export const takerFee = (executedUsdcAtoms: bigint, bps: number) => {
  u64(executedUsdcAtoms)
  if (!Number.isInteger(bps) || bps < 1 || bps > 10000) throw new RangeError('Invalid fee rate')
  return (executedUsdcAtoms * BigInt(bps) + 9999n) / 10000n
}
export function guarded(program: PublicKey, owner: PublicKey, b: ManifestBinding, core: TransactionInstruction, maxFeeAtoms: bigint): TransactionInstruction {
  u64(maxFeeAtoms)
  if (!core.programId.equals(b.program) || !core.keys[0]?.pubkey.equals(owner) || !core.keys[1]?.pubkey.equals(b.venue)) throw new Error('Wrong Manifest transaction target')
  return new TransactionInstruction({ programId:b.program, keys:[...core.keys,meta(bindingAddress(program,b.question,b.outcome)),meta(configAddress(program)),meta(b.question),meta(b.mint),meta(freezeAuthority(b.program)),meta(getAssociatedTokenAddressSync(b.collateral,owner),true),meta(getAssociatedTokenAddressSync(b.collateral,b.recipient),true),meta(TOKEN_PROGRAM_ID)],data:Buffer.from(concat(core.data,u64(maxFeeAtoms))) })
}

const u32 = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError('Expected unsigned 32-bit integer')
  const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes
}

/** Claim the vault PDA's local Manifest seat. The actor funds rent separately;
 * the prediction program signs only for the canonical vault PDA. */
export function claimManifestAgentSeat(program: PublicKey, actor: PublicKey, owner: PublicKey, b: ManifestBinding) {
  const vault = vaultAddress(program, owner), trader = manifestAgentTraderAddress(program, owner)
  return new TransactionInstruction({ programId: program, keys: [
    meta(actor, true, true), meta(configAddress(program)), meta(b.question), meta(vault, true),
    meta(bindingAddress(program, b.question, b.outcome)), meta(b.venue, true), meta(b.program),
    meta(SystemProgram.programId), meta(b.mint), meta(freezeAuthority(b.program)), meta(trader, true),
    meta(getAssociatedTokenAddressSync(b.collateral, trader, true), true), meta(getAssociatedTokenAddressSync(b.collateral, b.recipient), true), meta(TOKEN_PROGRAM_ID),
  ], data: Buffer.from([31]) })
}

/** Owner-only staging between the prediction vault and its Manifest seat. */
export function moveManifestAgentInventory(program: PublicKey, owner: PublicKey, b: ManifestBinding, asset: 'USDC' | 'claims', atoms: bigint, direction: 'deposit' | 'withdraw') {
  if (atoms <= 0n) throw new RangeError('Positive inventory amount required')
  const vault = vaultAddress(program, owner), escrow = vaultCollateralAddress(program, vault), agentTrader = manifestAgentTraderAddress(program, owner)
  const trader = getAssociatedTokenAddressSync(asset === 'USDC' ? b.collateral : b.mint, agentTrader, true)
  const mint = asset === 'USDC' ? b.collateral : b.mint
  const keys = [
    meta(owner, true, true), meta(configAddress(program)), meta(b.question), meta(vault, true),
    meta(positionAddress(program, b.question, vault), true), meta(bindingAddress(program, b.question, b.outcome)),
    meta(b.venue, true), meta(agentTrader, true), meta(trader, true), meta(venueVault(b.program, b.venue, mint), true), meta(escrow, true),
  ]
  keys.push(meta(b.program), meta(b.mint), meta(freezeAuthority(b.program)), meta(getAssociatedTokenAddressSync(b.collateral, b.recipient), true), meta(TOKEN_PROGRAM_ID), meta(b.collateral))
  return new TransactionInstruction({ programId: program, keys, data: Buffer.from(concat(Uint8Array.of(32, asset === 'USDC' ? 0 : 1, direction === 'deposit' ? 0 : 1), u64(atoms))) })
}

/** Delegated execution is deliberately IOC-only: no order can outlive the
 * decision, worker, or owner-stop path. Hard vault caps are rechecked on-chain. */
export function manifestAgentIoc(program: PublicKey, agent: PublicKey, owner: PublicKey, b: ManifestBinding, input: { side: 'BUY' | 'SELL'; quantity: bigint; priceMicros: bigint; lastValidSlot: number; maxFeeAtoms: bigint }) {
  u64(input.quantity); u64(input.priceMicros); u64(input.maxFeeAtoms)
  if (input.quantity <= 0n || input.priceMicros <= 0n || input.priceMicros >= 1_000_000n || !['BUY', 'SELL'].includes(input.side)) throw new RangeError('Invalid delegated IOC terms')
  const vault = vaultAddress(program, owner), trader = manifestAgentTraderAddress(program, owner)
  return new TransactionInstruction({ programId: program, keys: [
    meta(agent, false, true), meta(configAddress(program)), meta(b.question), meta(vault, true),
    meta(bindingAddress(program, b.question, b.outcome)), meta(b.venue, true), meta(b.program), meta(SystemProgram.programId),
    meta(b.mint), meta(freezeAuthority(b.program)), meta(vaultCollateralAddress(program, vault), true), meta(trader, true),
    meta(getAssociatedTokenAddressSync(b.collateral, trader, true), true), meta(getAssociatedTokenAddressSync(b.collateral, b.recipient), true), meta(TOKEN_PROGRAM_ID),
  ], data: Buffer.from(concat(Uint8Array.of(33, input.side === 'BUY' ? 0 : 1), u64(input.quantity), u64(input.priceMicros), u32(input.lastValidSlot), u64(input.maxFeeAtoms))) })
}
/** Workaround for the verified duplicate optional hint in upstream SDK 0.2.46. */
export function tokenMovement(owner: PublicKey, b: ManifestBinding, asset: 'claims' | 'USDC', atoms: bigint, direction: 'deposit' | 'withdraw') {
  if (atoms <= 0n || !['claims','USDC'].includes(asset) || !['deposit','withdraw'].includes(direction)) throw new RangeError('Invalid token movement')
  const mint=asset==='claims'?b.mint:b.collateral
  return new TransactionInstruction({programId:b.program,keys:[meta(owner,true,true),meta(b.venue,true),meta(getAssociatedTokenAddressSync(mint,owner),true),meta(venueVault(b.program,b.venue,mint),true),meta(TOKEN_PROGRAM_ID),meta(mint)],data:Buffer.from(concat(Uint8Array.of(direction==='deposit'?2:3),u64(atoms),Uint8Array.of(0)))})
}
