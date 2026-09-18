import { PublicKey } from '@solana/web3.js'
import { questionMarketAddress } from '../../../packages/adapters/solana/wire'

/**
 * THE QUESTION MARKET PDA, DERIVED ONCE PER (PROGRAM, MATCH, QUESTION).
 *
 * `questionMarketAddress` is `findProgramAddress`: a sha256 over the seeds plus
 * an on-curve check, retried down the bump range until it misses the curve. That
 * is ~250us each, which is nothing for one market and 1.1 SECONDS OF BLOCKED
 * MAIN THREAD for the 4,600-row all-status catalogue - a cost the catalogue was
 * paying again on every 10-second poll, and once more for each page the cursor
 * walk published on the way. The inputs are three immutable ids, so the answer
 * cannot change; the second derivation of a pair is always waste.
 *
 * Unbounded on purpose: the key space is the catalogue, every entry is ~120
 * bytes, and an entry that is evicted is one the next poll pays for again.
 */
const derived = new Map<string, string>()

const hexBytes = (value: string) => Uint8Array.from((value.slice(2).match(/../g) ?? []).map(byte => Number.parseInt(byte, 16)))

export function cachedQuestionMarketAddress(program: PublicKey, matchId: string, questionId: string): string {
  const key = `${program.toBase58()}:${matchId.toLowerCase()}:${questionId.toLowerCase()}`
  const hit = derived.get(key)
  if (hit) return hit
  const address = questionMarketAddress(program, hexBytes(matchId), hexBytes(questionId)).toBase58()
  derived.set(key, address)
  return address
}

/** Tests only: the cache is process-wide, so a suite that derives against two
 *  programs must be able to start from empty. */
export const resetQuestionMarketAddressCache = () => derived.clear()
