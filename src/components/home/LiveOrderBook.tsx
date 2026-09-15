import { Crosshair } from 'lucide-react'
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { ArenaMarket } from '../solz/model'
import type { VenueMarketView } from './venue/types'
import { formatUnits } from 'viem'

export type DepthLevel = {
  price: bigint; quantity: bigint
  /** How much of this level is the viewer's own resting order. Real depth that
   *  this viewer alone cannot take, so it is drawn and marked rather than
   *  hidden — placeBinaryLimitBuy already names it when you try to cross it. */
  own?: bigint
}
/** A displayed level, carrying how much of its size is only reachable through
 *  the opposite outcome's book. */
export type BookLevel = DepthLevel & { cross: bigint }

/** Sums native depth and cross-book depth into one row per price.
 *
 *  A NO bid at 80c is a YES ask at 20c, so both sources can quote the same
 *  price. They must merge rather than stack: DepthLevel is the aggregated-level
 *  contract every consumer assumes, and the table keys its rows by price, so two
 *  20c rows would share one React key. `cross` survives the merge so a row can
 *  say which part of itself is routed without a second lookup. */
export function consolidate(native: readonly DepthLevel[], cross: readonly DepthLevel[]): BookLevel[] {
  const totals = new Map<bigint, BookLevel>()
  const add = (level: DepthLevel, routed: boolean) => {
    const row = totals.get(level.price) ?? { price: level.price, quantity: 0n, cross: 0n }
    row.quantity += level.quantity
    if (routed) row.cross += level.quantity
    if (level.own !== undefined) row.own = (row.own ?? 0n) + level.own
    totals.set(level.price, row)
  }
  for (const level of native) add(level, false)
  for (const level of cross) add(level, true)
  return [...totals.values()]
}
/** Each side has its own cumulative dollar-depth scale. Price orders the book;
 *  the band shows how much money is reachable through that row. A nonzero
 *  level keeps a 2% visual floor, so thin liquidity remains discoverable. */
const depthPercent = (total: bigint, maximum: bigint) => Math.max(2, Number(total * 10_000n / maximum) / 100)
export function depthRows(levels: readonly (DepthLevel & { cross?: bigint })[], side: 'ask' | 'bid', decimals: number) {
  const sorted = [...levels].sort((a, b) => a.price === b.price ? 0 : (a.price < b.price ? -1 : 1) * (side === 'ask' ? 1 : -1))
  let quantity = 0n, total = 0n, own = 0n
  const rows = sorted.map(level => {
    quantity += level.quantity; own += level.own ?? 0n
    total += level.price * level.quantity / 10n ** BigInt(decimals)
    // `ownCumulative` shadows `cumulative` all the way down the ladder, so the
    // matching size a sweep reports can exclude the trader's own resting depth.
    return { ...level, cumulative: quantity, ownCumulative: own, total }
  })
  return side === 'ask' ? rows.reverse() : rows
}
const number = (value: bigint, decimals: number) => Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })
/** TOTAL is money, not a share count, so it reads as money. Two decimals
 *  because collateral here is a dollar stablecoin and a fifth digit of a cent
 *  is noise beside a four-figure sweep. */
const money = (value: bigint) => `$${Number(formatUnits(value, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** What one clicked price level hands the trade ticket: a price, which ladder it
 *  came from, what rests at it, and what a limit there would sweep in total.
 *  Not an instruction to buy or to sell — the ticket decides what to do with it
 *  based on the direction the trader is already in. */
export type LevelPick = { side: 'ask' | 'bid'; price: string; cents: string; quantity: string; cumulative: string }

/** A row click chooses a price. Which ladder the row sits in travels with it so
 *  the ticket can round toward the trader's own side and tell whether the level
 *  is executable for them; it never decides their direction.
 *
 *  `cumulative` is everything a limit at this price would match — the level and
 *  everything better — which is what a taker actually gets, and what the ticket
 *  fills the share field with when the level is on the ladder they are taking.
 *
 *  Both sizes are net of `own`: a trader cannot fill their own resting order, so
 *  counting it would promise depth the venue then refuses. */
export function levelPick(level: { price: bigint; quantity: bigint; own?: bigint; cumulative?: bigint; ownCumulative?: bigint }, side: 'ask' | 'bid', decimals: number): LevelPick {
  const net = (total: bigint, own: bigint) => formatUnits(total - own > 0n ? total - own : 0n, 6)
  return {
    side,
    price: level.price.toString(),
    cents: formatUnits(level.price * 100n, decimals),
    quantity: net(level.quantity, level.own ?? 0n),
    cumulative: net(level.cumulative ?? level.quantity, level.ownCumulative ?? level.own ?? 0n),
  }
}

type TableProps = {
  asks: DepthLevel[]; bids: DepthLevel[]; decimals: number; last?: number; label: string
  /** Asks that rest on the opposite outcome's book as bids. Merged into the ask
   *  ladder because the ticket already fills against them, and marked because a
   *  trader taking one is routed through a complete set rather than a direct
   *  fill. Bids have no counterpart: there is no complete-set sell route. */
  crossAsks?: DepthLevel[]
  /** The outcome those cross levels rest on, for the row's marker. */
  crossLabel?: string
  centerRowRef?: RefObject<HTMLTableRowElement | null>
  /** Absent on a decorative book — the unopened-market placeholder renders the
   *  same table and must not offer levels on a market that does not exist. */
  onPick?: (pick: LevelPick) => void
  /** "<side>:<price in atoms>" for the picked level, and only while this book
   *  owns the pick. Side as well as price, because a crossed book can quote the
   *  same price as both a bid and an ask. */
  picked?: string
  onRecenter?: () => void
}

export function OrderBookTable({ asks, bids, decimals, last, label, crossAsks, crossLabel, centerRowRef, onPick, picked, onRecenter }: TableProps) {
  const askRows = depthRows(consolidate(asks, crossAsks ?? []), 'ask', decimals), bidRows = depthRows(bids, 'bid', decimals)
  const askMaximum = askRows.reduce((maximum, row) => row.total > maximum ? row.total : maximum, 1n)
  const bidMaximum = bidRows.reduce((maximum, row) => row.total > maximum ? row.total : maximum, 1n)
  const bestAsk = askRows.at(-1)?.price, bestBid = bidRows[0]?.price
  const spread = bestAsk !== undefined && bestBid !== undefined ? bestAsk - bestBid : undefined
  // One tab stop for the whole book, arrow keys between levels: twenty tab stops
  // to cross one panel is why the grid pattern exists. The stop follows the
  // picked level, so coming back lands on what the ticket is holding.
  const ids = [...askRows.map(row => `ask:${row.price}`), ...bidRows.map(row => `bid:${row.price}`)]
  const tabStop = picked !== undefined && ids.includes(picked) ? picked : ids[0]
  const move = (from: HTMLTableRowElement, delta: number) => {
    const all = [...(from.closest('tbody')?.querySelectorAll<HTMLTableRowElement>('tr[data-level]') ?? [])]
    all[all.indexOf(from) + delta]?.focus()
  }
  const rows = (levels: ReturnType<typeof depthRows>, side: 'ask' | 'bid') => levels.length ? levels.map((row, index) => {
    const id = `${side}:${row.price}`
    const isPicked = picked === id
    const pick = () => onPick?.(levelPick(row, side, decimals))
    // Depth that exists only on the other outcome's book must not read as an
    // ordinary resting order: taking it mints a complete set rather than
    // filling directly, which is a different transaction with its own
    // collateral. The price and the sweep are still correct, so the level stays
    // pickable and the ticket routes it (limit.ts nextBinaryBuy).
    const routed = row.cross ? (row.cross === row.quantity ? 'is-cross' : 'is-mixed') : ''
    const boundary = side === 'ask' ? index === levels.length - 1 : index === 0
    // Drawn, but not yours to take. Saying so is the point of publishing `own`
    // instead of filtering: a level you cannot fill should not read as depth you
    // can sweep, and it should not vanish from the book either.
    const mine = (row.own ?? 0n) > 0n
    // The table becomes a grid while it is pickable: that is the pattern a
    // screen reader expects of a focusable row that takes Enter/Space and
    // reports aria-selected. A crossed book can quote the same price on both
    // sides, so the row's identity carries the side as well.
    return <tr
      className={`is-${side}${onPick ? ' is-pickable' : ''}${isPicked ? ' is-picked' : ''}${routed && ` ${routed}`}${mine ? ' is-mine' : ''}`}
      key={id}
      style={{ '--depth': `${depthPercent(row.total, side === 'ask' ? askMaximum : bidMaximum)}%` } as CSSProperties}
      {...(onPick ? {
        'data-level': id,
        tabIndex: id === tabStop ? 0 : -1,
        'aria-selected': isPicked,
        'aria-label': `Use ${number(row.price * 100n, decimals)}¢ as the limit price. ${number(row.quantity, 6)} ${label} resting at this level${routed ? `. This level is ${routed === 'is-mixed' ? 'partly ' : ''}routed through ${crossLabel ?? 'the opposite'} bids` : ''}${mine ? '. Includes your own resting order, which you cannot fill' : ''}`,
        onClick: pick,
        onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); return }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault(); move(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1)
        },
      } : {})}
    >
      <td>{boundary && <span>{side === 'ask' ? 'Asks' : 'Bids'}</span>}{routed ? <em className="ch-book-cross">via {crossLabel}</em> : null}{mine ? <em className="ch-book-mine">yours</em> : null}</td><td>{number(row.price * 100n, decimals)}¢</td><td>{number(row.quantity, 6)}</td><td>{money(row.total)}</td>
    </tr>
  }) : <tr className="ch-book-empty"><td colSpan={4}>No {side === 'ask' ? 'asks' : 'bids'}</td></tr>
  return <table className="ch-order-book" role={onPick ? 'grid' : undefined} aria-label={`${label} order book`}><caption className="sr-only">Asks above last trade, bids below. Totals accumulate from the best price.{onPick ? ' Choosing a level sets the limit price on the trade ticket; it does not change whether you are buying or selling.' : ''}</caption><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr>
    <th scope="col" className="ch-book-tools">{onRecenter ? <button type="button" onClick={onRecenter} aria-label="Recenter order book on the last trade"><Crosshair size={13}/></button> : <span className="sr-only">Side</span>}</th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th>
  </tr></thead><tbody>
    {rows(askRows, 'ask')}
    {/* Spread sits in the PRICE column rather than floating at the far right:
        it is a price, and it reads against the prices it is measured from. */}
    <tr className="ch-book-spread" ref={centerRowRef}><td>Last: {last === undefined ? '—' : `${(last * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}¢`}</td><td>Spread: {spread === undefined ? '—' : `${number(spread * 100n, decimals)}¢`}</td><td colSpan={2}/></tr>
    {rows(bidRows, 'bid')}
  </tbody></table>
}

/** The most recent execution, stated in one outcome's terms.
 *
 *  The venue's own executed price wins; priceHistory is the fallback that keeps
 *  DreamDEX working, where Last is populated by the pricing producer instead.
 *  Still venue-neutral: a view field and a model field, no chain branch.
 *
 *  Each outcome keeps its own execution history, though, so the YES and NO
 *  panels could print 84c and 90c at the same instant: two real trades that
 *  cannot both be the last price of one question. A NO fill at 90c IS a YES
 *  execution at 10c, so take whichever executed more recently and complement it
 *  when it came from the other book. A no-op on DreamDEX, whose two series are
 *  complementary by construction. */
export function lastExecution(view: Pick<VenueMarketView, 'last'>, market: Pick<ArenaMarket, 'outcomes'>, isNo: boolean) {
  const venue = isNo ? view.last?.no : view.last?.yes
  if (venue !== undefined) return venue
  const own = (isNo ? market.outcomes[1] : market.outcomes[0])?.priceHistory?.at(-1)
  const other = (isNo ? market.outcomes[0] : market.outcomes[1])?.priceHistory?.at(-1)
  return other && (!own || other.at > own.at) ? 1 - other.probability : own?.probability
}

/** Keep the table geometry in place until the venue returns its first book. */
export function OrderBookSkeleton({ label }: { label: string }) {
  const rows = ['ask', 'ask', 'spread', 'bid', 'bid'] as const
  return <div className="ch-book-skeleton" role="status" aria-busy="true" aria-label={`Loading ${label} order book`}>
    <span className="sr-only">Loading order book</span>
    <table className="ch-order-book" aria-hidden="true"><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr>
      <th scope="col" className="ch-book-tools"><span className="sr-only">Side</span></th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th>
    </tr></thead><tbody>{rows.map((side, index) => side === 'spread'
      ? <tr className="ch-book-spread" key={side}><td><i/></td><td><i/></td><td colSpan={2}/></tr>
      : <tr className={`ch-book-skeleton-row is-${side}`} key={`${side}-${index}`}><td>{index === 0 || index === 3 ? <i className="ch-book-skeleton-tag"/> : null}</td><td><i/></td><td><i/></td><td><i/></td></tr>)}</tbody></table>
  </div>
}

/** Pure presentation. It receives a VenueMarketView and cannot tell which chain
 *  produced it: no adapter import, no chain id, no venue branch. Adding a venue
 *  means adding a hook behind useVenueMarket, not editing this file. */
export function LiveOrderBook({ market, view, isNo, label, onPick, picked }: { market: ArenaMarket; view: VenueMarketView; isNo: boolean; label: string; onPick?: (pick: LevelPick) => void; picked?: string }) {
  const { book, decimals } = view
  // `finalized` and `now` went with the footer that reported them.
  const data = book ? { book, decimals } : null
  const viewport = useRef<HTMLDivElement>(null), centerRow = useRef<HTMLTableRowElement>(null), initialCenter = useRef('')
  // The venue's own executed price wins; priceHistory is the fallback that keeps
  // DreamDEX working, where Last is populated by the pricing producer instead.
  // Still venue-neutral: a view field and a model field, no chain branch.
  const last = lastExecution(view, market, isNo)
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
  // The heading, the 24h volume, the refresh control and the standing footnotes
  // all moved or went: the volume is already on the row above this panel, the
  // refresh now sits in the tab strip, and the caption carries what the notes
  // used to say. What is left below the table is only ever a live condition.
  return <div className="ch-live-book">
    {data ? <div className="ch-order-book-viewport" ref={viewport}><OrderBookTable asks={(isNo ? data.book.noAsks : data.book.yesAsks) ?? []} bids={(isNo ? data.book.noBids : data.book.yesBids) ?? []} crossAsks={(isNo ? data.book.crossNoAsks : data.book.crossYesAsks) ?? []} crossLabel={isNo ? 'YES' : 'NO'} decimals={data.decimals} last={last} label={label} centerRowRef={centerRow} onPick={onPick} picked={picked} onRecenter={recenter}/></div> : <OrderBookSkeleton label={label}/>}
    {/* `crossed` fires on any overlap of the consolidated interval — a bid above
        an ask on one book, combined bids over 1, or combined asks under 1 — so
        the copy must not name one of those four as the cause. */}
    {quote?.crossed && <p className="ch-sample-note">Crossed outcome quotes: the YES and NO books overlap, so there is no midpoint between them. These orders need matching; they do not establish a probability.</p>}
  </div>
}
