import { expect, test } from 'bun:test'
import {
  ADDRESS, CLAIM_ERROR, SIGNATURE, addressProblem, canRetry, clockSkew, clusterName, countdownLabel,
  formatBaseUnits, idempotencyKey, parseConfirmResponse, parseQuoteResponse, quoteIsPayable,
  quoteKeyFor, reasonInWords, refusalOf, requestQuote, serverNowFrom, signatureProblem, submitConfirm,
} from '../src/components/catwalk/catwalkClaim'

/**
 * THE CLAIM PATH IS A MONEY SURFACE, and every rule that protects a buyer from
 * losing tokens lives in the pure module so it can be held here.
 *
 * NOTHING IN THIS FILE TOUCHES A NETWORK OR AN RPC. Every payload below is a
 * literal, which is the only honest way to test a bill.
 */

const MINT = 'So11111111111111111111111111111111111111112'
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SIG = 'a'.repeat(87)

/* ── ADDRESSES: THREE MISTAKES, THREE ANSWERS ────────────────────────────── */

test('an address refusal says which mistake was made, never just "invalid"', () => {
  expect(addressProblem('')).toBe('Paste an address.')
  expect(addressProblem('   ')).toBe('Paste an address.')
  // THE MOST USEFUL THING TO SAY to somebody who pasted the wrong string: a
  // signature is base58 too, but an address box is not where it goes.
  expect(addressProblem('0OIl' + 'a'.repeat(36))).toContain('never contain 0, O, I or l')
  expect(addressProblem('abc')).toBe('A Solana address is 32 to 44 characters; this is 3.')
  expect(addressProblem('a'.repeat(50))).toContain('this is 50')
  // A real one passes, and whitespace around it is trimmed rather than refused.
  expect(addressProblem(MINT)).toBeNull()
  expect(addressProblem(`  ${WALLET}  `)).toBeNull()
  expect(ADDRESS.test(MINT)).toBe(true)
})

test('an address pasted into the signature box is named as such', () => {
  expect(signatureProblem('')).toBe('Paste the transaction signature.')
  // The single most common paste error on this surface.
  expect(signatureProblem(WALLET)).toContain('looks like a wallet address')
  expect(signatureProblem('a'.repeat(60))).toBe('A transaction signature is 86 to 88 characters; this is 60.')
  expect(signatureProblem(SIG)).toBeNull()
  expect(SIGNATURE.test(SIG)).toBe(true)
})

/* ── BASE UNITS NEVER PASS THROUGH Number ────────────────────────────────── */

/**
 * `baseUnits` is an integer string on the wire and the obligation IS the base
 * units. A Number coercion does not throw, it rounds - and a rounded amount
 * looks entirely plausible sitting next to a plausible address.
 */
test('formatBaseUnits is exact past Number.MAX_SAFE_INTEGER and never rounds', () => {
  // Nine quadrillion base units at six decimals - well past 2^53, where a
  // Number would silently lose the tail.
  const huge = '9007199254740993000001'
  expect(formatBaseUnits(huge, 6)).toBe('9007199254740993.000001')
  expect(Number(huge).toString()).not.toBe(huge)

  expect(formatBaseUnits('1500000', 6)).toBe('1.5')
  expect(formatBaseUnits('1000000', 6)).toBe('1')
  expect(formatBaseUnits('1', 6)).toBe('0.000001')
  expect(formatBaseUnits('0', 6)).toBe('0')
  expect(formatBaseUnits('12345', 0)).toBe('12345')
  // NOT ROUNDED, EVER. Every digit the wire gave is a digit on screen.
  expect(formatBaseUnits('123456789', 9)).toBe('0.123456789')
})

test('formatBaseUnits refuses anything it cannot scale exactly, rather than guessing', () => {
  expect(formatBaseUnits('1.5', 6)).toBeNull()
  expect(formatBaseUnits('-1', 6)).toBeNull()
  expect(formatBaseUnits('1e6', 6)).toBeNull()
  expect(formatBaseUnits('', 6)).toBeNull()
  expect(formatBaseUnits('100', 1.5)).toBeNull()
  expect(formatBaseUnits('100', -1)).toBeNull()
  expect(formatBaseUnits('100', 999)).toBeNull()
})

/* ── A QUOTE IS A BILL, A REPLAY IS NOT ──────────────────────────────────── */

const payable = (over: Record<string, unknown> = {}) => ({
  ok: true,
  bidId: '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8',
  memo: 'catwalk:v1:3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8',
  mint: MINT,
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  decimals: 6,
  transfers: [{ to: WALLET, owner: MINT, baseUnits: '2000000', kind: 'treasury' }],
  usdMicros: 2_000_000,
  expiresAt: 1_800_000_060_000,
  ...over,
})

test('a payable quote parses with every field verbatim off the wire', () => {
  const quote = parseQuoteResponse(payable())
  expect(quote.kind).toBe('payable')
  if (quote.kind !== 'payable') return
  expect(quote.memo).toBe('catwalk:v1:3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8')
  expect(quote.mint).toBe(MINT)
  // STILL A STRING. Nothing in the parse coerces an amount.
  expect(quote.transfers[0]!.baseUnits).toBe('2000000')
  expect(typeof quote.transfers[0]!.baseUnits).toBe('string')
  expect(quote.transfers[0]!.to).toBe(WALLET)
  expect(quote.transfers[0]!.owner).toBe(MINT)
})

/** A single-entry `transfers` is NORMAL - the burn leg exists only when there
 *  is something to burn - and must never read as a missing half. */
test('one leg is a whole quote, and two legs stay in wire order', () => {
  const one = parseQuoteResponse(payable())
  expect(one.kind === 'payable' && one.transfers).toHaveLength(1)

  const two = parseQuoteResponse(payable({
    transfers: [
      { to: WALLET, owner: MINT, baseUnits: '1800000', kind: 'treasury' },
      { to: MINT, owner: WALLET, baseUnits: '200000', kind: 'burn' },
    ],
  }))
  expect(two.kind).toBe('payable')
  if (two.kind !== 'payable') return
  // NEVER RE-ORDERED AND NEVER MERGED.
  expect(two.transfers.map((leg) => leg.kind)).toEqual(['treasury', 'burn'])
  expect(two.transfers.map((leg) => leg.baseUnits)).toEqual(['1800000', '200000'])
})

/**
 * THE REPLAYED BRANCH IS ITS OWN STATE, NEVER A FRESH BILL.
 *
 * Detected on `replayed === true`, never by looking for a memo: "it has no
 * memo, so it must be replayed" is a guess about a payload, and paying against
 * a replayed quote a second time sends real tokens to a bid that can no longer
 * buy anything.
 */
test('a replayed quote never parses as something to pay', () => {
  const replay = parseQuoteResponse({
    ok: true, replayed: true, bidId: 'bid-1', state: 'expired',
    usdMicros: 2_000_000, expiresAt: 1_800_000_000_000, settleable: false,
  })
  expect(replay.kind).toBe('replayed')
  if (replay.kind !== 'replayed') return
  expect(replay.state).toBe('expired')
  expect(replay.settleable).toBe(false)
  // There is no memo, no mint and no transfers on this shape at all.
  expect('memo' in replay).toBe(false)
  expect('transfers' in replay).toBe(false)
})

test('a replayed quote that can still be settled says so', () => {
  const replay = parseQuoteResponse({
    ok: true, replayed: true, bidId: 'bid-2', state: 'quoted',
    usdMicros: 1_000_000, expiresAt: 1, settleable: true,
  })
  expect(replay.kind === 'replayed' && replay.settleable).toBe(true)
})

/** A half-read envelope is not a bill to render short. A payable response
 *  missing its memo, its mint or a leg's amount is a response this page cannot
 *  vouch for, and it must fall to an error rather than draw a blank field. */
test('an incomplete payable envelope is refused rather than drawn with gaps', () => {
  for (const broken of [
    payable({ memo: '' }),
    payable({ mint: '' }),
    payable({ bidId: '' }),
    payable({ transfers: [] }),
    payable({ transfers: [{ to: '', owner: MINT, baseUnits: '1', kind: 'treasury' }] }),
    payable({ transfers: [{ to: WALLET, owner: MINT, baseUnits: '1.5', kind: 'treasury' }] }),
  ]) {
    const parsed = parseQuoteResponse(broken)
    expect(parsed.kind).toBe('error')
  }
})

/* ── AN EXPIRED QUOTE IS NEVER PAYABLE ───────────────────────────────────── */

test('a quote stops being payable the moment it expires', () => {
  const quote = parseQuoteResponse(payable({ expiresAt: 1_000 }))
  expect(quote.kind).toBe('payable')
  if (quote.kind !== 'payable') return
  expect(quoteIsPayable(quote, 999)).toBe(true)
  // Exactly at the expiry it is already dead: the boundary belongs to the
  // server, and a bill "live" for its final millisecond is a bill somebody pays.
  expect(quoteIsPayable(quote, 1_000)).toBe(false)
  expect(quoteIsPayable(quote, 60_000)).toBe(false)
})

test('the countdown reaches zero and never goes negative', () => {
  expect(countdownLabel(60_000, 17_000)).toBe('0:43')
  expect(countdownLabel(125_000, 0)).toBe('2:05')
  expect(countdownLabel(1_000, 9_000)).toBe('0:00')
})

/* ── CONFIRM: FOUR OUTCOMES, AND THREE OF THEM ARE NOT FAILURES ──────────── */

/**
 * BRANCHED ON `'settled' in body` FIRST, NEVER ON TRUTHINESS. The already-seen
 * response has no `settled` key at all and `settled: false` is a real answer;
 * reading either as "falsy, so it failed" turns a verified payment into a lost
 * one on screen.
 */
test('a bid that already carries a signature is its record, not an error', () => {
  const result = parseConfirmResponse({ ok: true, state: 'granted', reason: null, signature: SIG })
  expect(result.kind).toBe('already-seen')
  if (result.kind !== 'already-seen') return
  expect(result.signature).toBe(SIG)
  expect(result.message).toContain('already recorded')
  expect(result.message).not.toContain('failed')
})

test('a granted seat is named from the response, never from the request', () => {
  const result = parseConfirmResponse({ ok: true, settled: true, spot: 7, mint: MINT })
  expect(result.kind).toBe('granted')
  if (result.kind !== 'granted') return
  expect(result.spot).toBe(7)
  expect(result.mint).toBe(MINT)
  expect(result.message).toBe('Paid, verified, and the seat is yours.')
})

/**
 * THE THIRD OUTCOME, WHICH A NAIVE CLIENT RENDERS AS A FAILURE. The tokens
 * really moved; the bid is on the operator's refund queue. Never the word
 * "failed" on this branch.
 */
test('a verified payment that did not win the seat is never called a failure', () => {
  for (const [reason, words] of [
    ['outbid-at-settlement', 'someone paid more for this seat before your payment finalized'],
    ['team-already-active', 'this coin already holds a seat this season'],
    ['season-rolled', 'the season rolled over before your payment finalized'],
    ['quota-shrank', 'the ladder no longer has this seat on it'],
    ['lane-disabled', 'the outbid lane was switched off'],
    ['game-changed', 'the programme changed underneath this quote'],
    ['grace-elapsed', 'the payment finalized too long after the quote to be granted'],
  ]) {
    const result = parseConfirmResponse({
      ok: true, settled: false, state: 'refundable', reason, spot: 3, mint: MINT,
    })
    expect(result.kind).toBe('verified-not-granted')
    if (result.kind !== 'verified-not-granted') continue
    expect(result.message).toContain(words!)
    expect(result.message).toContain('verified and recorded')
    expect(result.message).toContain('refund queue')
    expect(result.message).not.toContain('failed')
    expect(reasonInWords(reason!)).toBe(words!)
  }
  // 'superseded' is the same answer under a different state.
  const superseded = parseConfirmResponse({
    ok: true, settled: false, state: 'superseded', reason: 'outbid-at-settlement', spot: 1, mint: MINT,
  })
  expect(superseded.kind).toBe('verified-not-granted')
})

/** A reason from a server newer than this page is PRINTED, not swallowed. */
test('an unrecognised resolution reason is shown as itself', () => {
  expect(reasonInWords('something-new')).toBe('something-new')
  expect(reasonInWords(null)).toBeNull()
})

test('an unsettled bid never suggests paying again', () => {
  const result = parseConfirmResponse({ ok: true, settled: false })
  expect(result.kind).toBe('unsettled')
  if (result.kind !== 'unsettled') return
  expect(result.message).toContain('is not lost')
  expect(result.message.toLowerCase()).not.toContain('pay again')
  expect(result.message.toLowerCase()).not.toContain('try again')
})

/* ── EVERY REFUSAL CODE MAPS TO A SENTENCE ───────────────────────────────── */

/**
 * SORTED BY `error` STRING, NEVER BY HTTP STATUS. Seven of these return 500
 * from the upstream today because its `statusFor` has no rule for them, so a
 * client branching on status would show "the server is broken" when the true
 * answer is "this coin already holds a seat".
 */
test('every documented refusal code is a sentence a buyer can act on', () => {
  const codes = [
    'catwalk_sales_unavailable', 'catwalk_spot_out_of_range', 'catwalk_season_required',
    'catwalk_team_already_holds_spot', 'catwalk_open_quote_limit', 'catwalk_rate_limited',
    'catwalk_busy', 'catwalk_idempotency_key_conflict', 'catwalk_token_price_unavailable',
    'catwalk_price_unavailable', 'catwalk_rpc_unavailable', 'catwalk_database_required',
    'catwalk_request_invalid', 'request_invalid', 'catwalk_request_too_large',
    'catwalk_burn_recipient_missing', 'catwalk_mint_configuration_invalid', 'catwalk_bid_unknown',
    'catwalk_payment_memo_invalid', 'catwalk_payment_transfer_invalid', 'catwalk_payment_payer_invalid',
    'catwalk_payment_received_amount_invalid', 'catwalk_payment_time_invalid',
    'catwalk_payment_unconfirmed', 'catwalk_network_mismatch', 'catwalk_payment_failed',
  ]
  for (const code of codes) {
    const refusal = refusalOf(code)
    expect(refusal.kind).toBe('error')
    expect(refusal.code).toBe(code)
    expect(CLAIM_ERROR[code]).toBeTruthy()
    // A sentence, not a code echoed back at somebody.
    expect(refusal.message).not.toContain(code)
    expect(refusal.message.length).toBeGreaterThan(20)
  }
})

/** A MONEY PATH MUST NEVER SWALLOW A REASON IT CANNOT TRANSLATE. */
test('a code this page has never heard of is printed, not hidden', () => {
  const refusal = refusalOf('catwalk_something_new')
  expect(refusal.message).toContain('catwalk_something_new')
  expect(refusal.message).toContain('does not know')
})

test('a network throw or an unreadable body never invents a code', () => {
  expect(refusalOf('').message).toBe('We could not reach the sale. Nothing was charged.')
  expect(parseQuoteResponse(null).kind).toBe('error')
  expect(parseConfirmResponse('nonsense').kind).toBe('error')
})

/** The wording the owner has to be told about: behind this site's own route,
 *  every visitor arrives from the deploy's single egress IP, so the upstream's
 *  ten-a-minute bucket is the WHOLE SITE'S budget rather than this buyer's. */
test('the rate limit is worded as a site-wide wait, not as this buyer being throttled', () => {
  expect(CLAIM_ERROR.catwalk_rate_limited).toContain('across everyone using the site')
  expect(CLAIM_ERROR.catwalk_rate_limited).not.toContain('You have')
})

/**
 * NOTHING AUTO-RETRIES, AND THE THREE 429s OFFER NO RETRY AT ALL.
 *
 * Every quote that reaches the store raises the floor price for the next buyer,
 * and `catwalk_team_already_holds_spot` is the worst of them - retrying it can
 * never succeed and costs everybody else money.
 */
test('no refusal that raises the floor price offers a retry', () => {
  for (const code of [
    'catwalk_team_already_holds_spot', 'catwalk_open_quote_limit', 'catwalk_rate_limited',
    'catwalk_sales_unavailable', 'catwalk_spot_out_of_range', 'catwalk_season_required',
    'catwalk_burn_recipient_missing', 'catwalk_mint_configuration_invalid',
  ]) expect(canRetry(code)).toBe(false)

  // These are genuinely transient and are offered as a PRESS, never automatic.
  for (const code of ['catwalk_busy', 'catwalk_rpc_unavailable', 'catwalk_payment_unconfirmed'])
    expect(canRetry(code)).toBe(true)
})

/* ── THE IDEMPOTENCY KEY ─────────────────────────────────────────────────── */

/**
 * A FRESH KEY MID-PAYMENT IS A SECOND LIVE QUOTE: it raises the floor for
 * everyone and burns one of the buyer's three open-quote slots. So the key is
 * held against the (coin, seat) pair and handed back on a reload.
 */
test('the idempotency key survives a reload and is minted per coin and seat', () => {
  const store = new Map<string, string>()
  ;(globalThis as any).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
  }
  const first = idempotencyKey(MINT, 4)
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  // The same pair, again - which is what a refresh mid-payment looks like.
  expect(idempotencyKey(MINT, 4)).toBe(first)
  expect(store.get(quoteKeyFor(MINT, 4))).toBe(first)

  // A DIFFERENT SEAT IS A DIFFERENT QUOTE. The upstream refuses a replay naming
  // a different mint or spot, so re-using the key would be a guaranteed 400.
  expect(idempotencyKey(MINT, 5)).not.toBe(first)
  expect(idempotencyKey(WALLET, 4)).not.toBe(first)

  // AND A NEW ONE ONLY WHEN THE BUYER ASKS.
  const fresh = idempotencyKey(MINT, 4, true)
  expect(fresh).not.toBe(first)
  expect(idempotencyKey(MINT, 4)).toBe(fresh)
  delete (globalThis as any).sessionStorage
})

/** A browser that refuses storage is not a reason to fail a sale - the key
 *  falls back to memory, which still survives a re-render. */
test('a blocked sessionStorage does not break the key', () => {
  ;(globalThis as any).sessionStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
  }
  const key = idempotencyKey('BlockedStorageMint111111111111111111111111', 9)
  expect(key).toMatch(/^[0-9a-f-]{36}$/)
  expect(idempotencyKey('BlockedStorageMint111111111111111111111111', 9)).toBe(key)
  delete (globalThis as any).sessionStorage
})

/* ── THE CONFIRM STAGE IS NOT THE QUOTE STAGE ────────────────────────────── */

/**
 * "NOTHING WAS CHARGED" IS TRUE BEFORE THE TRANSFER AND FALSE AFTER IT.
 *
 * The three transport refusals were written for the quote stage, where they are
 * true, and reused verbatim at confirm, where they are not. A buyer who built
 * the one-transaction payment, sent it, pasted the signature and lost their wifi
 * was told their tokens had not moved - so they send the transfer again. The
 * upstream binds exactly ONE signature to a bid
 * (_solz-elysia/src/integrations/catwalk-payments.ts:66-128), so the second
 * transfer is tokens gone with no row that can ever claim them.
 */
test('no refusal at the confirm stage ever claims that nothing was charged', () => {
  for (const code of [
    'catwalk_upstream_unreachable', 'catwalk_upstream_invalid', 'catwalk_upstream_unconfigured',
    'catwalk_request_too_large', 'catwalk_confirm_unreadable', 'catwalk_burn_recipient_missing',
    'catwalk_mint_configuration_invalid',
    // The empty code - a network throw, or a body that would not parse - is the
    // most dangerous of the lot, because it is what a dropped connection looks
    // like at the exact moment a buyer has just paid.
    '',
  ]) {
    const refusal = refusalOf(code, 'confirm')
    expect(refusal.message).not.toContain('Nothing was charged')
    expect(refusal.message).toContain('do NOT send a second transaction')
    expect(refusal.message).toContain('Keep the signature')
  }
  // AND THE QUOTE STAGE IS UNCHANGED, because there the sentence is true.
  expect(refusalOf('catwalk_upstream_unreachable').message).toContain('Nothing was charged')
  expect(refusalOf('').message).toContain('Nothing was charged')
})

/** The same wording reaches the dialog through the parser, which is how the
 *  refusal actually arrives on a confirm call. */
test('an upstream refusal body on the confirm call is worded for the confirm stage', () => {
  const dropped = parseConfirmResponse({ ok: false, error: '' })
  expect(dropped.kind).toBe('error')
  expect(dropped.message).not.toContain('Nothing was charged')
  const unreachable = parseConfirmResponse({ ok: false, error: 'catwalk_upstream_unreachable' })
  expect(unreachable.message).not.toContain('Nothing was charged')
  // A refusal about the TRANSACTION keeps its own words - it is about what was
  // read on chain, not about whether this page could ask.
  expect(parseConfirmResponse({ ok: false, error: 'catwalk_payment_memo_invalid' }).message)
    .toContain('byte for byte')
})

/**
 * THE ALREADY-SEEN BRANCH IS MATCHED, NOT FALLEN INTO.
 *
 * It used to be the default for any 200 body carrying neither `error` nor
 * `settled`, so an off-contract answer announced "this payment was already
 * recorded" - the most reassuring sentence this dialog can say - on top of
 * nothing at all. The upstream's real already-seen body always carries a
 * non-empty signature, because the branch exists because `bid.signature` is set.
 */
test('a confirm answer with no signature is never announced as a recorded payment', () => {
  const bare = parseConfirmResponse({ ok: true })
  expect(bare.kind).toBe('error')
  expect(bare.message).not.toContain('already recorded')
  expect(bare.message).toContain('do NOT send a second transaction')
  expect(parseConfirmResponse({ ok: true, state: 'granted', signature: '' }).kind).toBe('error')
  // The real shape still parses exactly as it did.
  const real = parseConfirmResponse({ ok: true, state: 'granted', reason: null, signature: SIG })
  expect(real.kind).toBe('already-seen')
})

/* ── WHICH CHAIN THE BILL IS FOR ─────────────────────────────────────────── */

/**
 * The same base58 is a valid account on every cluster, so a devnet treasury
 * renders exactly like a mainnet one. `genesisHash` is the only field that tells
 * a buyer BEFORE the transfer; it used to be dropped by the parser, leaving
 * `catwalk_network_mismatch` at confirm - after the tokens had left - as the
 * first notice.
 */
test('the cluster the quote was issued for survives the parse', () => {
  const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
  const quote = parseQuoteResponse(payable({ genesisHash: MAINNET }))
  expect(quote.kind).toBe('payable')
  if (quote.kind !== 'payable') return
  expect(quote.genesisHash).toBe(MAINNET)
  expect(clusterName(MAINNET)).toBe('MAINNET-BETA')
  expect(clusterName('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')).toBe('DEVNET')
  // NEVER MAINNET BY DEFAULT. An unknown hash is unknown, and the dialog says so.
  expect(clusterName('NotAGenesisHash11111111111111111111111111')).toBeNull()

  // AN UPSTREAM THAT HAS NOT SHIPPED THE FIELD STILL SELLS. A missing cluster is
  // a warning on the bill, not a dead sale - but it is never filled in.
  const silent = parseQuoteResponse(payable())
  expect(silent.kind).toBe('payable')
  if (silent.kind !== 'payable') return
  expect(silent.genesisHash).toBe('')
})

/* ── THE SCALE IS PART OF THE BILL ───────────────────────────────────────── */

/**
 * `tokenProgram` and `decimals` were outside the "every field or no bill at all"
 * check, and both fell through to a wrong value the bill then printed as fact: an
 * empty copy box for the program a buyer needs to build a `transferChecked`, and
 * decimals 0 - which makes `formatBaseUnits` hand back the base units unchanged,
 * so the "for reading only" figure is 10^decimals too large.
 */
test('a quote without a token program or a usable scale is refused, not drawn', () => {
  for (const broken of [
    payable({ tokenProgram: '' }),
    payable({ tokenProgram: undefined }),
    payable({ decimals: undefined }),
    payable({ decimals: '6' }),
    payable({ decimals: 6.5 }),
    payable({ decimals: -1 }),
    payable({ decimals: 256 }),
  ]) {
    expect(parseQuoteResponse(broken).kind).toBe('error')
  }
  // Zero decimals is a REAL token and still parses - the refusal above is about
  // a scale that did not arrive, never about a small one.
  const whole = parseQuoteResponse(payable({ decimals: 0 }))
  expect(whole.kind).toBe('payable')
})

/* ── WHOSE CLOCK SAYS THE BILL IS DEAD ───────────────────────────────────── */

/**
 * `expiresAt` is an absolute instant chosen by the server. Judged against
 * `Date.now()` alone, a laptop resumed from sleep decides whether a bill is
 * live: three minutes slow and the dialog presents a quote that died three
 * minutes ago, the transfer verifies on chain and `settleBid` records
 * `grace-elapsed` - tokens moved, seat not granted.
 */
test('the expiry is anchored to the clock of the server that issued the quote', () => {
  const stamp = 'Tue, 16 Sep 2025 12:00:00 GMT'
  const server = Date.parse(stamp)
  expect(serverNowFrom(stamp)).toBe(server)
  // Unreadable or absent is NULL, never a fabricated instant.
  expect(serverNowFrom(null)).toBeNull()
  expect(serverNowFrom('')).toBeNull()
  expect(serverNowFrom('not a date')).toBeNull()

  // A device three minutes SLOW. The skew carries the difference for the life of
  // the quote, so one header keeps the countdown honest.
  const local = server - 180_000
  const skew = clockSkew(server, local)
  expect(skew).toBe(180_000)
  const quote = parseQuoteResponse(payable({ expiresAt: server + 60_000 }))
  expect(quote.kind).toBe('payable')
  if (quote.kind !== 'payable') return
  // Unanchored, the slow device calls a bill live for another four minutes.
  expect(quoteIsPayable(quote, local + 200_000)).toBe(true)
  // Anchored, it is dead when the server says it is.
  expect(quoteIsPayable(quote, local + 200_000 + skew)).toBe(false)
  expect(countdownLabel(quote.expiresAt, local + skew)).toBe('1:00')
  // With no anchor at all the skew is zero and nothing shifts.
  expect(clockSkew(null, local)).toBe(0)
})

/* ── THE TWO CALLS, AND WHAT THEY SAY WHEN THEY FAIL ─────────────────────── */

const jsonResponse = (body: unknown, date?: string) =>
  new Response(JSON.stringify(body), {
    headers: date
      ? { 'content-type': 'application/json', date }
      : { 'content-type': 'application/json' },
  })

test('a quote is asked for with exactly four keys, and its Date is the clock anchor', async () => {
  const stamp = 'Tue, 16 Sep 2025 12:00:00 GMT'
  let sent: unknown = null
  const { result, serverNow } = await requestQuote({
    fetcher: async (_url, init) => { sent = JSON.parse(String(init.body)); return jsonResponse(payable(), stamp) },
    endpoint: '/api/catwalk/quote',
    mint: MINT,
    spot: 4,
    wallet: WALLET,
    idempotencyKey: '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8',
  })
  expect(result.kind).toBe('payable')
  expect(serverNow).toBe(Date.parse(stamp))
  // EXACTLY THESE FOUR. The upstream schema is `.strict()`.
  expect(Object.keys(sent as object).sort()).toEqual(['idempotencyKey', 'mint', 'spot', 'wallet'])
})

test('a quote that never reached the sale says so, and says nothing was charged', async () => {
  const { result, serverNow } = await requestQuote({
    fetcher: async () => { throw new Error('offline') },
    endpoint: '/api/catwalk/quote',
    mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: 'k',
  })
  expect(result.kind).toBe('error')
  expect(result.message).toContain('Nothing was charged')
  expect(serverNow).toBeNull()
})

/** THE ONE THAT COSTS SOMEBODY THEIR TOKENS. A confirm that never reached the
 *  sale knows nothing about the transfer, and must not imply that it does. */
test('a confirm that never reached the sale never says the payment did not happen', async () => {
  const { result } = await submitConfirm({
    fetcher: async () => { throw new Error('offline') },
    endpoint: '/api/catwalk/confirm',
    bidId: 'bid-1',
    signature: SIG,
  })
  expect(result.kind).toBe('error')
  expect(result.message).not.toContain('Nothing was charged')
  expect(result.message).toContain('do NOT send a second transaction')
})

/** A non-JSON answer on the confirm path lands in the same place, by the same
 *  route: the body is unreadable, so the code is empty and the phase words it. */
test('an unreadable confirm answer is worded for a buyer who may already have paid', async () => {
  const { result } = await submitConfirm({
    fetcher: async () => new Response('<html>502</html>', { headers: { 'content-type': 'text/html' } }),
    endpoint: '/api/catwalk/confirm',
    bidId: 'bid-1',
    signature: SIG,
  })
  expect(result.kind).toBe('error')
  expect(result.message).not.toContain('Nothing was charged')
  expect(result.message).toContain('Keep the signature')
})

/** And a granted seat still comes back whole through the call. */
test('a granted confirmation reaches the dialog as granted', async () => {
  const { result } = await submitConfirm({
    fetcher: async () => jsonResponse({ ok: true, settled: true, spot: 3, mint: MINT }),
    endpoint: '/api/catwalk/confirm',
    bidId: 'bid-1',
    signature: SIG,
  })
  expect(result.kind).toBe('granted')
})
