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

/** Two lines: the question with its outcome, and one grey line of context. The
 *  market id and the custody split are titles rather than disclosures — a row
 *  that can expand is a row that is always tall. */
function Identity({ row }: { row: RowHead }) {
  const { identity, outcome } = row
  const href = eventHref(identity)
  const title = <><strong>{identity.label}</strong><span className={outcome === 0 ? 'pf-chip pf-yes' : 'pf-chip pf-no'}>{identity.outcomeLabels[outcome]}</span></>
  return <div className="pf-market-identity">
    <MatchAvatar id={identity.eventId ?? identity.marketId}/>
    <div>
      <div className="pf-row-title">{href ? <a href={href}>{title}</a> : title}{!identity.listed && <span className="pf-tag" title="No longer listed in the live catalogue. It is read from your claim accounts so a settled payout is never hidden.">Unlisted</span>}</div>
      <small title={identity.marketId}>{row.locksAt ? `Locks ${when(row.locksAt)} · ` : ''}{row.lifecycle}</small>
    </div>
  </div>
}

/** Shares sit with up to four custodians and only the seat balance is
 *  immediately sellable, so a split total says where it is. A total that is all
 *  in one place needs no note. */
function custodyNote(row: SolanaPositionRow, decimals: number) {
  const parts = [
    ['on seat', row.custody.seat],
    ['in sell orders', row.custody.reserved],
    ['in wallet', row.custody.wallet],
    ['in vault', row.custody.vault],
  ] as const
  const shown = parts.filter(([, value]) => value > 0n)
  return shown.length > 1 ? shown.map(([label, value]) => `${amount(value, decimals)} ${label}`).join(' · ') : undefined
}

const headers = (symbol: string, manage: boolean) => <thead><tr><th>Question / outcome</th><th>Shares</th><th>Price ({symbol})</th><th>Value ({symbol})</th><th>Status</th>{manage && <th><span className="sr-only">Actions</span></th>}</tr></thead>

function PositionCells({ row, decimals }: { row: SolanaPositionRow; decimals: number }) {
  const note = custodyNote(row, decimals)
  return <>
    <td><Identity row={{ ...row, locksAt: row.holding.locksAt }}/></td>
    <td>{amount(row.quantity, decimals)}{note && <small>{note}</small>}</td>
    <td>{price(row.bestBid, decimals)}<small>Ask {price(row.bestAsk, decimals)}</small></td>
    <td>{row.value === undefined ? '—' : amount(row.value, decimals)}</td>
    <td><span className={row.state.startsWith('Claim') ? 'pf-yes' : ''}>{row.state}</span>{row.seatCollateral > 0n && <small>{amount(row.seatCollateral, decimals)} on the seat</small>}</td>
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
    {/* Under its own position the identity is the row above, so repeating the
        title, outcome chip and context line would just be noise. */}
    <td>{grouped ? <span className="pf-order-line">↳ Your resting order</span> : <Identity row={{ ...row, locksAt: row.holding.locksAt }}/>}</td>
    <td>{amount(row.order.quantity, decimals)}<small>{buy ? 'if it fills' : `of your ${amount(held, decimals)}`}</small></td>
    <td>{amount(row.order.price, decimals)}<small>Limit</small></td>
    <td>{buy ? <>{amount(row.order.reserved, decimals)}<small>escrowed</small></> : <>—<small>{grouped ? 'counted above' : 'from shares in Closed'}</small></>}</td>
    <td><span className={buy ? 'pf-yes' : 'pf-no'}>{row.order.side}</span> order<small>{row.expired ? 'Expired · escrow reserved' : 'Resting'}</small></td>
  </>
}

/** Signing happens on the question's own market page, so the owner's actions are
 *  links to the control that can actually sign rather than buttons that cannot. */
function Action({ identity, label, kind }: { identity: SolanaIdentity; label: string; kind?: string }) {
  const href = eventHref(identity)
  return href ? <a className={`pf-act ${kind ?? ''}`} href={href}>{label}</a> : <span className="pf-act-none" title="This question is no longer listed, so it has no market page to open.">—</span>
}

/** Active holdings and the resting orders that qualify them, in one list: an
 *  order is active because it is escrow the trader can still act on. */
export function SolanaActiveTable({ rows, decimals, symbol, manage = false }: { rows: readonly SolanaActiveRow[]; decimals: number; symbol: string; manage?: boolean }) {
  return <div className="pf-table-scroll"><table className={manage ? 'pf-list-actions' : ''}>
    {headers(symbol, manage)}
    <tbody>{rows.map(entry => <tr key={entry.key} className={entry.kind === 'order' ? 'is-order' : ''}>
      {entry.kind === 'position' ? <PositionCells row={entry.row} decimals={decimals}/> : <OrderCells row={entry.row} grouped={entry.grouped} decimals={decimals}/>}
      {manage && <td>{entry.kind === 'order'
        ? <Action identity={entry.row.identity} label={entry.row.expired ? 'Release' : 'Cancel'}/>
        : entry.row.state.startsWith('Claim') ? <Action identity={entry.row.identity} label="Claim" kind="pf-primary"/>
        : entry.row.state === 'Trading' ? <Action identity={entry.row.identity} label="Sell" kind="pf-sell"/> : null}</td>}
    </tr>)}</tbody>
  </table></div>
}

export function SolanaPositionsTable({ rows, decimals, symbol }: { rows: readonly SolanaPositionRow[]; decimals: number; symbol: string }) {
  return <div className="pf-table-scroll"><table>
    {headers(symbol, false)}
    <tbody>{rows.map(row => <tr key={row.id}><PositionCells row={row} decimals={decimals}/></tr>)}</tbody>
  </table></div>
}
