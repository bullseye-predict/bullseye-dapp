import { decodeStored } from '../../../packages/prediction-core/serialization'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DreamDexBrowser, type DreamDexBrowserWallet } from '../../../packages/adapters/dreamdex/browser'
import { eventBinding } from '../../../packages/adapters/dreamdex/config'
import { marketOrderQuote, selfMatchingOrders } from '../../../packages/adapters/dreamdex/trading'
import type { DynamicEvmWalletPort } from '../arena/DynamicSolanaSession'
import { dynamicEvmProvider } from '../prediction/dynamicEvmProvider'
import { formatUnitsExact, parseUnitsExact } from '../prediction/amounts'
import { refreshDreamDex } from '../home/dreamDexRefresh'
import type { PortfolioMarket } from './usePortfolio'
import { positionState } from './model'

type Props = { entry: string; outcome: 0 | 1; wallet: DynamicEvmWalletPort; onClose: () => void; ordersOnly?: boolean }
export function PositionAction({ entry, outcome, wallet: source, onClose, ordersOnly = false }: Props) {
  const { snapshot, binding, config } = useMemo(() => decodeStored<PortfolioMarket>(entry), [entry])
  const decimals = snapshot.market.decimals
  const balance = snapshot.balances?.[outcome + 1] ?? 0n
  const state = positionState(snapshot.market, outcome, balance, snapshot.now, binding.tradingStartsAt, binding.tradingLocksAt)
  const claim = state === 'Claim winnings' || state === 'Claim refund'
  const canExit = !ordersOnly && (claim || state === 'Trading')
  const panel = useRef<HTMLElement>(null)
  const [amount, setAmount] = useState(formatUnitsExact(balance, decimals))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const active = useRef(true)
  const pending = useRef(false)
  const signer = useRef<DreamDexBrowserWallet | null>(null)
  useEffect(() => { active.current = true; panel.current?.focus(); return () => { active.current = false; signer.current?.dispose() } }, [])
  let quantity = 0n
  try { quantity = parseUnitsExact(amount, decimals) } catch { /* Inline validation below. */ }
  const quote = !claim && snapshot.book && snapshot.pool && quantity > 0n ? marketOrderQuote(snapshot.book, outcome === 0 ? 'SELL_YES' : 'SELL_NO', quantity, decimals, snapshot.pool.grid) : null
  const valid = quantity > 0n && quantity <= balance && (claim || state === 'Trading' && !!quote)
  async function transact(cancelId?: bigint) {
    if (pending.current || (!valid && cancelId === undefined)) return
    pending.current = true; setBusy(true); setError(''); setMessage('Checking wallet and current market…')
    const adapter = new DreamDexBrowser(config, eventBinding(config, binding))
    try {
      const provider = await dynamicEvmProvider(source, config.chainId)
      if (!active.current) return
      const wallet = await adapter.connect(provider)
      signer.current = wallet
      if (!active.current) { wallet.dispose(); return }
      if (wallet.owner.toLowerCase() !== source.address.toLowerCase()) throw Error('Connect the wallet that owns this position.')
      const fresh = await adapter.snapshot(wallet.owner)
      if (!active.current) return
      if (cancelId !== undefined) {
        await wallet.cancel(cancelId)
        if (active.current) setMessage('Order cancelled. Reserved funds are being refreshed.')
      } else {
        const held = fresh.balances?.[outcome + 1] ?? 0n
        if (quantity > held) throw Error('Your available shares changed. Refresh before continuing.')
        const current = positionState(fresh.market, outcome, held, fresh.now, binding.tradingStartsAt, binding.tradingLocksAt)
        if (claim) {
          if (current !== 'Claim winnings' && current !== 'Claim refund') throw Error('This outcome has no claimable payout.')
          setMessage('Confirm the claim in your wallet…')
          await wallet.sets('redeem', quantity, outcome)
          if (active.current) setMessage('Claim confirmed. Your balances are being refreshed.')
        } else {
          if (current !== 'Trading' || !fresh.book || !fresh.pool || !quote) throw Error('Trading is closed or liquidity is unavailable.')
          // Keep the reviewed limit price; never silently accept a worse fresh quote.
          if (selfMatchingOrders(fresh.orders.filter(order => order !== null), quote.input, decimals, fresh.now).length) throw Error('Cancel your opposing order below before selling to avoid a self trade.')
          setMessage('Confirm the sale in your wallet…')
          const result = await wallet.orderDetailed(quote.input)
          if (active.current) setMessage(`Sold ${formatUnitsExact(result.filled, decimals)} shares. ${result.cancelled > 0n ? `${formatUnitsExact(result.cancelled, decimals)} shares did not fill and remain yours.` : 'Sale confirmed.'}`)
        }
      }
      refreshDreamDex(config.chainId)
    } catch (reason) { if (active.current) { setError(reason instanceof Error ? reason.message : 'Transaction failed.'); setMessage('') } }
    finally { signer.current?.dispose(); signer.current = null; await adapter.close(); pending.current = false; if (active.current) setBusy(false) }
  }
  return <section ref={panel} tabIndex={-1} className="pf-action" aria-label="Manage position">
    <header><div><span className={outcome === 0 ? 'pf-yes' : 'pf-no'}>{outcome === 0 ? 'YES' : 'NO'}</span><h3>{ordersOnly ? 'Release order escrow' : claim ? state : state === 'Trading' ? 'Sell shares' : 'Manage orders'}</h3></div><button disabled={busy} onClick={onClose} aria-label="Close position controls">✕</button></header>
    <p>{binding.label}</p>
    {canExit && <><label>Shares<div className="pf-amount"><input aria-label="Shares to sell or claim" inputMode="decimal" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)}/><button disabled={busy} onClick={() => setAmount(formatUnitsExact(balance, decimals))}>Max</button></div></label>
    <p>Available: {formatUnitsExact(balance, decimals)} shares</p>
    {!claim && <p>{quote ? `Estimated proceeds: ${formatUnitsExact(quote.cost, decimals, 6)} ${config.chainId === '50312' ? 'tUSDC' : 'USDso'} before fees. Fillable: ${formatUnitsExact(quote.filled, decimals)} shares.` : 'No executable quote for this amount.'} Unfilled shares stay in your wallet.</p>}
    {quantity > balance && <p role="alert">Amount exceeds your available shares.</p>}
    <button className={claim ? 'pf-primary' : 'pf-sell'} disabled={!valid || busy} onClick={() => void transact()}>{busy ? 'Waiting for confirmation…' : claim ? 'Confirm claim' : 'Confirm sell'}</button></>}
    {snapshot.orders.length > 0 && <div className="pf-orders"><h3>Reserved in orders</h3><p>Expired orders no longer trade. Release their remaining shares or collateral; this is separate from claiming a winning position.</p>{snapshot.orders.map(order => order && <div key={order.orderId.toString()}><span>Order #{order.orderId.toString()} · {snapshot.orderSides[order.orderId.toString()]?.replace('_', ' ') ?? 'Side unavailable'} · {formatUnitsExact(order.quantityRemaining, decimals)} shares remaining</span><button disabled={busy} onClick={() => void transact(order.orderId)}>{snapshot.now >= binding.tradingLocksAt || snapshot.market.finalized ? 'Release escrow' : 'Cancel order'}</button></div>)}</div>}
    {message && <p role="status">{message}</p>}{error && <p className="pf-error" role="alert">{error}</p>}
  </section>
}
