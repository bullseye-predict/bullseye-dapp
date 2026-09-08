import type { MatchTelemetry, SignedMatchResult } from '../prediction-core/types'
import { stringify } from '../prediction-core/serialization'
import { invariant } from '../prediction-core/validation'
import { parseTelemetry, telemetrySignature } from './bridge'

export class PublishError extends Error {
  constructor(readonly status: number, readonly code: string) { super(`Prediction publisher rejected the request (${status}, ${code}).`) }
}
export interface PublisherOptions {
  predictionApiUrl: string
  telemetrySecret: string
  /** Independent privileged result endpoint and token. Never sent to Colyseus. */
  resultSinkUrl?: string
  controlToken?: string
  fetch?: typeof fetch
  timeoutMs?: number
}
export class PredictionPublisher {
  private readonly fetcher: typeof fetch
  constructor(private readonly options: PublisherOptions) {
    invariant(options.telemetrySecret.length >= 32, 'INVALID_CONFIG', 'Telemetry secret must contain at least 32 characters.')
    this.fetcher = options.fetch ?? fetch
  }
  private url(path: string) { return `${this.options.predictionApiUrl.replace(/\/$/, '')}${path}` }
  private signal(signal?: AbortSignal) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs ?? 10_000)]) : AbortSignal.timeout(this.options.timeoutMs ?? 10_000) }
  private async check(response: Response) {
    if (response.ok) return
    const value = await response.json().catch(() => ({})) as { code?: string; error?: { code?: string } }
    throw new PublishError(response.status, value.error?.code ?? value.code ?? 'HTTP_ERROR')
  }
  async telemetry(body: string, signal?: AbortSignal): Promise<void> {
    parseTelemetry(JSON.parse(body))
    invariant(Buffer.byteLength(body) <= 64 * 1024, 'PAYLOAD_TOO_LARGE', 'Telemetry exceeds the API body limit.')
    const response = await this.fetcher(this.url('/internal/telemetry'), { method: 'POST', headers: {
      'content-type': 'application/json', 'x-solz-telemetry-signature': telemetrySignature(body, this.options.telemetrySecret),
    }, body, signal: this.signal(signal), redirect: 'error' })
    await this.check(response)
  }
  async latest(matchId: string, signal?: AbortSignal): Promise<MatchTelemetry | undefined> {
    const response = await this.fetcher(this.url(`/matches/${encodeURIComponent(matchId)}/telemetry`), { signal: this.signal(signal), redirect: 'error' })
    if (response.status === 404) return undefined
    await this.check(response)
    return parseTelemetry(await response.json())
  }
  async result(body: string, signal?: AbortSignal): Promise<void> {
    invariant(this.options.controlToken && this.options.controlToken.length >= 32 && this.options.resultSinkUrl, 'RESULT_SINK_DISABLED', 'A separate result sink and control token are required.')
    invariant(Buffer.byteLength(body) <= 64 * 1024, 'PAYLOAD_TOO_LARGE', 'Result exceeds the API body limit.')
    const response = await this.fetcher(this.options.resultSinkUrl, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${this.options.controlToken}`,
    }, body, signal: this.signal(signal), redirect: 'error' })
    await this.check(response)
  }
}

/** Game-server integration boundary. The caller owns durable sequences and a scoped authority signer. */
export interface AuthoritativeGamePublisher {
  publishTelemetry(snapshot: MatchTelemetry, signal?: AbortSignal): Promise<void>
  publishResult(result: Omit<SignedMatchResult, 'signature'>, signal?: AbortSignal): Promise<SignedMatchResult>
}
export function createAuthoritativeGamePublisher(options: {
  publisher: PredictionPublisher
  signResult: (result: Omit<SignedMatchResult, 'signature'>) => Promise<string>
  verifyResult: (result: SignedMatchResult) => Promise<boolean>
}): AuthoritativeGamePublisher {
  return {
    async publishTelemetry(snapshot, signal) { await options.publisher.telemetry(stringify(parseTelemetry(snapshot)), signal) },
    async publishResult(input, signal) {
      const immutable = Object.freeze(structuredClone(input))
      const result = { ...immutable, signature: await options.signResult(immutable) }
      invariant(await options.verifyResult(result), 'INVALID_RESULT_SIGNATURE', 'The authority attestation could not be verified.')
      await options.publisher.result(stringify(result), signal)
      return result
    },
  }
}
