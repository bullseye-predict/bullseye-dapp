import { ArrowUpRight } from 'lucide-react'
import { formatUnitsExact } from '../prediction/amounts'
import { MatchAvatar } from './matchIdentity'
import type { SolanaActiveRow, SolanaIdentity, SolanaOrderRow, SolanaPositionRow } from './solanaRows'

const eventHref = (identity: SolanaIdentity) => identity.eventId
  ? `/events/${encodeURIComponent(identity.eventId)}${identity.questionId ? `#event-${encodeURIComponent(identity.questionId)}` : ''}`
  : undefined
/** Bare numbers: every column states its unit once, in the header. */
const amount = (value: bigint, decimals: number) => formatUnitsExact(value, decimals, 6)
const price = (value: bigint | undefined, decimals: number) => value === undefined ? '—' : amount(value, decimals)
const when = (at: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)

type RowHead = { identity: SolanaIdentity; outcome: 0 | 1; lifecycle: string; locksAt?: number }

function Identity({ row }: { row: RowHead }) {
  const { identity, outcome } = row
  const href = eventHref(identity)
  return <>
    <div className="pf-market-identity">
      <MatchAvatar id={identity.eventId ?? identity.marketId}/>
      <div>
        <strong>{identity.label}</strong>
        <small>{row.locksAt ? `Locks ${when(row.locksAt)} · ` : ''}{row.lifecycle}</small>
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

/** Shares are split across four custodians and only the seat balance is
 *  immediately sellable, so the split is shown rather than a single total. */
function Custody({ row, decimals }: { row: SolanaPositionRow; decimals: number }) {
  const parts = [
    ['On the venue seat', row.custody.seat],
    ['Reserved in sell orders', row.custody.reserved],
    ['In your wallet', row.custody.wallet],
    ['In the prediction vault', row.custody.vault],
  ] as const
  const shown = parts.filter(([, value]) => value > 0n)
  if (!shown.length) return null
  return <details className="pf-match-details">
    <summary>Where these shares are</summary>
    {shown.map(([label, value]) => <small key={label}>{label}: {amount(value, decimals)}</small>)}
  </details>
}

const headers = (symbol: string) => <thead><tr><th>Question / outcome</th><th>Shares</th><th>Price ({symbol})</th><th>Value ({symbol})</th><th>Status</th></tr></thead>

function PositionCells({ row, decimals }: { row: SolanaPositionRow; decimals: number }) {
  return <>
    <td><Identity row={{ ...row, locksAt: row.holding.locksAt }}/></td>
    <td>{amount(row.quantity, decimals)}<Custody row={row} decimals={decimals}/></td>
    <td>{price(row.bestBid, decimals)}<small>Ask {price(row.bestAsk, decimals)}</small></td>
    <td>{row.value === undefined ? '—' : amount(row.value, decimals)}</td>
    <td><span className={row.state.startsWith('Claim') ? 'pf-yes' : ''}>{row.state}{row.seatCollateral > 0n && <small>{amount(row.seatCollateral, decimals)} on the seat</small>}</span></td>
  </>
}

/**
 * A resting order, rendered as a claim rather than as a second holding.
 *
 * An ask's shares are already inside its position's quantity and its marked
 * value, so the value cell states where they were counted instead of marking
 * them again. A bid owns no shares at all, so its value cell is the collateral
 * it has escrowed.
 */
function OrderCells({ row, grouped, decimals }: { row: SolanaOrderRow; grouped: boolean; decimals: number }) {
  const buy = row.order.side === 'BUY'
  const held = row.holding.outcomes[row.outcome].totalShares
  return <>
    <td><Identity row={{ ...row, locksAt: row.holding.locksAt }}/></td>
    <td>{amount(row.order.quantity, decimals)}<small>{buy ? 'if it fills' : `of your ${amount(held, decimals)}`}</small></td>
    <td>{amount(row.order.price, decimals)}<small>Limit</small></td>
    <td>{buy ? <>{amount(row.order.reserved, decimals)}<small>escrowed</small></> : <>—<small>{grouped ? 'counted above' : 'from shares in Closed'}</small></>}</td>
    <td><span className={buy ? 'pf-yes' : 'pf-no'}>{row.order.side}</span> order<small>{row.expired ? 'Expired · escrow still reserved' : 'Resting'}</small></td>
  </>
}

/** Active holdings and the resting orders that qualify them, in one list: an
 *  order is active because it is escrow the trader can still act on. */
export function SolanaActiveTable({ rows, decimals, symbol }: { rows: readonly SolanaActiveRow[]; decimals: number; symbol: string }) {
  return <div className="pf-table-scroll"><table>
    {headers(symbol)}
    <tbody>{rows.map(entry => <tr key={entry.key} className={entry.kind === 'order' ? 'is-order' : ''}>
      {entry.kind === 'position' ? <PositionCells row={entry.row} decimals={decimals}/> : <OrderCells row={entry.row} grouped={entry.grouped} decimals={decimals}/>}
    </tr>)}</tbody>
  </table></div>
}

export function SolanaPositionsTable({ rows, decimals, symbol }: { rows: readonly SolanaPositionRow[]; decimals: number; symbol: string }) {
  return <div className="pf-table-scroll"><table>
    {headers(symbol)}
    <tbody>{rows.map(row => <tr key={row.id}><PositionCells row={row} decimals={decimals}/></tr>)}</tbody>
  </table></div>
}
