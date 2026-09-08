import { PredictionError, integer, textField, venueId } from '../../../packages/prediction-core/validation'
import { requestAuthMessage, type RequestProof } from '../../../packages/sdk/auth'
import type { PredictionDatabase } from '../storage/database'

export interface RequestSignatureVerifier {
  verify(proof: RequestProof, message: string, request: { method: string; path: string }): Promise<boolean>
}

export class RequestAuthenticator {
  constructor(private readonly database: PredictionDatabase, private readonly verifier: RequestSignatureVerifier, private readonly audience: string, private readonly now = Date.now) {}

  async authenticate(request: Request, body: string): Promise<RequestProof> {
    const headers = request.headers
    const proof: RequestProof = {
      venue: venueId(headers.get('x-solz-venue')),
      chainId: textField(headers.get('x-solz-chain'), 'chainId'),
      account: textField(headers.get('x-solz-account'), 'account'),
      nonce: textField(headers.get('x-solz-nonce'), 'nonce', 128),
      expiresAt: integer(Number(headers.get('x-solz-expires-at')), 'expiresAt'),
      signature: textField(headers.get('x-solz-signature'), 'signature', 8192),
    }
    const now = this.now()
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(proof.nonce) || proof.expiresAt <= now || proof.expiresAt > now + 60_000) throw new PredictionError('UNAUTHORIZED', 'Request proof is expired or invalid.', 401)
    const url = new URL(request.url)
    const message = await requestAuthMessage(this.audience, request.method, `${url.pathname}${url.search}`, body, proof)
    if (!await this.verifier.verify(proof, message, { method: request.method, path: url.pathname })) throw new PredictionError('UNAUTHORIZED', 'Wallet request signature is invalid.', 401)
    const verifiedAt = this.now()
    if (proof.expiresAt <= verifiedAt || proof.expiresAt > verifiedAt + 60_000) throw new PredictionError('UNAUTHORIZED', 'Request proof expired during signature verification.', 401)
    if (!this.database.consumeNonce(JSON.stringify([this.audience, proof.venue, proof.chainId, proof.account]), proof.nonce, proof.expiresAt, verifiedAt)) throw new PredictionError('REPLAY', 'Request proof was already used.', 409)
    return proof
  }
}
