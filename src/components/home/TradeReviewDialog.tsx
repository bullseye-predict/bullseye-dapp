import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { amountLabel } from './HomePrimitives'

type Props = {
  open: boolean; onClose: () => void; onConfirm: () => void; pending: boolean; disabled: boolean
  title: string; label: string; side: 'buy' | 'sell'; type: 'market' | 'limit'
  price: number; quantity: number; fee: number; total: number
  expiry: string; onExpiry: (value: string) => void; error?: string
}
export function TradeReviewDialog({ open, onClose, onConfirm, pending, disabled, title, label, side, type, price, quantity, fee, total, expiry, onExpiry, error }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  const number = (value: number) => amountLabel(Number.isFinite(value) ? value : 0)
  return <dialog ref={dialog} className="ch-event-dialog ch-trade-dialog" aria-labelledby={headingId} onClose={onClose} onCancel={(event) => { if (pending) event.preventDefault() }}>
    <header><span className="ch-simulation">SIMULATION</span><button aria-label="Close trade review" disabled={pending} onClick={() => dialog.current?.close()}><X size={20}/></button></header>
    <h2 id={headingId}>Review your trade</h2><p>{title}</p><strong className="ch-review-selection">{side === 'buy' ? 'Buy' : 'Sell'} · {label}</strong>
    <dl><div><dt>Order</dt><dd>{type === 'market' ? 'Market' : 'Limit'}</dd></div><div><dt>{type === 'market' ? 'Estimated price' : 'Limit price'}</dt><dd>{(price * 100).toFixed(1)}¢</dd></div><div><dt>Shares</dt><dd>{number(quantity)}</dd></div><div><dt>Fee · 1.2%</dt><dd>{number(fee)} COOLA</dd></div>
      {type === 'limit' && <div><dt><label htmlFor={`${headingId}-expiry`}>Expires</label></dt><dd><select id={`${headingId}-expiry`} value={expiry} onChange={(event) => onExpiry(event.target.value)}><option value="close">Market close</option><option value="5">In 5 minutes</option><option value="60">In 1 hour</option></select></dd></div>}
      <div className="ch-review-total"><dt>{side === 'buy' ? 'Total' : 'You receive'}</dt><dd>{number(total)} COOLA</dd></div>
      {side === 'buy' && <div><dt>Payout if correct{type === 'limit' ? ' and filled' : ''}</dt><dd className="ch-payout">{number(quantity)} COOLA</dd></div>}
    </dl>
    {error && <p className="ch-trade-feedback is-error" role="alert">{error}</p>}
    <button className="ch-submit-trade" disabled={pending || disabled} onClick={onConfirm}>{pending ? 'Submitting…' : 'Confirm simulated trade'}</button>
    <p className="ch-dialog-note">{type === 'market' ? 'The final sample price is checked when you confirm. ' : 'Unfilled orders reserve credits or shares until filled, cancelled, or expired. '}Off-chain credits only. No wallet funds are used.</p>
  </dialog>
}
