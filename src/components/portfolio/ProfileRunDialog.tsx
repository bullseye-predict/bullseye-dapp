// The trade dialog's own chrome. Every rule in TradeSteps.css is scoped under
// `.ch-trade-dialog`, so a stepper rendered anywhere else is an unstyled list —
// which is exactly what a rail dropped into the profile side panel turned out
// to be. Release, seat withdrawal and claim all use this same shell, so they
// are the same dialog the trader already knows from the trade ticket rather
// than three things that look nothing like each other.
//
// It carries no vocabulary of its own: headings, recap rows and the closing
// note are the caller's words. That is what lets one component serve a
// cancellation and an eight-signature claim without either one growing a
// second stepper beside this one.
import '../../styles/home-hero.css'
import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { TradeSteps } from '../home/TradeSteps'
import type { StepPlan, StepRow } from '../../../packages/adapters/solana/manifest/steps'

/** Which heading the dialog shows, chosen from its own derived phase rather
 *  than from a flag the caller has to keep in step with the rail. */
export type RunHeadings = {
  /** Nothing signed yet. */
  idle: string
  /** A prompt is up or the run is between signatures. */
  running: string
  /** The run ended on a failure. */
  stopped: string
  /** The run ended having signed everything it planned. */
  done: string
}

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  pending: boolean
  disabled: boolean
  /** The question this run acts on. */
  title: string
  /** What the run is called, above the recap. */
  label: string
  headings: RunHeadings
  /** Caller-formatted, because the amounts belong to the caller's vocabulary.
   *  Two or three entries: `.ch-trade-recap` lays them out in columns. */
  recap: readonly { term: string; value: string }[]
  /** One sentence under the footer, before anything is signed. */
  note?: string
  /** A precondition the trader must clear first. Renders above the rail and
   *  disables the confirm, so it is read before a prompt rather than thrown
   *  after two of them have already been signed. */
  blocker?: { message: string; detail?: string }
  plan: StepPlan
  steps: StepRow[]
  settled: boolean
  collateralSymbol: string
  collateralDecimals: number
  network: string
  error?: string
  /** What the run ended up doing, in the caller's words. A release that
   *  withdrew nothing and a claim that reached the wallet are both successes
   *  and neither belongs in the red slot. */
  status?: string
  explorerUrl?: (signature: string) => string | undefined
}

/**
 * A multi-signature profile action, as a dialog rather than a panel note.
 *
 * None of these runs is one transaction, and none of them is optional halfway
 * through. Manifest's cancellation credits the seat and moves no tokens; a
 * redeem pays into the prediction vault and not the wallet. A trader who stops
 * after the first prompt has a confirmed transaction and an unchanged wallet
 * balance either way. The recap says what is coming back before the first
 * prompt, and the rail says which signature is on screen.
 */
export function ProfileRunDialog({
  open, onClose, onConfirm, pending, disabled, title, label, headings, recap, note, blocker,
  plan, steps, settled, collateralSymbol, collateralDecimals, network, error, status, explorerUrl,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])

  // Attempts rather than statuses: a reconciled row reads 'skipped' as soon as
  // a run settles, so deriving the tray from status alone would show a stepper
  // for a run the trader has not started yet.
  const signing = pending || steps.some(step => step.attempts > 0)
  const heading = !signing
    ? headings.idle
    : error ? headings.stopped : settled ? headings.done : headings.running
  // A finished run has nothing left to confirm, and a stopped one carries its
  // own retry beside the step that stopped, so a footer copy would be the same
  // button twice.
  const footerConfirm = !signing || !(settled && !error)
  // A range when the plan is one, matching TradeStepsSummary. A promise of "2
  // transactions" on a plan whose floor is 1 is the same overcount the rail's
  // own denominator was fixed for.
  const confirmLabel = plan.approximate
    ? `Sign ${plan.least} to ${plan.most} transactions`
    : `Sign ${plan.most} transaction${plan.most === 1 ? '' : 's'}`

  return (
    <dialog
      ref={dialog}
      className="ch-event-dialog ch-trade-dialog"
      aria-labelledby={headingId}
      onClose={onClose}
      onCancel={(event) => { if (pending) event.preventDefault() }}
    >
      <header>
        <span className="ch-simulation">{network}</span>
        <button aria-label="Close action" disabled={pending} onClick={() => dialog.current?.close()}>
          <X size={20} />
        </button>
      </header>
      <h2 id={headingId}>{heading}</h2>
      <p className="ch-review-title">{title}</p>
      <strong className="ch-review-selection">{label}</strong>

      <div className="ch-trade-pane">
        <dl className="ch-trade-recap">
          {recap.map(row => (
            <div key={row.term}><dt>{row.term}</dt><dd>{row.value}</dd></div>
          ))}
        </dl>
        {/* Before the rail, because it is the reason the rail cannot start. */}
        {blocker && !signing && (
          <div className="ch-trade-feedback is-error" role="alert">
            <strong>{blocker.message}</strong>
            {blocker.detail && <p>{blocker.detail}</p>}
          </div>
        )}
        <TradeSteps
          rows={steps}
          plan={plan}
          collateralSymbol={collateralSymbol}
          collateralDecimals={collateralDecimals}
          settled={settled}
          onRetry={onConfirm}
          retrying={pending}
          explorerUrl={explorerUrl}
        />
        {/* The rail carries a step's own failure. This is for the ones that
            happen before any transaction exists — a binding that could not be
            read, or a wallet that is not the profile owner. */}
        {error && !signing && <p className="ch-trade-feedback is-error" role="alert">{error}</p>}
        {/* The sentence that says where the money went. A claim's whole point
            is that this is reached, so it survives on screen beside the rail
            rather than replacing it. */}
        {status && !error && <p className="ch-trade-feedback" role="status">{status}</p>}
      </div>

      <footer className="ch-trade-actions">
        <button
          type="button"
          className="ch-dismiss-trade"
          disabled={pending}
          onClick={() => dialog.current?.close()}
        >
          {signing ? 'Close' : 'Cancel'}
        </button>
        {footerConfirm && (
          <button
            className="ch-submit-trade"
            data-fx="commit"
            disabled={pending || disabled || Boolean(blocker)}
            onClick={onConfirm}
          >
            {pending ? 'Submitting…' : error ? 'Try again' : confirmLabel}
          </button>
        )}
      </footer>
      {!signing && note && <p className="ch-dialog-note">{note}</p>}
    </dialog>
  )
}
