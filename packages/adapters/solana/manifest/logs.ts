import { Buffer } from 'buffer'
import { genAccDiscriminator } from '@bonasa-tech/manifest-sdk'

const INVOKE = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/
const EXIT = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed(?::.*)?)$/
const DATA = 'Program data: '

/** The three Manifest event frames this app decodes. A fill-only reader reads
 *  empty on a book whose orders have never crossed, which is exactly the market
 *  a trader is looking at when they ask why nothing is happening. */
export const MANIFEST_LOG = {
  fill: Buffer.from(genAccDiscriminator('manifest::logs::FillLog')),
  place: Buffer.from(genAccDiscriminator('manifest::logs::PlaceOrderLog')),
  cancel: Buffer.from(genAccDiscriminator('manifest::logs::CancelOrderLog')),
} as const

/**
 * Program data emitted while `target` was the active invocation frame.
 *
 * A CPI into another program logs under that program, so frame tracking is what
 * keeps a guarded Manifest event from being read as someone else's. Returns the
 * base64 payloads paired with their index in the original message list, so a
 * caller can build a stable per-transaction row id.
 */
export function manifestProgramFrames(messages: readonly string[], target: string): { encoded: string; index: number }[] {
  const frames: string[] = []
  const found: { encoded: string; index: number }[] = []
  messages.forEach((message, index) => {
    const invoke = message.match(INVOKE)
    if (invoke) { frames.push(invoke[1]!); return }
    const exit = message.match(EXIT)
    // A frame that closes out of order means the log was truncated; drop the
    // stack rather than attributing the rest of the transaction to this program.
    if (exit) { if (frames.at(-1) === exit[1]) frames.pop(); else frames.length = 0; return }
    if (frames.at(-1) === target && message.startsWith(DATA)) found.push({ encoded: message.slice(DATA.length), index })
  })
  return found
}

/** The payload of one framed event, or null when it is not the wanted type. */
export function manifestLogBody(encoded: string, discriminator: Buffer): Buffer | null {
  let data: Buffer
  try { data = Buffer.from(encoded, 'base64') } catch { return null }
  if (data.length <= 8 || !data.subarray(0, 8).equals(discriminator)) return null
  return data.subarray(8)
}
