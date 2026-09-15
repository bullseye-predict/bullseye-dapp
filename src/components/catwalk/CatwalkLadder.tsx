import { Plus } from 'lucide-react'
import { TeamMark } from '../home/HomePrimitives'
import { usdLabel } from '../solz/catwalkSource'
import type { ExplorerVenue } from '../../../packages/adapters/explorer'
import { pad, seatHeld, type CatwalkLadderSeat } from './catwalkBands'
import { LaneChip, MintButton } from './CatwalkSlotRow'

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

export function CatwalkSeatRow({ seat, onClaim, claimReason, coinHref, explorer }: {
  seat: CatwalkLadderSeat
  onClaim?: ClaimHandler
  /** Why the control is inert, when it is. Never a fake purchase. */
  claimReason?: string
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
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
      onClick={href ? () => window.location.assign(href) : undefined}
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
                  ? <a className="cw-symbol" href={href} onClick={(event) => event.stopPropagation()}>{seat.symbol ?? '—'}</a>
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
export function CatwalkLadderList({ seats, onClaim, claimReason, coinHref, explorer }: {
  seats: readonly CatwalkLadderSeat[]
  onClaim?: ClaimHandler
  claimReason?: string
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
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
          <CatwalkSeatRow key={seat.seat} seat={seat} onClaim={onClaim} claimReason={claimReason} coinHref={coinHref} explorer={explorer} />
        ))}
      </ol>
    </div>
  )
}
