import type { SignedMatchResult } from '../../prediction-core/types'
import type { SolanaGatewayConfig } from './gateway'
import { invariant } from '../../prediction-core/validation'
import { PublicKey } from '@solana/web3.js'

export async function solanaResultDigest(result: SignedMatchResult, config: Pick<SolanaGatewayConfig, 'programId' | 'chainId' | 'networkDomain'>): Promise<Uint8Array<ArrayBuffer>> {
  invariant(result.venue === 'SOLANA' && result.chainId === config.chainId && result.nonce === undefined, 'WRONG_CHAIN', 'Solana result has a different chain or unsupported nonce.')
  const message = JSON.stringify(['SOLZ_SOLANA_RESULT_V1', config.programId, config.chainId, config.networkDomain, result.matchId, result.marketId, result.winningOutcomeId, result.voided, result.stateHash, result.matchEndedAt, result.expiresAt])
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)))
}
export async function verifySolanaResultAttestation(result: SignedMatchResult, config: Pick<SolanaGatewayConfig, 'programId' | 'chainId' | 'networkDomain' | 'oracleAuthority'>): Promise<boolean> {
  try {
    const envelope = JSON.parse(result.signature)
    if (envelope?.scheme !== 'SOLZ_SOLANA_RESULT_V1' || typeof envelope.signature !== 'string' || !/^[0-9a-f]{128}$/.test(envelope.signature) || Object.keys(envelope).sort().join() !== 'scheme,signature') return false
    const key = await crypto.subtle.importKey('raw', new PublicKey(config.oracleAuthority).toBytes().buffer as ArrayBuffer, 'Ed25519', false, ['verify'])
    const signature = Uint8Array.from(envelope.signature.match(/../g)!, (byte: string) => parseInt(byte, 16))
    return crypto.subtle.verify('Ed25519', key, signature, await solanaResultDigest(result, config))
  } catch { return false }
}
