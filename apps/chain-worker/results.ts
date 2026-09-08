import { createPublicClient, http, parseAbi, type Hex } from 'viem'
import { resultTypedData } from '../../packages/adapters/evm/results'
import { EvmChainGateway } from '../../packages/adapters/evm/gateway'
import { SolanaChainGateway, type SolanaGatewayConfig } from '../../packages/adapters/solana/gateway'
import { verifySolanaResultAttestation } from '../../packages/adapters/solana/results'
import type { EvmVenueConfig } from '../../packages/adapters/config'
import type { SignedMatchResult } from '../../packages/prediction-core/types'
import { integer, invariant, record, textField, venueId } from '../../packages/prediction-core/validation'

export type ChainConfig = EvmVenueConfig | SolanaGatewayConfig
export function parseSignedMatchResult(input: unknown): SignedMatchResult {
  const value = record(input)
  invariant(typeof value.voided === 'boolean' && value.nonce === undefined, 'INVALID_RESULT', 'Expected a void flag and single-finalization result without nonce.')
  const result: SignedMatchResult = { venue: venueId(value.venue), chainId: textField(value.chainId, 'chainId'), marketId: textField(value.marketId, 'marketId'), matchId: textField(value.matchId, 'matchId'), winningOutcomeId: integer(value.winningOutcomeId, 'winningOutcomeId', 0, 15), voided: value.voided, stateHash: textField(value.stateHash, 'stateHash'), matchEndedAt: integer(value.matchEndedAt, 'matchEndedAt'), expiresAt: integer(value.expiresAt, 'expiresAt'), signature: textField(value.signature, 'signature', 8192) }
  invariant(/^0x[0-9a-fA-F]{64}$/.test(result.matchId) && !/^0x0{64}$/.test(result.matchId) && /^0x[0-9a-fA-F]{64}$/.test(result.stateHash) && !/^0x0{64}$/.test(result.stateHash), 'INVALID_RESULT', 'Result match and state hash must be nonzero bytes32.')
  invariant(result.matchEndedAt % 1000 === 0 && result.expiresAt % 1000 === 0 && result.matchEndedAt < result.expiresAt && (!result.voided || result.winningOutcomeId === 0), 'INVALID_RESULT', 'Result times must be whole seconds and void outcome must be zero.')
  return result
}
export async function verifyResult(result: SignedMatchResult, config: ChainConfig, now = Date.now()): Promise<boolean> {
  try {
    parseSignedMatchResult(result)
    if (result.venue !== config.venue || result.chainId !== config.chainId || result.matchEndedAt > now || result.expiresAt <= now) return false
    const gateway = config.family === 'SOLANA' ? new SolanaChainGateway(config) : new EvmChainGateway(config)
    const market = await gateway.getMarket(result.marketId)
    if (market.matchId.toLowerCase() !== result.matchId.toLowerCase() || now >= market.expiresAt || result.matchEndedAt < market.createdAt || ['RESOLVED', 'VOIDED'].includes(market.status) || result.winningOutcomeId >= market.outcomes.length) return false
    if (config.family === 'SOLANA') return result.expiresAt === market.expiresAt && verifySolanaResultAttestation(result, config)
    const client = createPublicClient({ transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 1 }) })
    const authority = await client.readContract({ address: config.oracleAddress, abi: parseAbi(['function authority() view returns(address)']), functionName: 'authority' })
    return client.verifyTypedData({ ...resultTypedData(result, config.oracleAddress), address: authority, signature: result.signature as Hex })
  } catch { return false }
}
