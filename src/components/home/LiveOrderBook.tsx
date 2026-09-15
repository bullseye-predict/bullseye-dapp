import { Crosshair, RefreshCw } from 'lucide-react'
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { ArenaMarket } from '../solz/model'
import type { VenueMarketView } from './venue/types'
import { formatUnits } from 'viem'

export type DepthLevel = { price: bigint; quantity: bigint }
export function depthRows(levels: DepthLevel[], side: 'ask' | 'bid', decimals: number) {
  const sorted = [...levels].sort((a, b) => a.price === b.price ? 0 : (a.price < b.price ? -1 : 1) * (side === 'ask' ? 1 : -1))
  let quantity = 0n, total = 0n
  const rows = sorted.map(level => {
    quantity += level.quantity; total += level.price * level.quantity / 10n ** BigInt(decimals)
    return { ...level, cumulative: quantity, total }
  })
  return side === 'ask' ? rows.reverse() : rows
}
const number = (value: bigint, decimals: number) => Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })

export function OrderBookTable({ asks, bids, decimals, last, label, centerRowRef }: { asks: DepthLevel[]; bids: DepthLevel[]; decimals: number; last?: number; label: string; centerRowRef?: RefObject<HTMLTableRowElement | null> }) {
  const askRows = depthRows(asks, 'ask', decimals), bidRows = depthRows(bids, 'bid', decimals)
  const bestAsk = askRows.at(-1)?.price, bestBid = bidRows[0]?.price
  const spread = bestAsk !== undefined && bestBid !== undefined ? bestAsk - bestBid : undefined
  const maxDepth = [...askRows, ...bidRows].reduce((max, row) => row.cumulative > max ? row.cumulative : max, 1n)
  const rows = (levels: ReturnType<typeof depthRows>, side: 'ask' | 'bid') => levels.length ? levels.map((row, index) => <tr className={`is-${side}`} key={row.price.toString()} style={{ '--depth': `${Number(row.cumulative * 10000n / maxDepth) / 100}%` } as CSSProperties}>
    <td>{(side === 'ask' ? index === levels.length - 1 : index === 0) && <span>{side === 'ask' ? 'Asks' : 'Bids'}</span>}</td><td>{number(row.price * 100n, decimals)}¢</td><td>{number(row.quantity, 6)}</td><td>{number(row.total, 6)}</td>
  </tr>) : <tr className="ch-book-empty"><td colSpan={4}>No {side === 'ask' ? 'asks' : 'bids'}</td></tr>
  return <table className="ch-order-book" aria-label={`${label} order book`}><caption className="sr-only">Asks above last trade, bids below. Depth and totals accumulate from the best price.</caption><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr><th scope="col"><span className="sr-only">Side</span></th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th></tr></thead><tbody>
    {rows(askRows, 'ask')}
    <tr className="ch-book-spread" ref={centerRowRef}><td colSpan={2}>Last: {last === undefined ? '—' : `${(last * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}¢`}</td><td colSpan={2}>Spread: {spread === undefined ? '—' : `${number(spread * 100n, decimals)}¢`}</td></tr>
    {rows(bidRows, 'bid')}
  </tbody></table>
}

/** Pure presentation. It receives a VenueMarketView and cannot tell which chain
 *  produced it: no adapter import, no chain id, no venue branch. Adding a venue
 *  means adding a hook behind useVenueMarket, not editing this file. */
export function LiveOrderBook({ market, view, isNo, label, collateral }: { market: ArenaMarket; view: VenueMarketView; isNo: boolean; label: string; collateral: string }) {
  const { book, error, refreshing, decimals, finalized, now, refresh } = view
  const data = book ? { book, market: { decimals, finalized }, now } : null
  const viewport = useRef<HTMLDivElement>(null), centerRow = useRef<HTMLTableRowElement>(null), initialCenter = useRef('')
  // The venue's own executed price wins; priceHistory is the fallback that keeps
  // DreamDEX working, where Last is populated by the pricing producer instead.
  // Still venue-neutral: a view field and a model field, no chain branch.
  const last = (isNo ? view.last?.no : view.last?.yes)
    ?? (isNo ? market.outcomes[1] : market.outcomes[0])?.priceHistory?.at(-1)?.probability
  const recenter = () => {
    const container = viewport.current, row = centerRow.current
    if (!container || !row) return
    container.scrollTo({ top: Math.max(0, row.offsetTop - (container.clientHeight - row.clientHeight) / 2), behavior: 'smooth' })
  }
  useEffect(() => {
    const key = `${market.id}:${isNo}`
    if (data && initialCenter.current !== key) {
      recenter()
      initialCenter.current = key
    }
  }, [data, isNo, market.id])
  const quote = isNo ? view.quote?.no : view.quote?.yes
  const directAsks = isNo ? book?.noAsks : book?.yesAsks
  const oppositePrice = quote?.ask !== undefined && !directAsks?.some(row => row.price <= quote.ask!) ? quote.ask : undefined
  const volume = market.onchain?.volume24h
    ? `${market.onchain.volume24h.partial ? '≥ ' : ''}${number(BigInt(market.onchain.volume24h.amount), market.onchain.volume24h.decimals)} ${collateral} Vol.`
    : 'Volume unavailable'
  return <div className="ch-live-book">
    <div className="ch-book-toolbar"><strong className={isNo ? 'is-no' : 'is-yes'}>{label} order book</strong><span>{volume}</span><button type="button" aria-label="Recenter order book on last trade" disabled={!data} onClick={recenter}><Crosshair size={15}/><span className="sr-only">Recenter</span></button><button type="button" aria-label={`Refresh ${label} order book`} disabled={refreshing} onClick={refresh}><RefreshCw size={15}/><span className="sr-only">Refresh</span></button></div>
    {data ? <div className="ch-order-book-viewport" ref={viewport}><OrderBookTable asks={(isNo ? data.book?.noAsks : data.book?.yesAsks) ?? []} bids={(isNo ? data.book?.noBids : data.book?.yesBids) ?? []} decimals={data.market.decimals} last={last} label={label} centerRowRef={centerRow}/></div> : <p className="ch-book-message" role="status">{error ?? 'Loading order book…'}</p>}
    {oppositePrice !== undefined && <p className="ch-sample-note">Buy {label} from {(Number(oppositePrice) / 10_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}¢ through opposite-outcome bids. The table shows orders posted directly in this book.</p>}
    {/* `crossed` fires on any overlap of the consolidated interval — a bid above
        an ask on one book, combined bids over 1, or combined asks under 1 — so
        the copy must not name one of those four as the cause. */}
    {quote?.crossed && <p className="ch-sample-note">Crossed outcome quotes: the YES and NO books overlap, so there is no midpoint between them. These orders need matching; they do not establish a probability.</p>}
    {data && <div className="ch-book-footer"><span>{data.market.finalized || data.now >= market.closesAt ? 'Trading closed' : refreshing ? 'Refreshing…' : 'Auto-refresh · 10s'}</span><span>Updated {new Date(data.now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>}
    <p className="ch-sample-note">Last is the most recent trade. Depth and totals are cumulative from the best price.</p>
  </div>
}
