import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { amountLabel } from './HomePrimitives'

type Props = {
  open: boolean; onClose: () => void; onConfirm: () => void; pending: boolean; disabled: boolean
  title: string; label: string; side: 'buy' | 'sell'; type: 'market' | 'limit'
  price: number; quantity: number; fee: number; total: number
  progress?: string; expiry: string; onExpiry: (value: string) => void; error?: string; simulation?: boolean; collateralSymbol?: string
}
export function TradeReviewDialog({ open, onClose, onConfirm, pending, disabled, title, label, side, type, price, quantity, fee, total, expiry, onExpiry, error, simulation = true, collateralSymbol = 'COOLA', progress }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  const number = (value: number) => amountLabel(Number.isFinite(value) ? value : 0)
  return <dialog ref={dialog} className="ch-event-dialog ch-trade-dialog" aria-labelledby={headingId} onClose={onClose} onCancel={(event) => { if (pending) event.preventDefault() }}>
    <header><span className="ch-simulation">{simulation ? 'SIMULATION' : 'SOMNIA TESTNET'}</span><button aria-label="Close trade review" disabled={pending} onClick={() => dialog.current?.close()}><X size={20}/></button></header>
    <h2 id={headingId}>Review your trade</h2><p>{title}</p><strong className="ch-review-selection">{side === 'buy' ? 'Buy' : 'Sell'} · {label}</strong>
    <dl><div><dt>Order</dt><dd>{type === 'market' ? 'Market' : 'Limit'}</dd></div><div><dt>{type === 'market' ? 'Estimated price' : 'Limit price'}</dt><dd>{(price * 100).toFixed(1)}¢</dd></div><div><dt>Shares</dt><dd>{number(quantity)}</dd></div>{simulation && <div><dt>Fee · 1.2%</dt><dd>{number(fee)} {collateralSymbol}</dd></div>}
      {type === 'limit' && simulation && <div><dt><label htmlFor={`${headingId}-expiry`}>Expires</label></dt><dd><select id={`${headingId}-expiry`} value={expiry} onChange={(event) => onExpiry(event.target.value)}><option value="close">Market close</option><option value="5">In 5 minutes</option><option value="60">In 1 hour</option></select></dd></div>}
      <div className="ch-review-total"><dt>{side === 'buy' ? 'Total' : 'You receive'}</dt><dd>{number(total)} {collateralSymbol}</dd></div>
      {side === 'buy' && <div><dt>Payout if correct{type === 'limit' ? ' and filled' : ''}</dt><dd className="ch-payout">{number(quantity)} {collateralSymbol}</dd></div>}
    </dl>
    {!simulation && type === 'limit' && <p className="ch-dialog-note">Unfilled orders wait until market close. Funds or shares remain reserved until filled or cancelled.</p>}
    {pending && progress && <p role="status" className="ch-dialog-note">{progress}</p>}
    {error && <p className="ch-trade-feedback is-error" role="alert">{error}</p>}
    <button className="ch-submit-trade" disabled={pending || disabled} onClick={onConfirm}>{pending ? 'Submitting…' : simulation ? 'Confirm simulated trade' : 'Confirm wallet transaction'}</button>
    <p className="ch-dialog-note">{simulation ? <>{type === 'market' ? 'The final sample price is checked when you confirm. ' : 'Unfilled orders reserve credits or shares until filled, cancelled, or expired. '}Off-chain credits only. No wallet funds are used.</> : <>Your connected Somnia wallet will request any required tUSDC approval, then sign the order transaction. This is Shannon testnet.</>}</p>
  </dialog>
}
