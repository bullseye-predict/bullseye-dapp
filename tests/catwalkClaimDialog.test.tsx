import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CatwalkClaimBill, CatwalkClaimDialog } from '../src/components/catwalk/CatwalkClaimDialog'
import type { PayableQuote } from '../src/components/catwalk/catwalkClaim'
import type { CatwalkLadderSeat } from '../src/components/catwalk/catwalkBands'

/**
 * THE BILL IS THE ONE SURFACE IN THIS FEATURE THAT MOVES REAL MONEY, AND IT HAD
 * NO TEST AT ALL.
 *
 * Every assertion below was chosen because a plausible one-token edit to
 * src/components/catwalk/CatwalkClaimDialog.tsx used to pass the whole suite
 * while costing a buyer their tokens: the memo swapped for the bid id (a payment
 * that can never be matched to a bid), `to` swapped for `owner` (tokens sent to
 * a wallet instead of its token account, which the upstream verifier at
 * _solz-elysia/src/integrations/catwalk-payments.ts:100 can never match), a
 * deleted expiry banner, a base-unit string put through a formatter.
 *
 * THIS REPO CARRIES NO jsdom, happy-dom OR testing-library, so a click cannot be
 * driven here and the dialog's stages cannot be advanced. That is exactly why
 * `CatwalkClaimBill` is a separate, stateless component: everything a buyer
 * copies off the payable tray is a PROP, so `renderToStaticMarkup` can hold each
 * one to the quote it came from. The transport and its refusals are held in
 * tests/catwalkClaim.test.ts, which needs no DOM either.
 */

/** Structurally valid base58 that belongs to nobody. A real mainnet address in
 *  a fixture invites somebody to copy it out of a test and pay it. */
const MINT = 'PaymentM1ntZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
const COIN = 'P1acedCo1nZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
const WALLET = 'BuyerWa11etZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
const TREASURY_ATA = 'TreasuryAtaZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
const TREASURY_OWNER = 'TreasuryOwnerZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
const BURN_ATA = 'BurnAtaZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
const BURN_OWNER = 'BurnOwnerZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'

const EXPIRES = 1_800_000_060_000

/** A two-leg bill, which is the shape with the most ways to go wrong. */
const quote = (over: Partial<PayableQuote> = {}): PayableQuote => ({
  kind: 'payable',
  bidId: '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8',
  memo: 'catwalk:v1:3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8',
  mint: MINT,
  tokenProgram: TOKEN_PROGRAM,
  decimals: 9,
  genesisHash: MAINNET,
  transfers: [
    { to: TREASURY_ATA, owner: TREASURY_OWNER, baseUnits: '18446744073709551615', kind: 'treasury' },
    { to: BURN_ATA, owner: BURN_OWNER, baseUnits: '200000000', kind: 'burn' },
  ],
  usdMicros: 2_000_000,
  expiresAt: EXPIRES,
  ...over,
})

const bill = (over: Partial<PayableQuote> = {}, props: Partial<{
  dead: boolean; now: number; anchored: boolean; coin: string; wallet: string
}> = {}) => renderToStaticMarkup(
  <CatwalkClaimBill
    quote={quote(over)}
    coin={props.coin ?? COIN}
    wallet={props.wallet ?? WALLET}
    dead={props.dead ?? false}
    now={props.now ?? EXPIRES - 43_000}
    anchored={props.anchored ?? true}
  />,
)

/* ── EVERY VALUE ON THE BILL IS THE QUOTE'S OWN ──────────────────────────── */

/**
 * THE MEMO IS THE ONLY THING BINDING A PAYMENT TO A BID, and it is copied from
 * the prop rather than from the DOM - so what the button writes to the clipboard
 * is asserted here through the `aria-label`, which carries the whole value once.
 */
test('the memo on the bill is the quote’s memo, whole, and never the bid id', () => {
  const html = bill()
  const bid = quote()
  expect(html).toContain(`Copy the payment memo ${bid.memo}`)
  // THE EXACT MUTATION THE SUITE USED TO MISS: `value={quote.bidId}` on the memo
  // copy. The two strings share a substring, so this asserts the label pairing.
  expect(html).not.toContain(`Copy the payment memo ${bid.bidId}`)
  // And the bid id is still its own copyable field elsewhere on the tray.
  expect(html).toContain(`Copy the bid id ${bid.bidId}`)
  // NEVER ABBREVIATED. An ellipsis in a memo is a payment nobody can match.
  expect(html).toContain(`<code>${bid.memo}</code>`)
  expect(html).not.toContain('…')
})

/**
 * SEND TO THE TOKEN ACCOUNT, NOT THE OWNER WALLET. Tokens sent to the owner are
 * unrecoverable and `verifyCatwalkPayment` can never match them, so the two
 * addresses must never trade places.
 */
test('each leg sends to its destination token account, with the owner marked as not that', () => {
  const html = bill()
  expect(html).toContain(`Copy the destination token account ${TREASURY_ATA}`)
  expect(html).toContain(`Copy the destination owner ${TREASURY_OWNER}`)
  expect(html).toContain(`Copy the destination token account ${BURN_ATA}`)
  expect(html).toContain(`Copy the destination owner ${BURN_OWNER}`)
  // The swap, in both directions.
  expect(html).not.toContain(`Copy the destination token account ${TREASURY_OWNER}`)
  expect(html).not.toContain(`Copy the destination owner ${TREASURY_ATA}`)
  // The warning that makes the distinction actionable is on the tray itself.
  expect(html).toContain('this is NOT where you send')
  expect(html).toContain('DESTINATION TOKEN ACCOUNT, not to the owner wallet')
})

/** IN WIRE ORDER, NEVER RE-ORDERED AND NEVER MERGED. A quote whose legs are
 *  drawn out of order is a transaction built in the wrong order. */
test('the legs are drawn in wire order, each with its own kind', () => {
  const html = bill()
  expect(html.indexOf(TREASURY_ATA)).toBeLessThan(html.indexOf(BURN_ATA))
  expect(html).toContain('<h3>TREASURY</h3>')
  expect(html).toContain('<h3>BURN</h3>')
})

/**
 * BASE UNITS ARE THE OBLIGATION, AND THEY ARE A STRING.
 *
 * The fixture's first leg is 2^64-1, which no Number can hold: if the value ever
 * passes through one, the digits on screen change and this fails.
 */
test('the amount a buyer copies is the base-unit string from the wire, exact', () => {
  const html = bill()
  expect(html).toContain('Copy the amount in base units 18446744073709551615')
  expect(html).toContain('<code>18446744073709551615</code>')
  // The scaled figure is present, correct for THIS quote's decimals, and
  // labelled as unsendable.
  expect(html).toContain('18446744073.709551615 — for reading only; send the base units above')
})

/** A one-leg quote is normal - the burn leg exists only when there is something
 *  to burn - and must not read as a missing half. */
test('a single-leg bill is a whole bill', () => {
  const html = bill({ transfers: [{ to: TREASURY_ATA, owner: TREASURY_OWNER, baseUnits: '2000000000', kind: 'treasury' }] })
  expect(html).toContain('<h3>TREASURY</h3>')
  expect(html).not.toContain('<h3>BURN</h3>')
  expect(html).toContain('2 — for reading only')
})

/* ── THE WALLET THE BID IS BOUND TO IS ON THE BILL ───────────────────────── */

/**
 * The bill's rules point at the declared wallet, and the input that collected it
 * is unmounted by the time the bill is on screen. It used to say "the wallet you
 * typed above" with nothing above it: a buyer who mistyped one character - still
 * 44 characters, still base58, so every check on both sides passes - had no way
 * to catch it until `catwalk_payment_payer_invalid` at confirm, with the tokens
 * already gone.
 */
test('the bill echoes the wallet the bid was minted against, and the coin being placed', () => {
  const html = bill()
  expect(html).toContain(`Copy the wallet you declared ${WALLET}`)
  expect(html).toContain('PAY FROM — the wallet you declared')
  expect(html).toContain('signed by the wallet shown below')
  expect(html).not.toContain('the wallet you typed above')
  // The coin being placed is NOT `quote.mint` - that is the payment token - so
  // both are on the tray and they are labelled apart.
  expect(html).toContain(`Copy the coin you are placing ${COIN}`)
  expect(html).toContain(`Copy the payment token mint ${MINT}`)
})

/* ── WHICH CHAIN, BEFORE THE TOKENS MOVE ─────────────────────────────────── */

/**
 * The same base58 is a valid account on every cluster, so a devnet bill and a
 * mainnet one are indistinguishable by their addresses. The upstream publishes
 * `genesisHash` for exactly this reason and it used to be dropped on the floor
 * by the parser; a buyer only learned as `catwalk_network_mismatch` at confirm.
 */
test('the bill names the cluster it is for, and prints the hash whatever it is called', () => {
  const html = bill()
  expect(html).toContain('THE CLUSTER THIS BILL IS FOR')
  expect(html).toContain('MAINNET-BETA')
  expect(html).toContain(`Copy the cluster genesis hash ${MAINNET}`)

  const devnet = bill({ genesisHash: DEVNET })
  expect(devnet).toContain('DEVNET')
  expect(devnet).toContain(`Copy the cluster genesis hash ${DEVNET}`)
  // NEVER MAINNET BY DEFAULT: a hash this page does not know is named as such.
  const strange = bill({ genesisHash: 'SomeOtherGenesisHashZZZZZZZZZZZZZZZZZZZZZZ' })
  expect(strange).toContain('UNRECOGNISED CLUSTER')
  expect(strange).not.toContain('MAINNET-BETA')
  // And an upstream that sent nothing gets a warning, not a blank and not a guess.
  const silent = bill({ genesisHash: '' })
  expect(silent).toContain('did not say which cluster')
  expect(silent).not.toContain('MAINNET-BETA')
})

/* ── AN EXPIRED BILL SAYS SO, AND SAYS WHOSE CLOCK SAID IT ───────────────── */

test('a dead quote leads with a refusal to pay and drops the countdown', () => {
  const live = bill()
  expect(live).toContain('EXPIRES IN 0:43')
  expect(live).not.toContain('This quote expired')
  // The flag the stylesheet dims the legs with is absent, not false.
  expect(live).not.toContain('data-expired')

  const dead = bill({}, { dead: true, now: EXPIRES + 1_000 })
  expect(dead).toContain('This quote expired')
  expect(dead).toContain('Do not pay against it')
  expect(dead).toContain('data-expired="true"')
  // The countdown is gone rather than showing 0:00 beside a bill.
  expect(dead).not.toContain('EXPIRES IN')
})

/**
 * THE EXPIRY IS AN INSTANT AS WELL AS A COUNTDOWN, and the tray says which clock
 * the countdown is running on. A device three minutes slow shows a bill that
 * died three minutes ago as live; the absolute stamp is the reader's own way to
 * check, and it is in UTC so the server and the browser print the same string.
 */
test('the bill states the absolute expiry and whether it is anchored to the sale’s clock', () => {
  const anchored = bill()
  expect(anchored).toContain(`EXPIRES AT ${new Date(EXPIRES).toISOString()}`)
  expect(anchored).toContain('counted against the sale')

  const adrift = bill({}, { anchored: false })
  expect(adrift).toContain('THIS DEVICE')
  expect(adrift).toContain('this countdown is wrong')
})

/* ── THE RULES THAT MAKE A HAND-BUILT PAYMENT VERIFIABLE ─────────────────── */

/** One transaction, `transferChecked`, the declared signer, the token account.
 *  Every one of these is a way to lose the tokens permanently, so they are
 *  above the figures rather than under them. */
test('the four rules are on the bill, before any address', () => {
  const html = bill()
  const rules = html.indexOf('READ THIS BEFORE YOU SEND ANYTHING')
  expect(rules).toBeGreaterThan(-1)
  expect(rules).toBeLessThan(html.indexOf(TREASURY_ATA))
  expect(html).toContain('ONE TRANSACTION')
  expect(html).toContain('transferChecked')
  expect(html).toContain('Nobody can pay on your behalf')
})

/* ── THE DIALOG'S FIRST TRAY ─────────────────────────────────────────────── */

const seat: CatwalkLadderSeat = {
  seat: 3, askUsdMicros: 2_000_000, mint: null, symbol: null, name: null, logoUrl: null, heldUsdMicros: null,
}

/**
 * NO WALLET CONNECTION ANYWHERE ON THIS PATH. The owner was explicit, the
 * upstream treats the wallet as self-asserted, and the on-chain payment is what
 * authenticates the buyer at settlement.
 */
test('the dialog opens on two address fields and asks nobody to connect anything', () => {
  const html = renderToStaticMarkup(<CatwalkClaimDialog open seat={seat} onClose={() => {}} />)
  expect(html).toContain('THE COIN YOU ARE PLACING — its mint address')
  expect(html).toContain('THE WALLET YOU WILL PAY FROM')
  expect(html).toContain('You are not connecting a wallet')
  expect(html).toContain('GET A QUOTE')
  // THE COIN FIELD IS NEVER PREFILLED FROM THE SEAT'S HOLDER: bidding on the
  // incumbent's behalf is refused as `catwalk_team_already_holds_spot`, for
  // entirely the wrong reason.
  expect(html).toContain('This is the coin that takes the seat, not the coin that holds it now')
  // Nothing is payable before a quote exists.
  expect(html).not.toContain('READ THIS BEFORE YOU SEND ANYTHING')
  expect(html).not.toContain('THE MEMO')
})

/* ── THE WIRING BETWEEN THE DIALOG AND THE BILL ──────────────────────────── */

/** The file with its comments taken out, so a guard counts CODE and not the
 *  prose explaining it. */
const codeOf = async (path: string) => {
  const text = await Bun.file(new URL(path, import.meta.url)).text()
  return text.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * THE TRAY ABOVE IS ONLY HONEST IF THE DIALOG HANDS IT THE RIGHT THINGS.
 *
 * A static render cannot reach the payable stage in this repo, so these three
 * connections are asserted against the source: the expiry is judged against the
 * SERVER-anchored instant rather than `Date.now()`, the anchor is taken from the
 * response that carried the quote, and the wallet the bid was minted against is
 * the one echoed on the bill.
 */
test('the dialog judges the expiry on the sale’s clock and echoes what the bid was bound to', async () => {
  const code = await codeOf('../src/components/catwalk/CatwalkClaimDialog.tsx')
  // ONE anchored instant, derived once and used everywhere.
  expect(code).toContain('const serverNow = now + skew')
  expect(code).toContain('quoteIsPayable(stage.quote, serverNow)')
  expect(code).toContain('now={serverNow}')
  // Which is only anchored because the skew comes off the quote's own response.
  expect(code).toContain('setSkew(clockSkew(stamp, local))')
  // THE BARE DEVICE CLOCK IS NEVER THE EXPIRY TEST. `clock` is still how the
  // tick is read; `quoteIsPayable(..., now)` would be the regression.
  expect(code).not.toContain('quoteIsPayable(stage.quote, now)')
  // The bill echoes the addresses the quote was ASKED with, not the live inputs.
  expect(code).toContain('wallet={declared.wallet}')
  expect(code).toContain('coin={declared.coin}')
  expect(code).toContain('setDeclared({ coin: mint, wallet: payer })')
  // AND NO WALLET ADAPTER, ANYWHERE ON THIS PATH. The owner was explicit.
  expect(code).not.toContain('useWallet')
  expect(code).not.toContain('signTransaction')
})
