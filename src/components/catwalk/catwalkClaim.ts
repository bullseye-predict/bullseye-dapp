/**
 * THE CLAIM FLOW'S RULES, WITH NO REACT IN THEM.
 *
 * Everything the dialog decides about money is decided here, so it can be
 * tested without a browser and without a backend: what a valid address looks
 * like, whether a quote is payable, whether a quote is a bill at all, what each
 * refusal code MEANS in English, and how to scale base units for reading.
 *
 * THE ONE RULE THIS WHOLE MODULE EXISTS TO ENFORCE: the dialog renders what the
 * quote response returned and nothing else. Nothing here computes an amount, a
 * destination or a memo, and nothing here rounds. `formatBaseUnits` is the only
 * arithmetic in the file, it is BigInt throughout, and its output is labelled
 * "for reading only" everywhere it appears.
 *
 * A WRONG DESTINATION OR A WRONG MEMO COSTS THE BUYER THEIR TOKENS WITH NO
 * RECOVERY. That is the standard every function below is held to.
 */

/** Mirrors _solz-elysia src/domain/catwalk.ts:37. Base58 contains no `0`, `O`,
 *  `I` or `l`, which is the single most useful thing to say to somebody who has
 *  pasted the wrong string. */
export const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** Sixty-four bytes in base58. _solz-elysia src/domain/catwalk.ts:49. */
export const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/

const CONFUSABLE = /[0OIl]/

/**
 * Why an address was refused, in words a buyer can act on.
 *
 * NEVER "invalid". Three different mistakes land here - an empty box, a
 * transaction signature pasted into an address box, and a genuinely malformed
 * string - and they have three different fixes.
 */
export function addressProblem(raw: string): string | null {
  const value = raw.trim()
  if (!value) return 'Paste an address.'
  if (CONFUSABLE.test(value))
    return 'That is not base58 — Solana addresses never contain 0, O, I or l. Check you did not paste a transaction signature.'
  if (value.length < 32 || value.length > 44)
    return `A Solana address is 32 to 44 characters; this is ${value.length}.`
  if (!ADDRESS.test(value)) return 'That is not a Solana address. Check for a stray space or a missing character.'
  return null
}

/** The same, for a transaction signature. A wrong length here is almost always
 *  an address in the wrong box, so that is what it says. */
export function signatureProblem(raw: string): string | null {
  const value = raw.trim()
  if (!value) return 'Paste the transaction signature.'
  if (CONFUSABLE.test(value))
    return 'That is not base58 — a signature never contains 0, O, I or l.'
  if (value.length >= 32 && value.length <= 44)
    return 'That looks like a wallet address, not a transaction signature. A signature is 86 to 88 characters.'
  if (value.length < 86 || value.length > 88)
    return `A transaction signature is 86 to 88 characters; this is ${value.length}.`
  if (!SIGNATURE.test(value)) return 'That is not a transaction signature.'
  return null
}

/**
 * BASE UNITS SCALED FOR READING ONLY, ported verbatim from
 * _solz-elysia src/domain/catwalk.ts `formatTokenAmount`.
 *
 * BIGINT THROUGHOUT, AND NEVER ROUNDED. `baseUnits` is an integer string on the
 * wire and the obligation itself is always the base units - this is
 * presentation, and it is exact. Trailing zeros are trimmed; no digit is ever
 * dropped, because a buyer comparing this against a wallet balance needs the
 * two to be the same number.
 *
 * Null rather than a throw when anything is unreadable: a figure of unknown
 * size must not render as a smaller one, and the dialog shows the base-unit
 * string regardless - THAT is what gets sent.
 */
export function formatBaseUnits(baseUnits: string, decimals: number): string | null {
  if (!/^\d+$/.test(baseUnits)) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null
  const value = BigInt(baseUnits)
  const scale = 10n ** BigInt(decimals)
  const whole = (value / scale).toString()
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/** One leg of the payment, exactly as the wire published it. `baseUnits` stays
 *  a string from the wire to the screen; nothing here is a Number. */
export type QuoteTransfer = {
  to: string
  owner: string
  baseUnits: string
  kind: string
}

export type PayableQuote = {
  kind: 'payable'
  bidId: string
  memo: string
  mint: string
  tokenProgram: string
  decimals: number
  /**
   * WHICH CHAIN THIS BILL IS FOR, as the upstream read it while minting the bid
   * (_solz-elysia/src/api/catwalk.ts:317).
   *
   * THE SAME BASE58 IS A VALID ACCOUNT ON EVERY CLUSTER. A devnet treasury
   * renders exactly like a mainnet one, so a buyer whose wallet is on
   * mainnet-beta can build a perfect-looking transfer against a devnet bill and
   * only learn otherwise as `catwalk_network_mismatch` at confirm - after the
   * tokens have left. This is the one field on the bill that answers that
   * question BEFORE the transfer.
   *
   * EMPTY IS ALLOWED AND IS ITS OWN STATE, not a refusal: an upstream that has
   * not shipped the field yet must not take the whole sale down, so the dialog
   * says plainly that the cluster is unstated rather than drawing a blank.
   */
  genesisHash: string
  transfers: QuoteTransfer[]
  usdMicros: number
  expiresAt: number
}

/**
 * THE THREE CLUSTER GENESIS HASHES, WHICH ARE CONSTANTS OF SOLANA ITSELF.
 *
 * A LOOKUP, NEVER A COMPUTATION. The hash from the wire is rendered verbatim
 * whatever this map says; a name is added only on an EXACT match, and an
 * unrecognised hash is named as unrecognised rather than guessed at. Nothing
 * here can change an address, an amount or a memo - it can only put a word
 * beside a hash the buyer can already read.
 */
export const CLUSTER_BY_GENESIS: Record<string, string> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'MAINNET-BETA',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'DEVNET',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'TESTNET',
}

/** The cluster's name, or null when this page cannot vouch for one. Null is
 *  rendered as "UNRECOGNISED CLUSTER", never as mainnet by default. */
export const clusterName = (genesisHash: string): string | null =>
  CLUSTER_BY_GENESIS[genesisHash] ?? null

/** The upstream's non-payable branch: a key replayed against a bid that is no
 *  longer a bill. It carries NO memo, NO transfers and NO mint, which is why it
 *  is a separate type rather than a flag on the one above - this shape is
 *  structurally incapable of being rendered as something to pay. */
export type ReplayedQuote = {
  kind: 'replayed'
  bidId: string
  state: string
  usdMicros: number
  expiresAt: number
  settleable: boolean
}

export type ClaimError = { kind: 'error'; code: string; message: string }

export type QuoteResult = PayableQuote | ReplayedQuote | ClaimError

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/**
 * The quote response, sorted into the three things it can be.
 *
 * DETECTED ON `replayed === true`, NEVER ON THE ABSENCE OF A MEMO. "It has no
 * memo, so it must be replayed" is a guess about a payload; `replayed` is the
 * server saying so. A payable envelope missing its memo is a broken response
 * and must fall to `error`, not be drawn as a bill with a blank field.
 */
export function parseQuoteResponse(body: unknown): QuoteResult {
  if (!body || typeof body !== 'object') return unknownRefusal('')
  const raw = body as Record<string, unknown>

  if (raw.ok === false || typeof raw.error === 'string') return refusalOf(str(raw.error))

  if (raw.replayed === true) return {
    kind: 'replayed',
    bidId: str(raw.bidId),
    state: str(raw.state),
    usdMicros: num(raw.usdMicros),
    expiresAt: num(raw.expiresAt),
    settleable: raw.settleable === true,
  }

  const transfers = Array.isArray(raw.transfers)
    ? raw.transfers.flatMap((leg): QuoteTransfer[] => {
      if (!leg || typeof leg !== 'object') return []
      const row = leg as Record<string, unknown>
      const to = str(row.to)
      const baseUnits = str(row.baseUnits)
      // A leg missing its destination or its amount is not a leg to render
      // short - it is a response this page cannot vouch for.
      if (!to || !/^\d+$/.test(baseUnits)) return []
      return [{ to, owner: str(row.owner), baseUnits, kind: str(row.kind) || 'transfer' }]
    })
    : []

  const memo = str(raw.memo)
  const mint = str(raw.mint)
  const bidId = str(raw.bidId)
  const tokenProgram = str(raw.tokenProgram)
  const decimals = raw.decimals
  // EVERY FIELD A PAYMENT NEEDS, OR NO BILL AT ALL. A dialog that renders a
  // half-read envelope is a dialog that shows somebody an incomplete payment.
  //
  // `tokenProgram` AND `decimals` ARE IN THIS CHECK, and were the two holes in
  // it. Both used to fall through their coercions to a wrong value the bill then
  // printed as fact: an absent `tokenProgram` became an EMPTY COPY BOX for the
  // one address a buyer needs to build a `transferChecked`, and an absent
  // `decimals` became 0 - which makes `formatBaseUnits` hand back the base units
  // unchanged, so the "for reading only" line under an amount reads 10^decimals
  // too large. A buyer sanity-checking that against a wallet balance is reading
  // a number this page invented. The scale is part of the bill, so a bill
  // without it is not a bill.
  if (!memo || !mint || !bidId || !tokenProgram
    || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255
    || !transfers.length
    || transfers.length !== (Array.isArray(raw.transfers) ? raw.transfers.length : -1))
    return refusalOf('catwalk_quote_unreadable')

  return {
    kind: 'payable',
    bidId,
    memo,
    mint,
    tokenProgram,
    decimals,
    // VERBATIM, AND NEVER DEFAULTED TO A CLUSTER. An upstream that did not send
    // it leaves this empty and the dialog says the cluster is unstated; filling
    // in "mainnet-beta" here would be this page inventing the one fact the field
    // exists to establish.
    genesisHash: str(raw.genesisHash),
    transfers,
    usdMicros: num(raw.usdMicros),
    expiresAt: num(raw.expiresAt),
  }
}

/* ── WHOSE CLOCK SAYS THE QUOTE IS DEAD ──────────────────────────────────── */

/**
 * THE SERVER'S `now`, READ OFF THE RESPONSE THAT CARRIED THE QUOTE.
 *
 * `expiresAt` is an ABSOLUTE epoch-ms stamped by the server. Judging it against
 * `Date.now()` alone means the buyer's own device decides whether a bill is
 * live: a laptop resumed from sleep or a phone with auto-time off can be minutes
 * out, and a `quoteSeconds` of 60 is far inside that error. Slow clock and the
 * dialog shows a bill that died three minutes ago as payable - the transfer
 * verifies on chain, `settleBid` records `grace-elapsed`, the tokens moved and
 * the seat did not. Fast clock and the bill reads dead early, so the buyer mints
 * a second quote that raises the floor for everyone.
 *
 * So the HTTP `Date` of the response that delivered the quote is the anchor. It
 * is the same-origin server's own clock, it costs no extra call, and it is
 * always present on a real HTTP response.
 *
 * NULL WHEN IT CANNOT BE READ, never a fabricated instant - the caller then
 * falls back to the device clock and the dialog says which clock it is using.
 */
export function serverNowFrom(headerDate: string | null | undefined): number | null {
  if (!headerDate) return null
  const at = Date.parse(headerDate)
  return Number.isFinite(at) ? at : null
}

/** How far the viewer's clock is behind the server's, in ms. Added to every
 *  local reading afterwards, so one HTTP header keeps the countdown honest for
 *  the whole life of the quote. Zero when there is no anchor. */
export const clockSkew = (serverNow: number | null, localNow: number): number =>
  serverNow === null ? 0 : serverNow - localNow

/**
 * IS THIS BILL STILL PAYABLE?
 *
 * A quote expires, and an expired one must never be presented as something to
 * pay: the price may have moved and the seat may be gone. The memo, the bid id
 * and the signature field stay live regardless - a signature made in time still
 * settles inside the grace window, and the confirm route verifies the chain
 * before it asks whether the spot can be granted.
 */
export const quoteIsPayable = (quote: PayableQuote, now: number) => now < quote.expiresAt

/** "EXPIRES IN 0:43". Zero once it has, never a negative. */
export function countdownLabel(expiresAt: number, now: number): string {
  const left = Math.max(0, Math.floor((expiresAt - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

/* ── WHAT THE CONFIRM CALL CAN COME BACK AS ──────────────────────────────── */

export type ConfirmResult =
  /** The bid already carried a signature. Its durable record, not an error. */
  | { kind: 'already-seen'; state: string; reason: string | null; signature: string; message: string }
  /** Paid, verified, seat granted. */
  | { kind: 'granted'; spot: number | null; mint: string; message: string }
  /**
   * VERIFIED AND RECORDED, SEAT NOT GRANTED. The third outcome, and the one a
   * naive client renders as a failure. The tokens really moved; the bid is on
   * the operator's refund queue. Never the word "failed" on this branch.
   */
  | { kind: 'verified-not-granted'; state: string; reason: string | null; spot: number | null; mint: string; message: string }
  /** Settled false with nothing else to say. */
  | { kind: 'unsettled'; state: string; message: string }
  | ClaimError

/** _solz-elysia src/domain/catwalk.ts `CatwalkResolutionReason`, in English. */
export const RESOLUTION_REASON: Record<string, string> = {
  'outbid-at-settlement': 'someone paid more for this seat before your payment finalized',
  'team-already-active': 'this coin already holds a seat this season',
  'season-rolled': 'the season rolled over before your payment finalized',
  'quota-shrank': 'the ladder no longer has this seat on it',
  'lane-disabled': 'the outbid lane was switched off',
  'game-changed': 'the programme changed underneath this quote',
  'grace-elapsed': 'the payment finalized too long after the quote to be granted',
}

export const reasonInWords = (reason: string | null) =>
  reason ? RESOLUTION_REASON[reason] ?? reason : null

/**
 * The confirm response, sorted.
 *
 * BRANCHED ON `'settled' in body` FIRST, NEVER ON TRUTHINESS. The already-seen
 * response has no `settled` key at all, and `settled: false` is a real,
 * meaningful answer - reading either as "falsy, so it failed" turns a verified
 * payment into a lost one on screen.
 */
export function parseConfirmResponse(body: unknown): ConfirmResult {
  if (!body || typeof body !== 'object') return unknownRefusal('', 'confirm')
  const raw = body as Record<string, unknown>
  if (raw.ok === false || typeof raw.error === 'string') return refusalOf(str(raw.error), 'confirm')

  if (!('settled' in raw)) {
    const signature = str(raw.signature)
    // THE ALREADY-SEEN BRANCH IS MATCHED, NOT FALLEN INTO. It used to be the
    // default for any 200 body that carried neither `error` nor `settled`, so
    // an off-contract answer - upstream shape drift, a future envelope on this
    // path, a `{ ok: true }` - announced "this payment was already recorded" on
    // top of nothing at all, which is the single most reassuring sentence this
    // dialog can say and the one it has the least right to guess.
    //
    // The upstream's real already-seen body always carries a non-empty
    // `signature` (_solz-elysia/src/api/catwalk.ts:347-352), because the branch
    // exists precisely because `bid.signature` is set. Requiring it closes the
    // hole without changing one legitimate case, and `parseQuoteResponse`
    // already holds its own envelope to exactly this standard.
    if (!signature) return refusalOf('catwalk_confirm_unreadable', 'confirm')
    const state = str(raw.state)
    const reason = str(raw.reason) || null
    const words = reasonInWords(reason)
    return {
      kind: 'already-seen',
      state,
      reason,
      signature,
      message: `This payment was already recorded. Its state is ${state || 'unknown'}.${words ? ` It was ${words}.` : ''}`,
    }
  }

  const spot = typeof raw.spot === 'number' && Number.isFinite(raw.spot) ? raw.spot : null
  const mint = str(raw.mint)

  if (raw.settled === true) return {
    kind: 'granted',
    spot,
    mint,
    message: 'Paid, verified, and the seat is yours.',
  }

  const state = str(raw.state)
  if (state === 'superseded' || state === 'refundable') {
    const words = reasonInWords(str(raw.reason) || null)
    return {
      kind: 'verified-not-granted',
      state,
      reason: str(raw.reason) || null,
      spot,
      mint,
      message: `Your payment was verified and recorded. The seat could not be granted: ${words ?? 'the board moved underneath this quote'}. This bid is on the operator's refund queue.`,
    }
  }

  return {
    kind: 'unsettled',
    state,
    message: 'We could not settle this bid. Keep this signature and this bid id; a payment that reached the chain is not lost.',
  }
}

/* ── EVERY REFUSAL, IN WORDS ─────────────────────────────────────────────── */

/**
 * SORTED BY `error` STRING, NEVER BY HTTP STATUS.
 *
 * Seven of these return 500 from the upstream today - `catwalk_spot_out_of_range`,
 * `catwalk_team_already_holds_spot`, `catwalk_bid_unknown`,
 * `catwalk_burn_recipient_missing`, `catwalk_network_mismatch`,
 * `catwalk_payment_failed`, `catwalk_payment_unconfirmed` - because
 * _solz-elysia's `statusFor` has no rule for them. A client that branched on
 * status would show a buyer "the server is broken" when the true answer is
 * "this coin already holds a seat". So the status is never read.
 */
export const CLAIM_ERROR: Record<string, string> = {
  catwalk_sales_unavailable: 'Seats are not on sale at the moment.',
  catwalk_spot_out_of_range: 'That seat is not on the ladder any more.',
  catwalk_season_required: 'There is no live season, so nothing can be sold right now.',
  catwalk_team_already_holds_spot: 'This coin already holds a seat this season. One coin, one seat.',
  catwalk_open_quote_limit: 'You already have three unpaid quotes open. Pay one, or wait for one to expire.',
  // WORDED AS A SITE-WIDE WAIT ON PURPOSE. The upstream buckets quotes on the
  // caller's IP, and behind this site's own route every visitor arrives from
  // the deploy's single egress address - so ten a minute is the whole site's
  // budget, not this buyer's. "Try again" would be a lie about whose queue it is.
  catwalk_rate_limited: 'The sale is at its limit for this minute, across everyone using the site. Try again after the minute rolls over.',
  catwalk_busy: 'The server is saturated. Try again in a few seconds.',
  catwalk_idempotency_key_conflict: 'This request re-used a key with different details. Starting a fresh quote.',
  catwalk_token_price_unavailable: 'We could not read a live price for the payment token just now, so no quote can be issued. This is not about your coin.',
  catwalk_price_unavailable: 'We could not read a live price for the payment token just now, so no quote can be issued. This is not about your coin.',
  catwalk_rpc_unavailable: 'The chain read is unavailable right now.',
  catwalk_database_required: 'The chain read is unavailable right now.',
  catwalk_request_invalid: 'One of the addresses was not accepted. Check both and try again.',
  request_invalid: 'One of the addresses was not accepted. Check both and try again.',
  catwalk_burn_recipient_missing: 'The sale is misconfigured on the server. Nothing was charged.',
  catwalk_mint_configuration_invalid: 'The sale is misconfigured on the server. Nothing was charged.',
  catwalk_bid_unknown: 'We do not have that bid. Check the bid id.',
  catwalk_payment_memo_invalid: 'That transaction does not carry this quote’s memo. The memo must be in the same transaction, byte for byte.',
  catwalk_payment_transfer_invalid: 'That transaction does not contain exactly the transfers quoted above, as top-level transferChecked instructions. A plain transfer, an extra transfer, or a missing burn all read this way.',
  catwalk_payment_payer_invalid: 'That transaction was not signed by the wallet you declared.',
  catwalk_payment_received_amount_invalid: 'The destination did not actually receive the quoted amount.',
  catwalk_payment_time_invalid: 'That transaction is older than this quote.',
  catwalk_payment_unconfirmed: 'That signature is not finalized yet. Wait and confirm again.',
  catwalk_network_mismatch: 'That transaction is on a different cluster from the one this quote was issued for.',
  catwalk_payment_failed: 'That transaction did not succeed on chain.',
  // This route's own refusals, from src/server/catwalk-quote.ts.
  catwalk_upstream_unconfigured: 'The sale is not configured on this site. Nothing was charged.',
  catwalk_upstream_unreachable: 'We could not reach the sale. Nothing was charged.',
  catwalk_upstream_invalid: 'The sale answered with something this page cannot read. Nothing was charged.',
  catwalk_request_too_large: 'We could not reach the sale. Nothing was charged.',
  catwalk_quote_unreadable: 'The sale answered with an incomplete quote, so there is nothing safe to pay against. Nothing was charged.',
  // Raised by `parseConfirmResponse` alone, so its wording lives in the confirm
  // table below and never claims anything about whether tokens moved.
  catwalk_confirm_unreadable: 'The sale answered with a reply this page cannot read, so it cannot say what happened to this payment.',
}

/* ── THE SAME CODE MEANS TWO DIFFERENT THINGS AT THE TWO STAGES ──────────── */

/**
 * WHICH CALL FAILED. `'quote'` is before any money can have moved; `'confirm'`
 * is AFTER the buyer has been shown a bill, and quite possibly after they have
 * already sent the transfer.
 */
export type ClaimPhase = 'quote' | 'confirm'

/**
 * NEVER SAY "NOTHING WAS CHARGED" TO SOMEBODY WHO HAS ALREADY PAID.
 *
 * Three transport refusals are TRUE at the quote stage and FALSE at the confirm
 * stage, and they were reused verbatim across both. A buyer who built the
 * transfer, sent it, pasted the signature and lost their wifi was told "We could
 * not reach the sale. Nothing was charged." - so they send the transfer again.
 * The upstream verifier binds exactly one signature to a bid
 * (_solz-elysia/src/integrations/catwalk-payments.ts:66-128), so the second
 * transfer is tokens gone with no row that can ever claim them.
 *
 * Every sentence here states the same three things: this page could not ASK,
 * nothing about the payment itself is known from that, and the answer is NEVER
 * a second transaction.
 */
const KEEP_THE_SIGNATURE =
  'Whether your transaction was recorded is not known from this. Keep the signature and the bid id and press CONFIRM PAYMENT again — do NOT send a second transaction.'

export const CONFIRM_ERROR: Record<string, string> = {
  catwalk_upstream_unreachable: `We could not reach the sale to check your transaction. ${KEEP_THE_SIGNATURE}`,
  catwalk_upstream_invalid: `The sale answered with something this page cannot read. ${KEEP_THE_SIGNATURE}`,
  catwalk_upstream_unconfigured: `The sale is not configured on this site, so this page could not check your transaction. ${KEEP_THE_SIGNATURE}`,
  catwalk_request_too_large: `This page could not send the confirmation. ${KEEP_THE_SIGNATURE}`,
  catwalk_confirm_unreadable: `The sale answered with a reply this page cannot read. ${KEEP_THE_SIGNATURE}`,
  catwalk_burn_recipient_missing: `The sale is misconfigured on the server. ${KEEP_THE_SIGNATURE}`,
  catwalk_mint_configuration_invalid: `The sale is misconfigured on the server. ${KEEP_THE_SIGNATURE}`,
}

/** A code this page has never heard of is PRINTED, not swallowed. A money path
 *  that hides a reason it cannot translate is a money path that tells somebody
 *  nothing happened when something did.
 *
 *  THE EMPTY CODE - a network throw, a non-JSON body - is the dangerous one, so
 *  it too is answered per phase rather than with one sentence written for the
 *  stage where it happens to be true. */
const unknownRefusal = (code: string, phase: ClaimPhase = 'quote'): ClaimError => ({
  kind: 'error',
  code,
  message: code
    ? `The server refused this with a code this page does not know: ${code}`
    : phase === 'confirm'
      ? CONFIRM_ERROR.catwalk_upstream_unreachable!
      : 'We could not reach the sale. Nothing was charged.',
})

export const refusalOf = (code: string, phase: ClaimPhase = 'quote'): ClaimError => {
  const confirmWording = phase === 'confirm' ? CONFIRM_ERROR[code] : undefined
  if (confirmWording) return { kind: 'error', code, message: confirmWording }
  return CLAIM_ERROR[code] ? { kind: 'error', code, message: CLAIM_ERROR[code]! } : unknownRefusal(code, phase)
}

/** Whether a refusal is worth offering a retry for.
 *
 *  THE THREE 429s ARE NOT RETRIES, and `catwalk_team_already_holds_spot` least
 *  of all: every attempt that reaches the store raises the floor price for the
 *  next buyer. Nothing in this flow ever retries on its own. */
export const RETRYABLE = new Set([
  'catwalk_busy',
  'catwalk_token_price_unavailable',
  'catwalk_price_unavailable',
  'catwalk_rpc_unavailable',
  'catwalk_database_required',
  'catwalk_payment_unconfirmed',
  'catwalk_upstream_unreachable',
  'catwalk_upstream_invalid',
])

export const canRetry = (code: string) => RETRYABLE.has(code)

/* ── THE TWO CALLS, WITH NO REACT AROUND THEM ────────────────────────────── */

/**
 * BOTH NETWORK CALLS LIVE HERE so the thing that happens when they FAIL can be
 * tested without a browser. The failure wording on the confirm call is the whole
 * reason: it is the difference between a buyer keeping their signature and a
 * buyer sending a second transfer.
 *
 * Neither function retries, neither loops and neither times out on its own -
 * every attempt that reaches the store raises the floor price for the next
 * buyer, so a retry is always a press.
 */
export type ClaimFetcher = (input: string, init: RequestInit) => Promise<Response>

/** What came back, and the server clock that came back with it. */
export type Delivered<T> = { result: T; serverNow: number | null }

const POST_JSON = { accept: 'application/json', 'content-type': 'application/json' } as const

/** Every refusal on this path is read by its `error` STRING and never by its
 *  HTTP status - seven of these return 500 upstream today. A non-JSON body never
 *  invents a code; it becomes the empty one, which each phase words for itself. */
const readBody = async (response: Response): Promise<unknown> => {
  try { return await response.json() } catch { return { ok: false, error: '' } }
}

export async function requestQuote(ask: {
  fetcher: ClaimFetcher
  endpoint: string
  mint: string
  spot: number
  wallet: string
  idempotencyKey: string
}): Promise<Delivered<QuoteResult>> {
  let response: Response
  try {
    response = await ask.fetcher(ask.endpoint, {
      method: 'POST',
      headers: { ...POST_JSON },
      // EXACTLY THESE FOUR KEYS. The upstream schema is `.strict()`.
      body: JSON.stringify({
        mint: ask.mint, spot: ask.spot, wallet: ask.wallet, idempotencyKey: ask.idempotencyKey,
      }),
    })
  } catch {
    // NOTHING REACHED THE SALE, so "nothing was charged" is true here and is
    // the one place on this path it is true.
    return { result: refusalOf('catwalk_upstream_unreachable'), serverNow: null }
  }
  const serverNow = serverNowFrom(response.headers?.get?.('date'))
  return { result: parseQuoteResponse(await readBody(response)), serverNow }
}

export async function submitConfirm(ask: {
  fetcher: ClaimFetcher
  endpoint: string
  bidId: string
  signature: string
}): Promise<Delivered<ConfirmResult>> {
  let response: Response
  try {
    response = await ask.fetcher(ask.endpoint, {
      method: 'POST',
      headers: { ...POST_JSON },
      body: JSON.stringify({ bidId: ask.bidId, signature: ask.signature }),
    })
  } catch {
    // THE BUYER MAY ALREADY HAVE SENT THE TOKENS. This branch knows nothing
    // about that, and must not imply that it does.
    return { result: refusalOf('catwalk_upstream_unreachable', 'confirm'), serverNow: null }
  }
  const serverNow = serverNowFrom(response.headers?.get?.('date'))
  return { result: parseConfirmResponse(await readBody(response)), serverNow }
}

/* ── THE IDEMPOTENCY KEY ─────────────────────────────────────────────────── */

export const quoteKeyFor = (mint: string, spot: number) => `catwalk:quote:${mint}:${spot}`

/** In-memory fallback for a browser that refuses storage. Same process, same
 *  tab - which is still enough to survive a re-render. */
const memory = new Map<string, string>()

const mintUuid = () => {
  try {
    const uuid = globalThis.crypto?.randomUUID?.()
    if (uuid) return uuid
  } catch { /* a host without randomUUID is not a reason to fail the sale */ }
  // RFC 4122 v4 shape, from the same CSPRNG. Never Math.random: this key is
  // what stops a refresh minting a second live quote.
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * THE KEY FOR THIS (COIN, SEAT), RE-USED ACROSS A REFRESH.
 *
 * A fresh key mid-payment is a SECOND LIVE QUOTE: it raises the floor price for
 * everyone and burns one of the buyer's three open-quote slots. So the key is
 * persisted against the pair it was minted for and handed back on a reload.
 *
 * A NEW ONE IS MINTED ONLY when the coin or the seat changes - the upstream
 * refuses a replay naming a different mint or spot - or when the buyer
 * explicitly asks for a new quote, which is what `fresh` is for.
 */
export function idempotencyKey(mint: string, spot: number, fresh = false): string {
  const key = quoteKeyFor(mint, spot)
  if (!fresh) {
    try {
      const stored = globalThis.sessionStorage?.getItem(key)
      if (stored) return stored
    } catch { /* private mode and blocked storage both land here */ }
    const held = memory.get(key)
    if (held) return held
  }
  const minted = mintUuid()
  memory.set(key, minted)
  try { globalThis.sessionStorage?.setItem(key, minted) } catch { /* memory is enough */ }
  return minted
}
