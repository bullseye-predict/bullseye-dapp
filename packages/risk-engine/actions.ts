import { PRICE_SCALE } from '../prediction-core/types'

export interface TradeAction {
  action: 'BUY' | 'SELL'
  outcomeId: number
  limitPrice: bigint
  /** Atomic outcome shares, not collateral spend. */
  amount: bigint
  confidence: number
  estimatedProbability: number
  expiresAt: number
  reason: string
}

export type HermesAction = TradeAction |
  { action: 'CANCEL'; orderId: string; reason: string } |
  { action: 'HOLD'; reason: string } |
  { action: 'CANCEL_ALL'; reason: string }

function atomic(value: unknown, label: string, maximum: bigint): bigint {
  let result: bigint
  if (typeof value === 'bigint') result = value
  else if (typeof value === 'number' && Number.isSafeInteger(value)) result = BigInt(value)
  else if (typeof value === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(value)) result = BigInt(value)
  else throw new Error(`${label} must be an exact atomic integer`)
  if (result <= 0n || result > maximum) throw new Error(`${label} outside allowed range`)
  return result
}

/** Strict allowlist: model output cannot carry account, venue, policy, or signing options. */
export function parseHermesAction(output: unknown): HermesAction {
  if (typeof output === 'string') {
    if (output.length > 16_384) throw new Error('Hermes action exceeds size limit')
    try { output = JSON.parse(output) } catch { throw new Error('Hermes action must be JSON') }
  }
  if (!output || typeof output !== 'object' || Array.isArray(output) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(output))) throw new Error('Hermes action must be an object')
  const input = output as Record<string, unknown>
  const kind = input.action
  const allowed = kind === 'BUY' || kind === 'SELL'
    ? ['action', 'outcomeId', 'limitPrice', 'amount', 'confidence', 'estimatedProbability', 'expiresAt', 'reason']
    : kind === 'CANCEL' ? ['action', 'orderId', 'reason'] : ['action', 'reason']
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Unknown Hermes action field')
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1024) throw new Error('A bounded reason is required')
  const reason = input.reason.trim()
  if (kind === 'HOLD' || kind === 'CANCEL_ALL') return { action: kind, reason }
  if (kind === 'CANCEL') {
    if (typeof input.orderId !== 'string' || !input.orderId || input.orderId.length > 256) throw new Error('Invalid cancellation order ID')
    return { action: kind, orderId: input.orderId, reason }
  }
  if (kind !== 'BUY' && kind !== 'SELL') throw new Error('Unsupported Hermes action')
  if (!Number.isInteger(input.outcomeId) || (input.outcomeId as number) < 0 || (input.outcomeId as number) >= 16) throw new Error('Invalid outcome ID')
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1 ||
    typeof input.estimatedProbability !== 'number' || !Number.isFinite(input.estimatedProbability) ||
    input.estimatedProbability < 0 || input.estimatedProbability > 1) throw new Error('Invalid probability or confidence')
  if (!Number.isSafeInteger(input.expiresAt) || (input.expiresAt as number) <= 0 || (input.expiresAt as number) % 1000 !== 0) throw new Error('Invalid action expiry; use Unix milliseconds aligned to a whole second')
  return {
    action: kind, outcomeId: input.outcomeId as number,
    limitPrice: atomic(input.limitPrice, 'limitPrice', PRICE_SCALE),
    amount: atomic(input.amount, 'amount', 2n ** 128n - 1n),
    confidence: input.confidence, estimatedProbability: input.estimatedProbability,
    expiresAt: input.expiresAt as number, reason,
  }
}
