import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { amountLabel } from './HomePrimitives'
import { TradeSteps, TradeStepsSummary } from './TradeSteps'
import { tradeAgreement } from './tradeAgreement'
import type { StepPlan, StepRow } from '../../../packages/adapters/solana/manifest/steps'

type Props = {
  open: boolean; onClose: () => void; onConfirm: () => void; pending: boolean; disabled: boolean
  title: string; label: string; side: 'buy' | 'sell'; type: 'market' | 'limit'
  price: number; quantity: number; fee: number; total: number
  priceLimit?: number; maximumTotal?: number; maximumFee?: number; upfrontCollateral?: number
  expiry: string; onExpiry: (value: string) => void; error?: string; simulation?: boolean; collateralSymbol?: string; network?: 'SOLANA' | 'SOMNIA'
  /** Single-line progress, for a venue with no transaction plan of its own.
   *  Somnia signs an approval and then an order with no stage stream behind it,
   *  so this line is still the only account of where that trade has got to. */
  progress?: string
  /** The anticipated transaction run. Null on any venue that signs once. */
  plan?: StepPlan | null
  /** The plan reconciled against what actually happened. */
  steps?: StepRow[]
  /** The flow has finished, successfully or not. */
  settled?: boolean
  collateralDecimals?: number
  explorerUrl?: (signature: string) => string | undefined
}

/**
 * Two trays behind one dialog: the order, and then the signing of it.
 *
 * Confirming does not add a section to the invoice — it replaces it. Once a
 * trade is under way the only thing worth the trader's attention is which
 * prompt is on screen and which ones are still coming, so the whole dialog
 * becomes that. Keeping it one dialog rather than opening a second is what lets
 * the toasts and the alert dock stay parented to an element that is still in
 * the top layer when the wallet prompts start arriving.
 */
export function TradeReviewDialog({ open, onClose, onConfirm, pending, disabled, title, label, side, type, price, quantity, fee, total, priceLimit, maximumTotal, maximumFee, upfrontCollateral, expiry, onExpiry, error, simulation = true, collateralSymbol = 'COOLA', network = 'SOMNIA', progress, plan = null, steps = [], settled = false, collateralDecimals = 6, explorerUrl }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  const number = (value: number) => amountLabel(Number.isFinite(value) ? value : 0)

  const signing = pending || steps.some(step => step.status !== 'planned')
  const terms = tradeAgreement({ simulation, network, side, type, completeSet: upfrontCollateral !== undefined, collateralSymbol })
  const heading = !signing ? 'Review your trade' : error ? 'Trade stopped' : settled ? 'Trade submitted' : 'Signing your trade'
  const confirmLabel = pending ? 'Submitting…' : error ? 'Try again' : simulation ? 'Agree and confirm' : network === 'SOLANA' ? 'Agree and sign on Solana' : 'Agree and sign on Somnia'
  // A stopped run with a rail already carries its own retry, beside the step
  // that stopped. A second one in the footer would be the same button twice.
  const footerConfirm = !(settled && !error) && !(error && plan && signing)

  return <dialog ref={dialog} className="ch-event-dialog ch-trade-dialog" aria-labelledby={headingId} onClose={onClose} onCancel={(event) => { if (pending) event.preventDefault() }}>
    <header><span className="ch-simulation">{simulation ? 'SIMULATION' : network === 'SOLANA' ? 'SOLANA' : 'SOMNIA'}</span><button aria-label="Close trade review" disabled={pending} onClick={() => dialog.current?.close()}><X size={20}/></button></header>
    <h2 id={headingId}>{heading}</h2><p className="ch-review-title">{title}</p><strong className="ch-review-selection">{side === 'buy' ? 'Buy' : 'Sell'} · {label}</strong>

    {signing ? (
      <div className="ch-trade-pane">
        <dl className="ch-trade-recap">
          <div><dt>{side === 'buy' ? 'Total' : 'You receive'}</dt><dd>{number(total)} {collateralSymbol}</dd></div>
          <div><dt>Shares</dt><dd>{number(quantity)}</dd></div>
          <div><dt>{type === 'market' ? 'Price' : 'Limit'}</dt><dd>{(price * 100).toFixed(1)}¢</dd></div>
        </dl>
        {plan
          ? <TradeSteps rows={steps} collateralSymbol={collateralSymbol} collateralDecimals={collateralDecimals} settled={settled} onRetry={onConfirm} retrying={pending} explorerUrl={explorerUrl} />
          : progress ? <p role="status" className="ch-dialog-note">{progress}</p> : null}
        {error && !plan && <p className="ch-trade-feedback is-error" role="alert">{error}</p>}
      </div>
    ) : (
      <div className="ch-trade-pane">
        <dl>
          <div><dt>Order</dt><dd>{type === 'market' ? 'Market' : 'Limit'}</dd></div>
          <div><dt>{type === 'market' ? 'Estimated price' : 'Limit price'}</dt><dd>{(price * 100).toFixed(1)}¢</dd></div>
          <div><dt>Shares</dt><dd>{number(quantity)}</dd></div>
          {simulation && <div><dt>Fee · 1.2%</dt><dd>{number(fee)} {collateralSymbol}</dd></div>}
          {type === 'limit' && simulation && <div><dt><label htmlFor={`${headingId}-expiry`}>Expires</label></dt><dd><select id={`${headingId}-expiry`} value={expiry} onChange={(event) => onExpiry(event.target.value)}><option value="close">Market close</option><option value="5">In 5 minutes</option><option value="60">In 1 hour</option></select></dd></div>}
          {priceLimit !== undefined && <div><dt>Maximum price per share</dt><dd>{(priceLimit * 100).toFixed(1)}¢</dd></div>}
          {upfrontCollateral !== undefined && <div><dt>Temporary collateral, before fee</dt><dd>{number(upfrontCollateral)} {collateralSymbol}</dd></div>}
          {maximumFee !== undefined && <div><dt>Maximum taker fee</dt><dd>{number(maximumFee)} {collateralSymbol}</dd></div>}
          {maximumTotal !== undefined && <div><dt>Maximum order cost, before fee</dt><dd>{number(maximumTotal)} {collateralSymbol}</dd></div>}
          <div className="ch-review-total"><dt>{side === 'buy' ? 'Estimated total' : 'You receive'}</dt><dd>{number(total)} {collateralSymbol}</dd></div>
          {side === 'buy' && <div><dt>Payout if correct{type === 'limit' ? ' and filled' : ''}</dt><dd className="ch-payout">{number(quantity)} {collateralSymbol}</dd></div>}
        </dl>
        {plan && <TradeStepsSummary plan={plan} firstOpen={plan.firstOpen} />}
        <details className="ch-trade-agreement">
          <summary>How this trade settles<span>{terms.length} term{terms.length === 1 ? '' : 's'}</span></summary>
          <ul>
            {terms.map(term => <li key={term.id}><strong>{term.title}</strong><span>{term.body}</span></li>)}
          </ul>
        </details>
        {error && <p className="ch-trade-feedback is-error" role="alert">{error}</p>}
      </div>
    )}

    <footer className="ch-trade-actions">
      <button type="button" className="ch-dismiss-trade" disabled={pending} onClick={() => dialog.current?.close()}>{signing ? 'Close' : 'Cancel'}</button>
      {footerConfirm && <button className="ch-submit-trade" disabled={pending || disabled} onClick={onConfirm}>{confirmLabel}</button>}
    </footer>
    {!signing && <p className="ch-dialog-note">Confirming accepts the terms above.</p>}
  </dialog>
}
