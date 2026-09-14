import { ArrowUpRight } from 'lucide-react'
import { formatUnitsExact } from '../prediction/amounts'
import { MatchAvatar } from './matchIdentity'
import type { SolanaIdentity, SolanaOrderRow, SolanaPositionRow } from './solanaRows'

const eventHref = (identity: SolanaIdentity) => identity.eventId
  ? `/events/${encodeURIComponent(identity.eventId)}${identity.questionId ? `#event-${encodeURIComponent(identity.questionId)}` : ''}`
  : undefined
const price = (value: bigint | undefined, decimals: number, symbol: string) => value === undefined ? '—' : `${formatUnitsExact(value, decimals, 6)} ${symbol}`
const when = (at: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)

type RowHead = { identity: SolanaIdentity; outcome: 0 | 1; holding: SolanaPositionRow['holding']; lifecycle: string }

function Identity({ row }: { row: RowHead }) {
  const { identity, outcome } = row
  const href = eventHref(identity)
  return <>
    <div className="pf-market-identity">
      <MatchAvatar id={identity.eventId ?? identity.marketId}/>
      <div>
        <strong>{identity.label}</strong>
        <small>{row.holding.locksAt ? `Locks ${when(row.holding.locksAt)} · ` : ''}{row.lifecycle}</small>
      </div>
    </div>
    <details className="pf-match-details">
      <summary>Question details</summary>
      <code>{identity.marketId}</code>
      {identity.eventId ? <small>Event {identity.eventId}</small> : <small>This question is no longer listed in the live catalogue; it is read straight from your claim accounts.</small>}
      {href && <a className="pf-open-market" href={href}>Open market <ArrowUpRight size={12}/></a>}
    </details>
    <span className={outcome === 0 ? 'pf-outcome pf-yes' : 'pf-outcome pf-no'}>{identity.outcomeLabels[outcome]}</span>
  </>
}

/** Shares are split across three custodians and only the seat balance is
 *  immediately sellable, so the split is shown rather than a single total. */
function Custody({ row, decimals }: { row: SolanaPositionRow; decimals: number }) {
  const parts = [
    ['On the venue seat', row.custody.seat],
    ['Reserved in sell orders', row.custody.reserved],
    ['In your wallet', row.custody.wallet],
    ['In the prediction vault', row.custody.vault],
  ] as const
  const shown = parts.filter(([, amount]) => amount > 0n)
  if (!shown.length) return null
  return <details className="pf-match-details">
    <summary>Where these shares are</summary>
    {shown.map(([label, amount]) => <small key={label}>{label}: {formatUnitsExact(amount, decimals, 6)}</small>)}
  </details>
}

export function SolanaPositionsTable({ rows, decimals, symbol }: { rows: readonly SolanaPositionRow[]; decimals: number; symbol: string }) {
  return <div className="pf-table-scroll"><table>
    <thead><tr><th>Question / outcome</th><th>Shares</th><th>Status</th><th>Best bid</th><th>Value at bid</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <td><Identity row={row}/></td>
      <td>{formatUnitsExact(row.quantity, decimals, 6)}<Custody row={row} decimals={decimals}/></td>
      <td><span className={row.state.startsWith('Claim') ? 'pf-yes' : ''}>{row.state}<small>{row.lifecycle}</small>{row.seatCollateral > 0n && <small>{formatUnitsExact(row.seatCollateral, decimals, 6)} {symbol} on the seat</small>}</span></td>
      <td>{price(row.bestBid, decimals, symbol)}<small>Ask {price(row.bestAsk, decimals, symbol)}</small></td>
      <td>{row.value === undefined ? '—' : `${formatUnitsExact(row.value, decimals, 6)} ${symbol}`}</td>
    </tr>)}</tbody>
  </table></div>
}

export function SolanaOrdersTable({ rows, decimals, symbol }: { rows: readonly SolanaOrderRow[]; decimals: number; symbol: string }) {
  return <div className="pf-table-scroll"><table>
    <thead><tr><th>Question / outcome</th><th>Side</th><th>Price</th><th>Size</th><th>Escrowed</th><th>Status</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <td><Identity row={row}/></td>
      <td><span className={row.order.side === 'BUY' ? 'pf-yes' : 'pf-no'}>{row.order.side}</span></td>
      <td>{price(row.order.price, decimals, symbol)}</td>
      <td>{formatUnitsExact(row.order.quantity, decimals, 6)}</td>
      <td>{row.order.side === 'BUY' ? `${formatUnitsExact(row.order.reserved, decimals, 6)} ${symbol}` : `${formatUnitsExact(row.order.quantity, decimals, 6)} shares`}</td>
      <td>{row.expired ? 'Expired · escrow still reserved' : 'Resting'}<small>{row.lifecycle}</small></td>
    </tr>)}</tbody>
  </table></div>
}
