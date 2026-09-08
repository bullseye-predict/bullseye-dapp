import type { VenueId } from '../prediction-core/types'

export interface RequestProof {
  venue: VenueId
  chainId: string
  account: string
  nonce: string
  expiresAt: number
  signature: string
}

export async function requestAuthMessage(audience: string, method: string, pathAndQuery: string, body: string, proof: Omit<RequestProof, 'signature'>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))
  const bodyHash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
  return ['SOLZ_PREDICTION_REQUEST_V1', audience, method.toUpperCase(), pathAndQuery, proof.venue, proof.chainId, proof.account, proof.nonce, String(proof.expiresAt), bodyHash].join('\n')
}

export function proofHeaders(proof: RequestProof): Record<string, string> {
  return { 'x-solz-venue': proof.venue, 'x-solz-chain': proof.chainId, 'x-solz-account': proof.account, 'x-solz-nonce': proof.nonce, 'x-solz-expires-at': String(proof.expiresAt), 'x-solz-signature': proof.signature }
}
