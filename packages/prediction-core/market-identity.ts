const MATCH_MAGIC = new TextEncoder().encode('SOLZ')
const QUESTION_MAGIC = new TextEncoder().encode('QUES')
export const MARKET_IDENTITY_VERSION = 1
export const WINNER_QUESTION_KIND = 1

const exact = (value: Uint8Array, length: number, label: string): Uint8Array => {
  if (value.length !== length) throw new RangeError(`${label} must contain exactly ${length} bytes`)
  return value
}

export interface MatchIdentityInput { gameMode: number; durationMinutes: number; kickoffSeconds: bigint; nonce: Uint8Array }

export function encodeMatchIdentity(input: MatchIdentityInput): Uint8Array {
  if (!Number.isInteger(input.gameMode) || input.gameMode < 1 || input.gameMode > 255) throw new RangeError('gameMode must be a nonzero u8')
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 65_535) throw new RangeError('durationMinutes must be a nonzero u16')
  if (input.kickoffSeconds < 1n || input.kickoffSeconds > 0x7fff_ffff_ffff_ffffn) throw new RangeError('kickoffSeconds must be a positive i64')
  const nonce = exact(input.nonce, 16, 'nonce')
  if (nonce.every(byte => byte === 0)) throw new RangeError('nonce must be nonzero')
  const result = new Uint8Array(32)
  result.set(MATCH_MAGIC, 0); result[4] = MARKET_IDENTITY_VERSION; result[5] = input.gameMode
  const view = new DataView(result.buffer)
  view.setUint16(6, input.durationMinutes, false)
  view.setBigUint64(8, input.kickoffSeconds, false)
  result.set(nonce, 16)
  return result
}

export function decodeMatchIdentity(value: Uint8Array): MatchIdentityInput {
  exact(value, 32, 'matchId')
  if (!MATCH_MAGIC.every((byte, index) => value[index] === byte) || value[4] !== MARKET_IDENTITY_VERSION) throw new TypeError('Unsupported matchId')
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  const decoded = { gameMode: value[5]!, durationMinutes: view.getUint16(6, false), kickoffSeconds: view.getBigUint64(8, false), nonce: value.slice(16) }
  encodeMatchIdentity(decoded)
  return decoded
}

export interface QuestionIdentityInput { kind: number; subject: Uint8Array }
export function encodeQuestionIdentity(input: QuestionIdentityInput): Uint8Array {
  if (!Number.isInteger(input.kind) || input.kind < 1 || input.kind > 255) throw new RangeError('kind must be a nonzero u8')
  const subject = exact(input.subject, 26, 'subject')
  if (subject.every(byte => byte === 0)) throw new RangeError('subject must be nonzero')
  const result = new Uint8Array(32)
  result.set(QUESTION_MAGIC, 0); result[4] = MARKET_IDENTITY_VERSION; result[5] = input.kind; result.set(subject, 6)
  return result
}

export function decodeQuestionIdentity(value: Uint8Array): QuestionIdentityInput {
  exact(value, 32, 'questionId')
  if (!QUESTION_MAGIC.every((byte, index) => value[index] === byte) || value[4] !== MARKET_IDENTITY_VERSION) throw new TypeError('Unsupported questionId')
  const decoded = { kind: value[5]!, subject: value.slice(6) }
  encodeQuestionIdentity(decoded)
  return decoded
}

/** Human-readable label only; contracts consume the canonical 32-byte value. */
export function displayMatchId(input: MatchIdentityInput, modeLabel: string): string {
  const suffix = Array.from(exact(input.nonce, 16, 'nonce').slice(-4), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `GM-${modeLabel}_DR-${input.durationMinutes}_TS-${input.kickoffSeconds}_ID-${suffix}`
}
