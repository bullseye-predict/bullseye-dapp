import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import type { SignedMatchResult } from '../../prediction-core/types'
import { invariant } from '../../prediction-core/validation'
import type { EvmTransactionRequest } from './transactions'

export const RESULT_TYPES = { Result: [
  { name: 'matchId', type: 'bytes32' }, { name: 'marketId', type: 'bytes32' },
  { name: 'winningOutcomeId', type: 'uint8' }, { name: 'voided', type: 'bool' },
  { name: 'stateHash', type: 'bytes32' }, { name: 'finishedAt', type: 'uint64' }, { name: 'expiry', type: 'uint64' },
] } as const

export function resultTypedData(result: SignedMatchResult, oracle: Address) {
  for (const id of [result.marketId, result.matchId, result.stateHash]) invariant(/^0x[0-9a-fA-F]{64}$/.test(id), 'INVALID_RESULT', 'Result identifiers must be bytes32.')
  invariant(result.venue !== 'SOLANA' && result.venue !== 'DREAMDEX' && result.nonce === undefined, 'WRONG_VENUE', 'EVM result replay protection is bound to one finalization per market; no unsigned nonce is accepted.')
  invariant(result.matchEndedAt % 1000 === 0 && result.expiresAt % 1000 === 0 && Number.isSafeInteger(result.matchEndedAt) && Number.isSafeInteger(result.expiresAt), 'INVALID_TIMING', 'EVM result times must align to whole seconds.')
  invariant(/^[1-9][0-9]*$/.test(result.chainId) && BigInt(result.chainId) <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_CHAIN', 'Invalid EVM chain ID.')
  return {
    domain: { name: 'SOLZ Result Oracle', version: '1', chainId: Number(result.chainId), verifyingContract: oracle },
    types: RESULT_TYPES, primaryType: 'Result' as const,
    message: { matchId: result.matchId as Hex, marketId: result.marketId as Hex, winningOutcomeId: result.winningOutcomeId, voided: result.voided, stateHash: result.stateHash as Hex, finishedAt: BigInt(result.matchEndedAt / 1000), expiry: BigInt(result.expiresAt / 1000) },
  }
}

export function resolveTransaction(oracle: Address, result: SignedMatchResult): EvmTransactionRequest {
  return { to: oracle, value: 0n, data: encodeFunctionData({ abi: parseAbi(['function resolveMarket((bytes32 matchId,bytes32 marketId,uint8 winningOutcomeId,bool voided,bytes32 stateHash,uint64 finishedAt,uint64 expiry) result,bytes signature)']), functionName: 'resolveMarket', args: [resultTypedData(result, oracle).message, result.signature as Hex] }) }
}
