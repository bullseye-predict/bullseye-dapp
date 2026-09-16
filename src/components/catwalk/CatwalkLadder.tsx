import { Lock, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'
import { TeamMark } from '../home/HomePrimitives'
import { usdLabel } from '../solz/catwalkSource'
import type { ExplorerVenue } from '../../../packages/adapters/explorer'
import { pad, seatHeld, type CatwalkLadderSeat } from './catwalkBands'
import type { OutbidRow, OutbidStatus } from './catwalkOutbid'
import { LaneChip, MarketCap, MintButton, pickCoin } from './CatwalkSlotRow'

/**
 * THE SPOT LADDER: the list of things that are actually for sale.
 *
 * It is a separate list from the board, and that separation is the whole point.
 * The board is the CATWALK table - positions 1..lineupSize in lane-priority
 * order, saying who walks. The ladder is the outbid lane's quota - seats
 * 1..outbidSpots in the sale's own numbering, saying what a buyer can take and
 * from whom. The two numberings are unrelated.
 *
 * Joining them by index published a sold seat twice: once as the outbid row of
 * the coin that bought it, and again as an "OPEN SLOT" under whatever board
 * position happened to carry the same number. A seat appears here exactly once,
 * and a seat is the only thing on this page that carries a price tag.
 */

export type ClaimHandler = (seat: CatwalkLadderSeat) => void

function seatLabel(seat: CatwalkLadderSeat) {
  const price = seat.askUsdMicros > 0 ? usdLabel(seat.askUsdMicros) : 'no published ask'
  if (!seatHeld(seat)) return `Ladder seat ${seat.seat}, nobody holds it, ${price} to take`
  const who = seat.symbol ?? seat.mint ?? 'a coin'
  const held = seat.heldUsdMicros ? `, held at ${usdLabel(seat.heldUsdMicros)}` : ''
  return `Ladder seat ${seat.seat}, held by ${who}${held}, ${price} to outbid`
}

export function CatwalkSeatRow({ seat, onClaim, claimReason, coinHref, explorer, onCoin }: {
  seat: CatwalkLadderSeat
  onClaim?: ClaimHandler
  /** Why the control is inert, when it is. Never a fake purchase. */
  claimReason?: string
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
  /** Filter the board in place instead of reloading it. See `pickCoin`. */
  onCoin?: (mint: string) => void
}) {
  const held = seatHeld(seat)
  const priced = seat.askUsdMicros > 0
  const href = held && seat.mint && coinHref ? coinHref(seat.mint) : undefined
  return (
    <li
      className={`cw-slot${held ? '' : ' cw-slot--open'}`}
      data-lane={held ? 'outbid' : 'open'}
      data-walks="true"
      aria-label={seatLabel(seat)}
      onClick={onCoin && held && seat.mint ? () => onCoin(seat.mint!) : undefined}
    >
      <span className="cw-num">{pad(seat.seat)}</span>

      {held
        ? <TeamMark id={seat.mint ?? ''} logoUrl={seat.logoUrl ?? undefined} className="cw-crest" />
        : <span className="cw-open-well" aria-hidden="true"><Plus size={14} /></span>}

      <span className="cw-id">
        {held
          ? <>
              <span className="cw-id-head">
                {href
                  ? <a className="cw-symbol" href={href} onClick={pickCoin(onCoin, seat.mint ?? '')}>{seat.symbol ?? '—'}</a>
                  : <b className="cw-symbol">{seat.symbol ?? '—'}</b>}
                {seat.name && seat.name !== seat.symbol ? <small className="cw-coin-name">{seat.name}</small> : null}
              </span>
              {seat.mint ? <MintButton mint={seat.mint} explorer={explorer} /> : null}
            </>
          : <>
              <b className="cw-open-title">SEAT {pad(seat.seat)}</b>
              <small>On the spot ladder. Nobody holds it yet.</small>
            </>}
      </span>

      <LaneChip lane={held ? 'outbid' : 'open'} />

      <span className="cw-metric">
        <small>{held ? 'TO TAKE' : 'ASK'}</small>
        <b className="cw-money">{priced ? usdLabel(seat.askUsdMicros) : '—'}</b>
        {/* What the holder paid, published by the ladder itself alongside the
            seat - never looked up from a board row that shares the number. */}
        {seat.heldUsdMicros ? <small>HELD AT {usdLabel(seat.heldUsdMicros)}</small> : null}
      </span>

      {priced
        ? <button
            type="button"
            className={`cw-act${held ? '' : ' cw-act--claim'}`}
            disabled={!onClaim}
            title={onClaim ? undefined : claimReason}
            onClick={(event) => { event.stopPropagation(); onClaim?.(seat) }}
          >
            {held ? 'OUTBID' : 'TAKE'} {usdLabel(seat.askUsdMicros)}
          </button>
        : <span className="cw-act cw-act--closed" title="This seat is on the ladder but carries no published ask.">
            NO ASK PUBLISHED
          </span>}
    </li>
  )
}

/** The ladder as a list. It wears the OUTBID lane's colour, because every seat
 *  on it is an outbid-lane seat - the same colour that lane's chips and its tab
 *  carry. It borrows nothing from a board position, which has no colour. */
export function CatwalkLadderList({ seats, onClaim, claimReason, coinHref, explorer, onCoin }: {
  seats: readonly CatwalkLadderSeat[]
  onClaim?: ClaimHandler
  claimReason?: string
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
  onCoin?: (mint: string) => void
}) {
  return (
    <div className="cw-band cw-ladder" data-lane="outbid">
      <h3 className="cw-band-head" data-lane="outbid" aria-hidden="true">
        <span>SPOT LADDER</span>
        <em>{seats.length === 1 ? '1 SEAT' : `${seats.length} SEATS`}</em>
        <small>SEAT NUMBERS ARE THE SALE'S OWN, NOT BOARD POSITIONS</small>
      </h3>
      <ol aria-label="Spot ladder">
        {seats.map((seat) => (
          <CatwalkSeatRow key={seat.seat} seat={seat} onClaim={onClaim} claimReason={claimReason} coinHref={coinHref} explorer={explorer} onCoin={onCoin} />
        ))}
      </ol>
    </div>
  )
}

/* ── THE OUTBID LIST: THE COINS ──────────────────────────────────────────── */

/**
 * What the action column says, and whether it does anything.
 *
 * Five outcomes, because five different things are true. They are kept apart
 * for the same reason `saleBlock` keeps its three apart on the board: a shut
 * sale, an unreadable one and a coin the ladder simply does not publish a seat
 * for are three facts, and a champion is not a fact about the sale at all.
 */
const ACTION: Record<OutbidStatus, { label: string; title: string }> = {
  takeable: { label: 'OUTBID', title: 'Take this seat from its holder at the published ask.' },
  open: {
    label: 'OPEN',
    title: 'Nobody is standing here. A board position is not sold by its number — seats are taken on the spot ladder below.',
  },
  locked: {
    label: 'CANNOT BE OUTBID',
    title: 'A champion holds its slot on season wins. No price takes it.',
  },
  unlisted: {
    label: 'NOT FOR SALE',
    title: 'The spot ladder publishes no seat for this coin, so there is nothing to outbid.',
  },
  closed: {
    label: 'BIDDING CLOSED',
    title: 'The spot ladder is closed. This coin still holds its slot.',
  },
  unknown: {
    label: 'PRICE UNAVAILABLE',
    title: 'The spot ladder could not be read just now. That is not the same as a closed sale.',
  },
}

/** The metric column's heading. 'TO TAKE' is a price; everything else names the
 *  absence of one rather than leaving a bare dash to be read as zero.
 *
 *  It never repeats the action beside it: the column used to read SALE CLOSED
 *  against a button reading BIDDING CLOSED, which is one fact printed twice and
 *  looks at a glance like two. This column answers "what would it cost"; the
 *  button answers "can I do anything about it". */
const METRIC_HEAD: Record<OutbidStatus, string> = {
  takeable: 'TO TAKE', open: 'ROTATION', locked: 'HELD ON WINS', unlisted: 'NOT LISTED', closed: 'NO ASK', unknown: 'NO ASK READ',
}

function outbidLabel(row: OutbidRow) {
  if (row.status === 'open') return `Slot ${row.spot}, open, ${row.walks ? 'walks every rotation' : 'one rotation away'}`
  const who = row.symbol ?? row.mint ?? `seat ${row.seat?.seat ?? ''}`
  const where = row.spot ? `, slot ${row.spot}` : ''
  const ask = row.seat && row.seat.askUsdMicros > 0 ? usdLabel(row.seat.askUsdMicros) : null
  if (row.status === 'takeable') return `${who}${where}, ${ask} to outbid`
  return `${who}${where}, ${ACTION[row.status].label.toLowerCase()}`
}

/**
 * ONE COIN ON THE OUTBID LIST.
 *
 * It names the coin first and prices it second, which is the opposite way round
 * from the seat row above - and deliberately. A seat is a thing for sale that
 * may happen to have somebody on it; this is a coin standing on the board that
 * may happen to be takeable. The tab is read to find out who is up there.
 *
 * A PRICE IS PRINTED ONLY FROM `row.seat`, which buildBoard resolved BY MINT.
 * There is no path in this component from a slot number to an ask.
 */
export function CatwalkOutbidRow({ row, onClaim, claimReason, coinHref, explorer, onLadder, onCoin }: {
  row: OutbidRow
  onClaim?: ClaimHandler
  claimReason?: string
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
  /** Filter the board in place instead of reloading it. See `pickCoin`. */
  onCoin?: (mint: string) => void
  /** Sends the reader to the seats, and passed only when the ladder actually has
   *  one nobody is standing on. A vacancy is never priced here. */
  onLadder?: () => void
}) {
  const seat = row.seat
  const takeable = row.status === 'takeable' && seat && seat.askUsdMicros > 0
  const open = row.status === 'open'
  const href = row.mint && coinHref ? coinHref(row.mint) : undefined
  const action = ACTION[row.status]
  return (
    <li
      className={`cw-slot cw-outbid-row${open ? ' cw-slot--open' : ''}`}
      data-lane={row.lane ?? 'outbid'}
      data-status={row.status}
      data-walks={row.walks}
      aria-label={outbidLabel(row)}
      style={row.color ? ({ '--team-color': row.color } as CSSProperties) : undefined}
      onClick={onCoin && row.mint ? () => onCoin(row.mint!) : undefined}
    >
      {/* THE BOARD SLOT, printed so the reader can find this position again on
          the CATWALK tab. It is not a seat number and nothing is looked up by
          it - the ask on this row, when there is one, came from the seat this
          coin's own MINT holds. */}
      <span className="cw-num">{row.spot ? pad(row.spot) : '—'}</span>

      {open
        ? <span className="cw-open-well" aria-hidden="true"><Plus size={14} /></span>
        : <TeamMark id={row.mint ?? ''} color={row.color ?? undefined} logoUrl={row.logoUrl ?? undefined} className="cw-crest" />}

      <span className="cw-id">
        {open
          ? <>
              <b className="cw-open-title">OPEN SLOT</b>
              <small>{row.walks ? 'Walks every rotation. Nobody is standing here yet.' : 'One rotation away. Nobody is standing here yet.'}</small>
            </>
          : <>
              <span className="cw-id-head">
                {href
                  ? <a className="cw-symbol" href={href} onClick={pickCoin(onCoin, row.mint ?? '')}>{row.symbol ?? '—'}</a>
                  : <b className="cw-symbol">{row.symbol ?? '—'}</b>}
                {row.name && row.name !== row.symbol ? <small className="cw-coin-name">{row.name}</small> : null}
              </span>
              {row.mint ? <MintButton mint={row.mint} explorer={explorer} /> : null}
            </>}
      </span>

      {open
        ? <span className="cw-mcap cw-mcap--empty" aria-hidden="true"><small>MKT CAP</small><b>—</b></span>
        : <MarketCap usd={row.marketCapUsd} />}

      <LaneChip lane={row.lane ?? 'outbid'} />

      <span className="cw-metric">
        <small title={takeable ? undefined : action.title}>{METRIC_HEAD[row.status]}</small>
        {open
          ? <b>{row.walks ? 'WALKS IN' : 'ONE AWAY'}</b>
          : <b className={takeable ? 'cw-money' : undefined}>{takeable ? usdLabel(seat!.askUsdMicros) : '—'}</b>}
        {/* The holder's own price, off the holder's own entry. */}
        {row.paidUsdMicros ? <small>PAID {usdLabel(row.paidUsdMicros)}</small> : null}
      </span>

      {takeable
        ? <button
            type="button"
            className="cw-act"
            disabled={!onClaim}
            title={onClaim ? action.title : claimReason}
            onClick={(event) => { event.stopPropagation(); onClaim?.(seat!) }}
          >
            OUTBID {usdLabel(seat!.askUsdMicros)}
          </button>
        : open && row.walks && onLadder
          ? <button
              type="button"
              className="cw-act cw-act--claim"
              title={action.title}
              onClick={(event) => { event.stopPropagation(); onLadder() }}
            >
              TAKE A SEAT
            </button>
          : <span className={`cw-act ${row.status === 'locked' ? 'cw-act--locked' : 'cw-act--closed'}`} title={action.title}>
              {row.status === 'locked' ? <Lock size={11} aria-hidden="true" /> : null}
              {open ? 'FILLS FROM THE LANES' : action.label}
            </span>}
    </li>
  )
}

/**
 * THE OUTBID TAB'S LIST, WHICH IS A LIST OF COINS.
 *
 * It renders in every ladder state, because the coins on the board are there in
 * every ladder state. What changes with the sale is the price column and the
 * button - not whether the field exists. The tab used to render the ladder
 * alone, so a shut sale published three unnamed "Configured seat" strips and the
 * reader could not see a single coin.
 *
 * Seats nobody is standing on keep their own row, their own numbering and their
 * own vocabulary, below the coins: they are the sale's list, and `CatwalkSeatRow`
 * is where a seat is authored.
 */
export function CatwalkOutbidList({ rows, note, onClaim, claimReason, coinHref, explorer, onLadder, onCoin }: {
  rows: readonly OutbidRow[]
  /** What the sale is doing, in one line under the head. Stated here once for
   *  the list rather than repeated down a column of identical cells. */
  note: string
  onClaim?: ClaimHandler
  claimReason?: string
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
  onLadder?: () => void
  onCoin?: (mint: string) => void
}) {
  // Board positions, vacancies included. The head counts the COINS among them,
  // because "12 POSITIONS" beside a list of twelve says nothing a reader cannot
  // see, and how many of them are actually held is the figure they came for.
  const board = rows.filter((row) => row.spot !== null)
  const taken = board.filter((row) => row.mint).length
  const seats = rows.filter((row) => !row.mint && row.seat).map((row) => row.seat!)
  return (
    <div className="cw-band cw-ladder cw-outbid-tokens" data-lane="outbid">
      <h3 className="cw-band-head" data-lane="outbid" aria-hidden="true">
        <span>ON THE BOARD</span>
        <em>{taken} OF {board.length} HELD</em>
        <small>{note}</small>
      </h3>
      {board.length
        ? <ol aria-label="Positions on the board">
            {board.map((row) => (
              <CatwalkOutbidRow key={row.key} row={row} onClaim={onClaim} claimReason={claimReason} coinHref={coinHref} explorer={explorer} onLadder={onLadder} onCoin={onCoin} />
            ))}
          </ol>
        : <p className="cw-outbid-empty">The board publishes no positions yet.</p>}

      {seats.length
        ? <>
            <h3 className="cw-band-head" data-lane="outbid" aria-hidden="true">
              <span>SPOT LADDER</span>
              <em>{seats.length === 1 ? '1 OPEN SEAT' : `${seats.length} OPEN SEATS`}</em>
              <small>SEAT NUMBERS ARE THE SALE'S OWN, NOT BOARD POSITIONS</small>
            </h3>
            <ol aria-label="Open seats on the spot ladder">
              {seats.map((seat) => (
                <CatwalkSeatRow key={seat.seat} seat={seat} onClaim={onClaim} claimReason={claimReason} coinHref={coinHref} explorer={explorer} onCoin={onCoin} />
              ))}
            </ol>
          </>
        : null}
    </div>
  )
}
