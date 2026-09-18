import { TRANSIENT } from './browser'
import { rpcCooldownRemaining } from './throttle'
import { uncertainSignature } from './steps'

/**
 * Turning a thrown Error into a sentence a trader can act on.
 *
 * The adapters keep their raw text on purpose: browser.ts matches TRANSIENT
 * against it to decide whether to resend, and uncertainSignature recovers the
 * explorer link out of it. So nothing below rewrites what is thrown — the
 * translation happens once, here, at the edge where a string stops being
 * control flow and becomes something someone reads.
 *
 * The case this exists for: rpc.ts sets `disableRetryOnRateLimit`, so web3.js
 * formats a refusal as `${res.status} ${res.statusText}: ${text}`. Over HTTP/2
 * `statusText` is empty, which is how the claim panel came to print
 *   429 : {"jsonrpc":"2.0","error":{"code":-32429,"message":"rate limited"}}
 * verbatim to a trader who had done nothing wrong.
 */
export type WalletError = {
  /** What to show. Always prose. */
  message: string
  /** What was thrown, kept so a caller can put it behind a disclosure and a
   *  bug report still carries the original. */
  raw: string
  /** Milliseconds until reads are expected to resume, on a rate limit. */
  retryInMs?: number
  /** A transaction that was sent but not confirmed, for the explorer link. */
  signature?: string
}

const text = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)

/** Raw machine output that must never be shown as if it were a sentence: a
 *  JSON-RPC envelope, a bare JSON body, or an HTTP status line. */
const MACHINE = /jsonrpc|^\s*[{[]|^\d{3}[\s:]/

export function readWalletError(error: unknown, now = Date.now()): WalletError {
  const raw = text(error)

  const signature = uncertainSignature(raw)
  if (signature)
    return {
      raw,
      signature,
      message:
        'Your transaction was sent, but the network did not confirm it in time. Check it on the explorer before signing again.',
    }

  if (/-32429/.test(raw) || (TRANSIENT.test(raw) && /429|rate limit/i.test(raw))) {
    const remaining = rpcCooldownRemaining(now)
    const seconds = Math.ceil(remaining / 1000)
    return {
      raw,
      retryInMs: remaining,
      message: seconds
        ? `The Solana endpoint is busy and refused this request. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
        : 'The Solana endpoint is busy and refused this request. Try again in a few seconds.',
    }
  }

  if (/TimeoutError|aborted due to timeout|signal timed out/i.test(raw))
    return { raw, message: 'The Solana endpoint did not answer in time. Try again.' }

  if (/user rejected|user declined|rejected the request|request rejected/i.test(raw))
    return { raw, message: 'You declined the signature in your wallet. Nothing was sent.' }

  // Earlier signatures in the same run may already have confirmed, so this must
  // not read as "the whole thing failed".
  if (/Network or wallet selection changed|Wallet account changed/.test(raw))
    return {
      raw,
      message:
        'Your wallet reconnected while this was running, so nothing further was signed. Reopen this claim to carry on from where it stopped.',
    }

  if (/blockhash/i.test(raw)) return { raw, message: 'The network moved on before your signature arrived. Try again.' }

  // The venue fee account was missing when the order filled; prepare() creates
  // it, which is why the answer is to run the preparation again.
  if (/"Custom":\s*8100|Custom\(8100\)/.test(raw))
    return { raw, message: 'This venue is missing a fee account. Run the preparation step again before signing.' }

  if (/Transaction simulation failed/i.test(raw))
    return { raw, message: 'Solana rejected this transaction before it was sent.' }

  // This repo's own throws are already prose ("Cancel open sell orders for this
  // question before claiming."), so they pass through. Anything that still
  // looks like machine output does not.
  return { raw, message: MACHINE.test(raw) ? 'Solana could not be reached. Try again in a moment.' : raw }
}
