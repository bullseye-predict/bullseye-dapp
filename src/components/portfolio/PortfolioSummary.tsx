import type { ReactNode } from 'react'
import { Copy, RefreshCw, WalletCards } from 'lucide-react'
import { formatUnitsExact } from '../prediction/amounts'
import { matchGlyph } from './matchIdentity'
import { TraderAvatar } from '../identity/TraderIdentity'
import { useTraderProfile } from '../identity/store'
import { shortAddress, traderName } from '../identity/profile'

/** Marked value of the positions in the list, or the reason it is withheld. */
export type MarkedValue = { total?: bigint; unpriced: number; priced: number; mixed?: boolean }
export type Collateral = { wallet: bigint; seat: bigint; reserved: bigint; vault: bigint; total: bigint }

type Props = {
  compact?: boolean
  publicView?: boolean
  valuationLabel?: string
  owner?: string
  /** One grey line: network, collateral symbol and whether this page is read-only. */
  meta: string
  value: MarkedValue
  claimable: number
  orders: { total: number; expired: number }
  /** Solana only; the EVM path has no vault or venue seat to split. */
  collateral: Collateral | null
  /** Control for moving the vault balance out, rendered on the line it belongs
   *  to. The EVM path passes nothing, because it has no vault. */
  vaultAction?: ReactNode
  decimals: number
  symbol: string
  /** False while loading, erroring or signed out: every number reads '—'. */
  ready: boolean
  copyStatus: string
  onCopy: () => void
  onRefresh: () => void
  refreshing: boolean
}

const count = (ready: boolean, value: number) => ready ? String(value) : '—'

/**
 * The profile card: who this is, what the positions are worth, and what is
 * waiting to be acted on.
 *
 * Each fact appears once. The network is named here and nowhere else on the
 * page, the collateral split is one disclosure rather than four cards, and the
 * Active/Closed counts are left to the tabs that filter by them.
 */
export function PortfolioSummary({ compact = false, publicView = false, valuationLabel, owner, meta, value, claimable, orders, collateral, vaultAction, decimals, symbol, ready, copyStatus, onCopy, onRefresh, refreshing }: Props) {
  const hue = matchGlyph(owner ?? 'unconnected').hue
  // The same directory the holders board and the tape read, so a trader is
  // called one thing across the app rather than being an address here and a
  // handle three panels away.
  const { profile } = useTraderProfile(owner)
  const marked = !ready ? '—' : value.total === undefined ? '—' : formatUnitsExact(value.total, decimals, 2)
  // One unpriced book withholds the whole total: an outcome no one is bidding on
  // is not worth zero, and summing only the priced rows would under-report it.
  const markedLabel = !ready || value.total !== undefined ? 'Positions value'
    : value.mixed ? 'Positions use more than one collateral'
    : `${value.unpriced} of ${value.unpriced + value.priced} positions have ${valuationLabel ?? 'no bid'}`
  return <section className={`pf-card pf-profile ${publicView ? 'is-public' : ''}`} aria-label="Account summary">
    <div className="pf-identity">
      {owner
        ? <TraderAvatar address={owner} className="pf-avatar"/>
        : <div className="pf-avatar" style={{ background: `hsl(${hue} 30% 16%)`, color: `hsl(${hue} 70% 72%)` }}><WalletCards size={21}/></div>}
      <div>
        <h2 title={owner}>{owner ? traderName(owner, profile) : 'Not connected'}</h2>
        <p>{profile?.username && owner ? `${shortAddress(owner)} · ${meta}` : meta}</p>
        <span role="status">{copyStatus}</span>
      </div>
      {owner && <button className="pf-icon" onClick={onCopy} aria-label="Copy address" title="Copy address"><Copy size={14}/></button>}
    </div>
    <dl className="pf-hero-stats">
      <div><dt>{markedLabel}</dt><dd>{marked}<small>{symbol}</small></dd></div>
      {!publicView && <><div><dt>Ready to claim</dt><dd className={ready && claimable > 0 ? 'pf-yes' : ''}>{count(ready, claimable)}</dd></div>
      <div><dt>{ready && orders.expired > 0 ? `Resting orders · ${orders.expired} expired` : 'Resting orders'}</dt><dd className={ready && orders.expired > 0 ? 'pf-alert' : ''}>{count(ready, orders.total)}</dd></div></>}
    </dl>
    {collateral && ready && <details className="pf-collateral" open={!compact}>
      <summary>Collateral<b>{formatUnitsExact(collateral.total, decimals, 6)} {symbol}</b></summary>
      <dl>
        <div><dt>In your wallet</dt><dd>{formatUnitsExact(collateral.wallet, decimals, 6)}</dd></div>
        <div><dt>On venue seats</dt><dd>{formatUnitsExact(collateral.seat, decimals, 6)}</dd></div>
        <div><dt>Reserved in buy orders</dt><dd>{formatUnitsExact(collateral.reserved, decimals, 6)}</dd></div>
        <div><dt>In the prediction vault</dt><dd>{formatUnitsExact(collateral.vault, decimals, 6)}</dd></div>
      </dl>
      {/* A settled payout is redeemed into the vault, not into the wallet. This
          is the signature that finishes the claim, and it belongs beside the
          balance it moves rather than on a position row that has already
          settled to Closed and dropped out of the Active tab. */}
      {vaultAction}
    </details>}
    <button className="pf-refresh" disabled={refreshing || !owner} onClick={onRefresh}><RefreshCw size={14}/>Refresh</button>
  </section>
}
