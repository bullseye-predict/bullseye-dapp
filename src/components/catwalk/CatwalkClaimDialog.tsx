import { Copy, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { usdLabel } from '../solz/catwalkSource'
import type { CatwalkLadderSeat } from './catwalkBands'
import { pad } from './catwalkBands'
import {
  addressProblem, canRetry, clockSkew, clusterName, countdownLabel, formatBaseUnits, idempotencyKey,
  quoteIsPayable, requestQuote, signatureProblem, submitConfirm,
  type ClaimError, type ConfirmResult, type PayableQuote, type ReplayedQuote,
} from './catwalkClaim'

/**
 * TAKING A SEAT WITHOUT CONNECTING A WALLET.
 *
 * "i just wanna try to click outbid button, and also it doesnt work ??? why it
 * is disabled? even if imnot connected it can open dialog and send instruction
 * alongside memo i think ?"
 *
 * That is exactly what this is, and the owner is explicit that no wallet
 * connection should be required. THERE IS NO WALLET ADAPTER HERE AND THERE MUST
 * NOT BE ONE. The buyer types the address they will pay from - the upstream
 * treats the wallet as self-asserted and always has, because the on-chain
 * payment is what authenticates them at settlement - and this dialog publishes
 * the instructions: the memo, the destinations, the exact base units. They pay
 * by hand and paste the signature back.
 *
 * THE ONE RULE. Everything on the payable tray is rendered VERBATIM from the
 * quote response. Nothing here computes, rounds, re-splits, re-prices or
 * restates an amount, an address or a memo. A wrong destination or a wrong memo
 * costs the buyer their tokens with no recovery, so a field this dialog cannot
 * quote from the wire is a field it does not draw.
 *
 * THE PATTERN, NOT THE COMPONENT, comes from
 * src/components/home/TradeReviewDialog.tsx: a native `<dialog>` driven by
 * `showModal()` off an `open` prop, so the focus trap, Escape, the inertness of
 * the page behind it and top-layer painting all come from the platform rather
 * than from hand-rolled code. Its classes live in home-hero.css and this page
 * loads catwalk.css, so the styles are `.cw-claim-dialog`'s own.
 */

type Props = {
  open: boolean
  seat: CatwalkLadderSeat | null
  onClose: () => void
  quoteEndpoint?: string
  confirmEndpoint?: string
  /** Injected by the tests. Never used in the app. */
  fetcher?: typeof fetch
  /** Injected by the tests, so an expiry can be reached without waiting. */
  clock?: () => number
}

/** Which tray is on screen. Eight states, and the dialog is in exactly one. */
type Stage =
  | { at: 'collecting' }
  | { at: 'quoting' }
  | { at: 'payable'; quote: PayableQuote }
  | { at: 'replayed'; quote: ReplayedQuote }
  | { at: 'confirming'; quote: PayableQuote | ReplayedQuote }
  | { at: 'outcome'; result: ConfirmResult; quote: PayableQuote | ReplayedQuote }

/**
 * ONE COPY CONTROL, AND THE VALUE IT COPIES IS THE PROP.
 *
 * `navigator.clipboard.writeText(value)` takes the string this component was
 * HANDED, never the text in the DOM - so nothing on screen can be styled,
 * wrapped or clipped into a different clipboard payload. The `aria-label`
 * carries the whole value once.
 */
function CopyValue({ value, label, className = '', buttonRef }: {
  value: string
  label: string
  className?: string
  /** So the dialog can move initial focus to the memo's copy - the one control
   *  on the payable tray a buyer must reach first. */
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      ref={buttonRef}
      className={`cw-claim-copy ${className}`}
      aria-label={copied ? `${label} copied` : `Copy ${label} ${value}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1_600)
          })
        } catch { /* a clipboard the browser refuses is not worth an error state */ }
      }}
    >
      {/* WRAPS, NEVER ABBREVIATES. No ellipsis, no line clamp, no max-width
          that clips, no JS slice - a memo or a destination that could be copied
          in a truncated form is a payment that can never be matched. */}
      <code>{value}</code>
      <Copy size={11} aria-hidden="true" />
    </button>
  )
}

/**
 * THE BILL ITSELF, AS A COMPONENT WITH NO STATE AND NO NETWORK.
 *
 * SEPARATED FROM THE DIALOG SO IT CAN BE TESTED. This repo has no jsdom, so the
 * dialog's own stages cannot be driven by a click in a test - which left the one
 * surface in this feature that moves real money asserted on by nothing at all.
 * Every value a buyer copies off this tray is a prop here, so a test can render
 * it with `renderToStaticMarkup` and hold the memo, the destinations, the owners
 * and the base units to the quote they came from. Swapping the memo for the bid
 * id, or `to` for `owner`, is now a failing test rather than somebody's tokens.
 *
 * EVERYTHING IS RENDERED VERBATIM FROM `quote`, plus the two addresses the buyer
 * themselves declared. Nothing here computes, rounds, re-splits or re-prices.
 */
export function CatwalkClaimBill({ quote, coin, wallet, dead, now, anchored, memoRef, footer }: {
  quote: PayableQuote
  /** The coin the buyer typed, echoed back. NOT from the quote: `quote.mint` is
   *  the PAYMENT token's mint, which is a different address entirely. */
  coin: string
  /** The wallet the buyer declared. The bill's third rule points at it, and
   *  until this was drawn that rule pointed at an input that is no longer on
   *  screen - so a one-character typo, which is still 44 base58 characters and
   *  passes every check on both sides, could not be caught by the person who
   *  made it until `catwalk_payment_payer_invalid` at confirm, with the tokens
   *  already gone. */
  wallet: string
  dead: boolean
  now: number
  /** Whether `now` is anchored to the server's clock. Said out loud, because an
   *  unanchored countdown is the device's opinion of the expiry, not the
   *  sale's. */
  anchored: boolean
  memoRef?: RefObject<HTMLButtonElement | null>
  footer?: ReactNode
}) {
  const cluster = clusterName(quote.genesisHash)
  return (
    <div className="cw-claim-bill" data-expired={dead ? 'true' : undefined}>
      {dead ? (
        <p className="cw-claim-error" role="alert">
          This quote expired. Do not pay against it — the price may have moved and the seat
          may be gone.
        </p>
      ) : null}

      {/* WHICH CHAIN, BEFORE ANYTHING ELSE ON THE BILL. Every address below is
          valid base58 on every cluster and they all look alike, so this is the
          only thing that tells a buyer on the wrong network before the tokens
          move rather than as `catwalk_network_mismatch` afterwards. The hash is
          printed whatever the name says, and an unrecognised hash is named as
          unrecognised rather than assumed to be mainnet. */}
      <div className="cw-claim-block cw-claim-network" aria-disabled={dead ? 'true' : undefined}>
        <label>THE CLUSTER THIS BILL IS FOR</label>
        {quote.genesisHash
          ? <>
              <p className="cw-claim-net"><b>{cluster ?? 'UNRECOGNISED CLUSTER'}</b></p>
              <CopyValue value={quote.genesisHash} label="the cluster genesis hash" className="cw-claim-copy--quiet" />
              <p className="cw-claim-help">
                {cluster
                  ? 'Send from a wallet on this cluster. A transfer made on any other chain cannot be confirmed, and the addresses below look identical on all of them.'
                  : 'This page does not recognise that genesis hash. Check it against the cluster your wallet is on before you send anything.'}
              </p>
            </>
          : <p className="cw-claim-help" role="alert">
              The sale did not say which cluster this bill is for. Check with the operator before
              you send anything — the addresses below are valid base58 on every chain.
            </p>}
      </div>

      {/* THE RULES COME FIRST, BEFORE A SINGLE FIGURE. A hand-built payment only
          verifies if it is ONE transaction carrying exactly these legs as
          TOP-LEVEL transferChecked instructions plus one Memo, signed by the
          declared wallet. An ordinary wallet 'send' screen emits a plain
          `transfer`, and a two-leg quote becomes two transactions - both
          permanently unconfirmable, with the tokens gone. A dialog that buried
          this under the amounts would cost people money. */}
      <div className="cw-claim-rules" aria-disabled={dead ? 'true' : undefined}>
        <strong>READ THIS BEFORE YOU SEND ANYTHING</strong>
        <ul>
          <li>
            <b>ONE TRANSACTION.</b> Both transfers below and the memo must be in the SAME
            transaction. Two separate sends can never be confirmed and the tokens cannot be
            returned by this page.
          </li>
          <li>
            It must be a <code>transferChecked</code> instruction. Most wallet “send” screens
            emit a plain <code>transfer</code>, which this payment cannot be verified from.
          </li>
          <li>It must be signed by the wallet shown below. Nobody can pay on your behalf.</li>
          <li>Send to the DESTINATION TOKEN ACCOUNT, not to the owner wallet.</li>
        </ul>
      </div>

      {/* WHAT THE BUYER DECLARED, READ BACK TO THEM. These two are the only
          values on this tray that did not come off the wire, and they are
          labelled as theirs. */}
      <div className="cw-claim-block cw-claim-declared" aria-disabled={dead ? 'true' : undefined}>
        <label>PAY FROM — the wallet you declared</label>
        <CopyValue value={wallet} label="the wallet you declared" />
        <p className="cw-claim-help">
          This bid is bound to this exact address. A payment signed by any other wallet is refused
          and cannot be moved to this bid — if this is not your address, close this and start again
          rather than paying.
        </p>
        <label className="cw-claim-quiet">THE COIN YOU ARE PLACING</label>
        <CopyValue value={coin} label="the coin you are placing" className="cw-claim-copy--quiet" />
      </div>

      <div className="cw-claim-block" aria-disabled={dead ? 'true' : undefined}>
        <label>THE TOKEN YOU PAY IN</label>
        <CopyValue value={quote.mint} label="the payment token mint" />
        <CopyValue value={quote.tokenProgram} label="the token program" />
        <p className="cw-claim-help">DECIMALS {quote.decimals}</p>
      </div>

      {/* ONE BLOCK PER LEG, IN WIRE ORDER, NEVER RE-ORDERED AND NEVER MERGED. A
          single-entry `transfers` is normal - the burn leg exists only when
          there is something to burn - and must not read as a missing half. */}
      {quote.transfers.map((leg, index) => {
        const readable = formatBaseUnits(leg.baseUnits, quote.decimals)
        return (
          <div className="cw-claim-leg" key={`${leg.kind}-${index}`} aria-disabled={dead ? 'true' : undefined}>
            <h3>{leg.kind.toUpperCase()}</h3>
            <label>SEND TO — destination token account</label>
            <CopyValue value={leg.to} label="the destination token account" />
            <label className="cw-claim-quiet">OWNED BY — this is NOT where you send</label>
            <CopyValue value={leg.owner} label="the destination owner" className="cw-claim-copy--quiet" />
            <label>AMOUNT, IN BASE UNITS</label>
            {/* THE EXACT STRING FROM THE WIRE. It never passes through Number,
                parseInt, parseFloat, toFixed or arithmetic. */}
            <CopyValue value={leg.baseUnits} label="the amount in base units" />
            {readable !== null
              ? <p className="cw-claim-help">{readable} — for reading only; send the base units above.</p>
              : null}
          </div>
        )
      })}

      {/* THE MEMO, LAST AND IN ITS OWN BLOCK, because it is the only thing
          binding this payment to this bid. It wraps; it never abbreviates, and
          the copy writes the string from the response object rather than
          anything on screen. */}
      <div className="cw-claim-block cw-claim-memo">
        <label>THE MEMO</label>
        <CopyValue value={quote.memo} label="the payment memo" buttonRef={memoRef} />
        <p className="cw-claim-help">
          If this memo is missing, edited, re-cased or padded, the payment cannot be matched
          to this bid.
        </p>
      </div>

      <dl className="cw-claim-seat">
        <div><dt>QUOTED AT</dt><dd>{usdLabel(quote.usdMicros)}</dd></div>
      </dl>
      <p className="cw-claim-help">This is what the seat was priced at, not what you send.</p>

      <p className="cw-claim-bid">
        BID <CopyValue value={quote.bidId} label="the bid id" />
      </p>

      {/* THE EXPIRY IS PRINTED AS AN INSTANT AS WELL AS A COUNTDOWN, and the
          countdown says whose clock it is running on. `expiresAt` is the
          server's absolute epoch-ms; a countdown judged by a device three
          minutes slow shows a bill that is already dead as live. When the
          anchor is missing the instant is still here, in UTC, and a reader can
          check it themselves. */}
      {!dead
        ? <p className="cw-claim-timer" role="timer">EXPIRES IN {countdownLabel(quote.expiresAt, now)}</p>
        : null}
      <p className="cw-claim-help">
        EXPIRES AT {new Date(quote.expiresAt).toISOString()}
        {anchored
          ? ' — counted against the sale’s own clock.'
          : ' — counted against THIS DEVICE’S clock, which the sale could not be checked against. If your clock is wrong, this countdown is wrong.'}
      </p>

      {footer}
    </div>
  )
}

export function CatwalkClaimDialog({
  open, seat, onClose,
  quoteEndpoint = '/api/catwalk/quote',
  confirmEndpoint = '/api/catwalk/confirm',
  fetcher = fetch,
  clock = Date.now,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const coinId = useId()
  const walletId = useId()
  const signatureId = useId()
  const coinRef = useRef<HTMLInputElement>(null)
  const memoCopyRef = useRef<HTMLButtonElement>(null)
  /** Whatever opened the dialog, so focus goes back to it. The browser's own
   *  restore does not survive a row that re-rendered while the dialog was up. */
  const opener = useRef<Element | null>(null)

  const [coin, setCoin] = useState('')
  const [wallet, setWallet] = useState('')
  const [coinError, setCoinError] = useState<string | null>(null)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [signature, setSignature] = useState('')
  const [signatureError, setSignatureError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>({ at: 'collecting' })
  const [refusal, setRefusal] = useState<ClaimError | null>(null)
  const [now, setNow] = useState(() => clock())
  /**
   * HOW FAR THIS DEVICE IS FROM THE SERVER THAT ISSUED THE BILL, in ms, taken
   * from the `Date` header of the response that carried the quote.
   *
   * `expiresAt` is an absolute instant chosen by the server. Judging it with
   * `Date.now()` alone hands the decision "is this bill still payable" to the
   * buyer's own clock: a laptop resumed from sleep runs minutes slow, and
   * `quoteSeconds` is sixty. Slow, and the dialog shows a dead bill as live -
   * the transfer verifies on chain, the seat is refused as `grace-elapsed`, the
   * tokens have moved. Fast, and a live bill reads dead, so the buyer mints a
   * second quote that raises the floor for everyone and burns one of their three
   * open-quote slots.
   */
  const [skew, setSkew] = useState(0)
  /** Whether that anchor was actually found. Printed on the bill either way. */
  const [anchored, setAnchored] = useState(false)
  /** THE INSTANT THE BILL IS JUDGED AT. One expression, used by the countdown
   *  and by the expiry test, so the two can never disagree. */
  const serverNow = now + skew

  const pending = stage.at === 'quoting' || stage.at === 'confirming'

  /** The two addresses AS THEY WERE SENT, held apart from the inputs so the bill
   *  echoes what the bid was actually minted against rather than whatever the
   *  form holds now. */
  const [declared, setDeclared] = useState({ coin: '', wallet: '' })

  const reset = useCallback(() => {
    setCoin(''); setWallet(''); setCoinError(null); setWalletError(null)
    setSignature(''); setSignatureError(null)
    setStage({ at: 'collecting' }); setRefusal(null)
    setDeclared({ coin: '', wallet: '' }); setSkew(0); setAnchored(false)
  }, [])

  useEffect(() => {
    if (open) {
      opener.current = typeof document === 'undefined' ? null : document.activeElement
      if (!dialog.current?.open) dialog.current?.showModal()
    } else if (dialog.current?.open) dialog.current.close()
  }, [open])

  /**
   * THE QUOTE'S OWN CLOCK, one second, LOCAL TO THIS DIALOG.
   *
   * Deliberately not the page's 60-second tick: that would keep showing a bill
   * as live for up to a minute after it died, and somebody would pay against it.
   */
  useEffect(() => {
    if (stage.at !== 'payable') return
    const timer = window.setInterval(() => setNow(clock()), 1_000)
    setNow(clock())
    return () => window.clearInterval(timer)
  }, [stage.at, clock])

  // Initial focus: the first thing to fill in, then the one thing that must be
  // copied exactly.
  useEffect(() => {
    if (!open) return
    if (stage.at === 'collecting') coinRef.current?.focus()
    if (stage.at === 'payable') memoCopyRef.current?.focus()
  }, [open, stage.at])

  if (!seat) return null

  const spot = seat.seat

  /** BOTH CALLS LIVE IN `catwalkClaim.ts`, including what happens when they
   *  fail - that wording is the difference between a buyer keeping their
   *  signature and a buyer sending a second transfer, so it is held by tests
   *  rather than by this component. */

  const askForQuote = async (fresh = false) => {
    const coinProblem = addressProblem(coin)
    const walletIssue = addressProblem(wallet)
    setCoinError(coinProblem); setWalletError(walletIssue)
    if (coinProblem || walletIssue) return
    setRefusal(null)
    setStage({ at: 'quoting' })
    const mint = coin.trim()
    const payer = wallet.trim()
    const { result, serverNow: stamp } = await requestQuote({
      fetcher,
      endpoint: quoteEndpoint,
      mint,
      spot,
      wallet: payer,
      idempotencyKey: idempotencyKey(mint, spot, fresh),
    })
    if (result.kind === 'error') {
      setRefusal(result)
      // A KEY CONFLICT IS THIS PAGE'S BUG, NOT THE BUYER'S. It is the one code
      // that mints a new key on its own, and it still goes back to the form
      // rather than re-firing - nothing here ever auto-retries a quote.
      if (result.code === 'catwalk_idempotency_key_conflict') idempotencyKey(mint, spot, true)
      setStage({ at: 'collecting' })
      return
    }
    const local = clock()
    setNow(local)
    // THE ANCHOR IS TAKEN ONCE, FROM THE RESPONSE THAT CARRIED THE BILL, and
    // held for the life of the quote. No second call, no polling.
    setSkew(clockSkew(stamp, local))
    setAnchored(stamp !== null)
    setDeclared({ coin: mint, wallet: payer })
    setStage(result.kind === 'payable' ? { at: 'payable', quote: result } : { at: 'replayed', quote: result })
  }

  const confirmPayment = async () => {
    if (stage.at !== 'payable' && stage.at !== 'replayed' && stage.at !== 'outcome') return
    const quote = stage.quote
    const problem = signatureProblem(signature)
    setSignatureError(problem)
    if (problem) return
    setRefusal(null)
    setStage({ at: 'confirming', quote })
    const { result } = await submitConfirm({
      fetcher,
      endpoint: confirmEndpoint,
      bidId: quote.bidId,
      signature: signature.trim(),
    })
    if (result.kind === 'error') {
      // EVERY REFUSAL ON THIS CALL IS WORDED FOR THE CONFIRM STAGE. The buyer
      // may already have sent the tokens, so nothing here may say "nothing was
      // charged" and nothing here may invite a second transfer.
      setRefusal(result)
      setStage(quote.kind === 'payable' ? { at: 'payable', quote } : { at: 'replayed', quote })
      return
    }
    setStage({ at: 'outcome', result, quote })
  }

  const expired = stage.at === 'payable' && !quoteIsPayable(stage.quote, serverNow)

  const heading = stage.at === 'outcome'
    ? stage.result.kind === 'granted' ? 'The seat is yours'
      : stage.result.kind === 'verified-not-granted' ? 'Paid and recorded'
        : 'Your payment'
    : `Take seat ${pad(spot)}`

  /** The signature field and its confirm, present from the payable tray on and
   *  never removed - an expired quote keeps it, because a signature made in
   *  time still settles inside the grace window. */
  const signatureBlock = (note: string) => (
    <div className="cw-claim-block">
      <label htmlFor={signatureId}>THE TRANSACTION SIGNATURE</label>
      <p className="cw-claim-help">{note}</p>
      <input
        id={signatureId}
        value={signature}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={signatureError ? 'true' : undefined}
        aria-describedby={signatureError ? `${signatureId}-error` : undefined}
        onChange={(event) => setSignature(event.target.value)}
        onBlur={() => setSignatureError(signature ? signatureProblem(signature) : null)}
      />
      {signatureError ? <p className="cw-claim-error" id={`${signatureId}-error`} role="alert">{signatureError}</p> : null}
      <button type="button" className="cw-act" onClick={() => void confirmPayment()} disabled={pending}>
        CONFIRM PAYMENT
      </button>
    </div>
  )

  return (
    <dialog
      ref={dialog}
      className="cw-claim-dialog"
      aria-labelledby={headingId}
      onClose={() => { reset(); onClose(); (opener.current as HTMLElement | null)?.focus?.() }}
      // ESCAPE CANNOT DISMISS A CALL IN FLIGHT. A quote is being minted against
      // this wallet and it counts against a live limit of three.
      onCancel={(event) => { if (pending) event.preventDefault() }}
    >
      <header>
        <span className="cw-claim-tag">SPOT LADDER</span>
        <button type="button" aria-label="Close" disabled={pending} onClick={() => dialog.current?.close()}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <h2 id={headingId}>{heading}</h2>

      <dl className="cw-claim-seat">
        <div><dt>SEAT</dt><dd>{pad(spot)}</dd></div>
        {seat.askUsdMicros > 0
          ? <div><dt>ASK</dt><dd>{usdLabel(seat.askUsdMicros)}</dd></div>
          : null}
      </dl>
      {seat.askUsdMicros > 0
        ? <p className="cw-claim-help">This is the published ask; the quote below is what you actually pay.</p>
        : null}

      {refusal ? <p className="cw-claim-error" role="alert">{refusal.message}</p> : null}

      {stage.at === 'collecting' ? (
        <>
          <div className="cw-claim-block">
            <label htmlFor={coinId}>THE COIN YOU ARE PLACING — its mint address</label>
            {/* NEVER PREFILLED FROM `seat.mint`. That field is the INCUMBENT
                HOLDER, and bidding on its behalf is refused as
                `catwalk_team_already_holds_spot` for entirely the wrong reason. */}
            <p className="cw-claim-help">This is the coin that takes the seat, not the coin that holds it now.</p>
            <input
              id={coinId}
              ref={coinRef}
              value={coin}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={coinError ? 'true' : undefined}
              aria-describedby={coinError ? `${coinId}-error` : undefined}
              onChange={(event) => setCoin(event.target.value)}
              onBlur={() => setCoinError(coin ? addressProblem(coin) : null)}
            />
            {coinError ? <p className="cw-claim-error" id={`${coinId}-error`} role="alert">{coinError}</p> : null}
          </div>

          <div className="cw-claim-block">
            <label htmlFor={walletId}>THE WALLET YOU WILL PAY FROM</label>
            <p className="cw-claim-help">
              You are not connecting a wallet. Type the address you will sign the transfer with — the
              payment is only accepted from this exact wallet.
            </p>
            <input
              id={walletId}
              value={wallet}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={walletError ? 'true' : undefined}
              aria-describedby={walletError ? `${walletId}-error` : undefined}
              onChange={(event) => setWallet(event.target.value)}
              onBlur={() => setWalletError(wallet ? addressProblem(wallet) : null)}
            />
            {walletError ? <p className="cw-claim-error" id={`${walletId}-error`} role="alert">{walletError}</p> : null}
          </div>

          <button
            type="button"
            className="cw-act cw-act--claim"
            onClick={() => void askForQuote()}
            disabled={!!addressProblem(coin) || !!addressProblem(wallet)}
          >
            GET A QUOTE
          </button>
        </>
      ) : null}

      {stage.at === 'quoting' ? <p className="cw-claim-status" role="status">Asking for a quote…</p> : null}
      {stage.at === 'confirming' ? <p className="cw-claim-status" role="status">Checking the transaction on chain…</p> : null}

      {stage.at === 'payable' || (stage.at === 'confirming' && stage.quote.kind === 'payable')
        ? (() => {
          const quote = stage.quote as PayableQuote
          const dead = stage.at === 'payable' && expired
          return (
            <CatwalkClaimBill
              quote={quote}
              coin={declared.coin}
              wallet={declared.wallet}
              dead={dead}
              now={serverNow}
              anchored={anchored}
              memoRef={memoCopyRef}
              footer={
                <>
                  {dead
                    ? <button type="button" className="cw-act" onClick={() => void askForQuote(true)}>GET A NEW QUOTE</button>
                    : null}
                  {signatureBlock(
                    dead
                      ? 'A signature made before this quote expired still settles. Paste it here.'
                      : 'Once you have sent the transaction, paste its signature here.',
                  )}
                </>
              }
            />
          )
        })()
        : null}

      {/* THE REPLAYED BRANCH IS ITS OWN TRAY, and it is structurally incapable
          of being a bill: this response carries no memo, no transfers and no
          mint. Detected on `replayed === true`, never by looking for a memo. */}
      {stage.at === 'replayed' || (stage.at === 'confirming' && stage.quote.kind === 'replayed')
        ? (() => {
          const quote = stage.quote as ReplayedQuote
          return (
            <div className="cw-claim-replayed">
              <p role="status">You already have a quote under this key. Its state is {quote.state || 'unknown'}.</p>
              <dl className="cw-claim-seat">
                <div><dt>QUOTED AT</dt><dd>{usdLabel(quote.usdMicros)}</dd></div>
                <div><dt>EXPIRES</dt><dd>{new Date(quote.expiresAt).toISOString()}</dd></div>
              </dl>
              <p className="cw-claim-help">That is the ORIGINAL expiry, not a new one.</p>
              <p className="cw-claim-bid">BID <CopyValue value={quote.bidId} label="the bid id" /></p>
              {quote.settleable
                ? signatureBlock('If you already paid this quote, paste the transaction signature.')
                : <>
                    <p className="cw-claim-help">This quote can no longer be confirmed.</p>
                    <button type="button" className="cw-act" onClick={() => void askForQuote(true)}>GET A NEW QUOTE</button>
                  </>}
            </div>
          )
        })()
        : null}

      {stage.at === 'outcome' ? (
        <div className="cw-claim-outcome" data-kind={stage.result.kind}>
          <p role={stage.result.kind === 'unsettled' ? 'alert' : 'status'}>{stage.result.message}</p>
          {stage.result.kind === 'granted' && stage.result.spot !== null
            ? <p className="cw-claim-help">SEAT {pad(stage.result.spot)}{stage.result.mint ? ` — ${stage.result.mint}` : ''}</p>
            : null}
          {/* THE SIGNATURE AND THE BID ID STAY COPYABLE IN EVERY OUTCOME. */}
          <p className="cw-claim-bid">BID <CopyValue value={stage.quote.bidId} label="the bid id" /></p>
          {signature.trim()
            ? <p className="cw-claim-bid">SIGNATURE <CopyValue value={signature.trim()} label="the transaction signature" /></p>
            : null}
          {stage.result.kind === 'granted'
            ? <button type="button" className="cw-act" onClick={() => dialog.current?.close()}>DONE</button>
            : null}
        </div>
      ) : null}

      {/* NOTHING ON THIS PAGE RETRIES ON ITS OWN. Every quote that reaches the
          store raises the floor price for the next buyer, so a retry is always
          a press - and the three 429s and `catwalk_team_already_holds_spot` do
          not offer one at all. */}
      {refusal && canRetry(refusal.code) && stage.at === 'collecting'
        ? <button type="button" className="cw-act" onClick={() => void askForQuote()}>TRY AGAIN</button>
        : null}
    </dialog>
  )
}
