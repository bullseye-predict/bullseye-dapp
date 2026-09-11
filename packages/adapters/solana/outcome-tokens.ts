import { Buffer } from 'buffer'
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { address, concat, configAddress, positionAddress, TOKEN_PROGRAM_ID, u64, vaultAddress, type AddressInput } from './wire'

/** These instructions exist only in external-venue-comparison SBF builds. */
export type BinaryOutcome = 0 | 1
export function outcomeMintAddress(program: AddressInput, market: AddressInput, outcome: BinaryOutcome): PublicKey {
  if (outcome !== 0 && outcome !== 1) throw new RangeError('Expected binary outcome 0 or 1')
  return PublicKey.findProgramAddressSync([Buffer.from('outcome_mint'), address(market).toBuffer(), Buffer.from([outcome])], address(program))[0]
}
const meta = (pubkey: AddressInput, isWritable = false, isSigner = false) => ({ pubkey: address(pubkey), isWritable, isSigner })
export function initializeOutcomeMint(program: AddressInput, admin: AddressInput, market: AddressInput, collateral: AddressInput, outcome: BinaryOutcome): TransactionInstruction {
  return new TransactionInstruction({ programId: address(program), keys: [meta(admin, true, true), meta(configAddress(program)), meta(market), meta(outcomeMintAddress(program, market, outcome), true), meta(collateral), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)], data: Buffer.from([19, outcome]) })
}
/** Export replaces existing internal claims with SPL tokens; it never creates collateral. */
export function moveOutcomeTokens(program: AddressInput, owner: AddressInput, market: AddressInput, outcome: BinaryOutcome, amount: bigint, direction: 'export' | 'import'): TransactionInstruction {
  if (amount <= 0n) throw new RangeError('A positive atomic quantity is required')
  if (direction !== 'export' && direction !== 'import') throw new TypeError('Invalid token direction')
  const vault = vaultAddress(program, owner)
  const mint = outcomeMintAddress(program, market, outcome)
  const token = getAssociatedTokenAddressSync(mint, address(owner))
  return new TransactionInstruction({ programId: address(program), keys: [meta(owner, false, true), meta(configAddress(program)), meta(market), meta(vault, true), meta(positionAddress(program, market, vault), true), meta(mint, true), meta(token, true), meta(TOKEN_PROGRAM_ID)], data: Buffer.from(concat(Uint8Array.of(direction === 'export' ? 20 : 21, outcome), u64(amount))) })
}
export function prepareOutcomeAccount(program: AddressInput, payer: AddressInput, owner: AddressInput, market: AddressInput, outcome: BinaryOutcome): TransactionInstruction {
  const mint = outcomeMintAddress(program, market, outcome)
  return createAssociatedTokenAccountIdempotentInstruction(address(payer), getAssociatedTokenAddressSync(mint, address(owner)), address(owner), mint)
}
