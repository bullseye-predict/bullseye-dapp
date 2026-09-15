import { ArrowUpRight, Crown, Receipt } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { TeamMark } from '../home/HomePrimitives'
import { catwalkSeasonLabel, usdLabel, type CatwalkSeason } from '../solz/catwalkSource'
import { SegBar } from '../solz/ui'
import { pad, type CatwalkBoardShape, type CatwalkRow, type LadderState } from './catwalkBands'
import { LaneChip } from './CatwalkSlotRow'

/**
 * The head of the board: the season, the three plinths at the front of the
 * walk, the counter strip and the explainer.
 *
 * The hero always renders exactly three cards, whatever the fill - never two,
 * never four - so an empty board is the same code path as a full one and there
 * is no separate launch screen to maintain. They are the first three POSITIONS,
 * not a podium: nothing here has been won by finishing.
 *
 * THE ONE THING IT WILL NOT DO IS COUNT BEFORE IT HAS READ. Until the board read
 * lands, the fill of the board is unknown, and an unknown number is not zero:
 * every count, the headline that summarises them and the three plinths render as
 * skeletons of exactly the size they will occupy, and state nothing. Rendering
 * the default shape as fact told every first-frame viewer the board was empty
 * while it may have been full.
 */

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    setReduced(query.matches)
    const listen = () => setReduced(query.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [])
  return reduced
}

function useMediaQuery(media: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const query = window.matchMedia?.(media)
    if (!query) return
    setMatches(query.matches)
    const listen = () => setMatches(query.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [media])
  return matches
}

const DAY = 86_400_000

export function daysLeft(season: CatwalkSeason | null, now: number) {
  if (!season?.endsAt) return null
  return Math.max(0, Math.ceil((season.endsAt - now) / DAY))
}

/** DD:HH:MM:SS.
 *
 *  ui.tsx's Countdown is the app's shared clock but its formatClock tops out at
 *  hours, so a 30-day season reads `713:04:11` there. The board needs a day
 *  field and, under reduced motion, a minute tick - neither of which that
 *  component can express today. Lifting both into ui.tsx is the right home for
 *  this once it is safe to change a component every other surface renders.
 */
function clockParts(remaining: number, withSeconds: boolean) {
  const total = Math.max(0, remaining)
  const days = Math.floor(total / DAY)
  const hours = Math.floor((total % DAY) / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1_000)
  const fields = [days, hours, minutes, ...(withSeconds ? [seconds] : [])]
  return fields.map((field) => String(field).padStart(2, '0')).join(':')
}

function CatwalkClock({ season, activeSlots }: { season: CatwalkSeason; activeSlots: number }) {
  const reduced = useReducedMotion()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (season.endsAt - Date.now() <= 0) return
    const period = reduced ? 60_000 : 1_000
    const timer = window.setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      if (season.endsAt - tick <= 0) window.clearInterval(timer)
    }, period)
    return () => window.clearInterval(timer)
  }, [season.endsAt, reduced])

  const remaining = Math.max(0, season.endsAt - now)
  return (
    <div className="cw-clock">
      {/* Not "BOARD LOCKS IN": the season carries only startsAt/endsAt, so a
          lock label would be a lie for 29 days of a 30-day season. */}
      <small>SEASON ENDS IN</small>
      <b role="timer" aria-live="off">{remaining > 0 ? clockParts(remaining, !reduced) : 'CLOSED'}</b>
      <span>TOP {activeSlots} WALK IN EVERY ROTATION</span>
    </div>
  )
}

/**
 * THE CROWN GATE. A crown renders if and only if the coin holds the slot through
 * the champion lane. A coin holding the front of the walk because it outbid
 * wears a receipt instead, and a ranked holder wears neither. Simplifying this
 * to `position === 1` would tell the viewer a coin won MIAW PRIX when it merely
 * paid, which is the one distinction the whole product turns on.
 */
function HeroBadge({ lane }: { lane: CatwalkRow['lane'] }) {
  if (lane === 'champion') return <Crown className="cw-crown" size={38} aria-hidden="true" />
  if (lane === 'outbid') return <Receipt className="cw-bought" size={28} aria-hidden="true" />
  return null
}

function HeroCard({ position, row, pending, onLadder }: {
  position: number; row: CatwalkRow | null; pending: boolean; onLadder?: () => void
}) {
  const team = row?.entry?.team ?? null
  const open = !row || row.lane === 'open'

  // The plinth at its full size with nothing written on it.
  //
  // It does NOT carry `cw-hero-card--open`. Withholding the word OPEN was only
  // half the job: that class is this page's visual vocabulary for a vacancy -
  // dashed edge, unlit fill, ghosted number - so the first frame painted three
  // vacancies before any read landed, which is the same claim in paint rather
  // than in words. `--pending` owns its own neutral treatment in catwalk.css.
  if (pending) {
    return (
      <div className="cw-hero-card cw-hero-card--pending" data-pos={position}>
        <div className="cw-hero-face">
          <i aria-hidden="true">{pad(position)}</i>
          <i className="cw-pending cw-pending--plinth" aria-hidden="true" />
          <i className="cw-pending cw-pending--act" aria-hidden="true" />
        </div>
      </div>
    )
  }

  // A PLINTH CARRIES NO PRICE. Slot 01 is a board position, and board positions
  // are not sold: the seat with the matching number belongs to the ladder, may
  // be held by someone else entirely, and pricing the front of the walk from it
  // sold a stranger's seat off the hero. The plinth states the vacancy only.
  if (open) {
    return (
      <div className="cw-hero-card cw-hero-card--open" data-pos={position}>
        <div className="cw-hero-face">
          <i aria-hidden="true">{pad(position)}</i>
          <strong>OPEN</strong>
          <span className="cw-hero-fills">FILLS FROM THE LANES</span>
          {onLadder
            ? <button type="button" className="cw-act cw-act--claim" onClick={onLadder}>TAKE A SEAT</button>
            : <span className="cw-act cw-act--ghostly" title="Positions fill from the outbid, champion and ranked lanes. Seats are bought on the spot ladder.">
                NOT SOLD BY NUMBER
              </span>}
        </div>
      </div>
    )
  }

  return (
    <div className="cw-hero-card" data-pos={position}>
      <HeroBadge lane={row!.lane} />
      <div className="cw-hero-face">
        <TeamMark id={team?.id ?? row!.entry!.mint} color={team?.color} logoUrl={team?.logoUrl} className="cw-hero-mark" />
        <i className="cw-hero-scrim" aria-hidden="true" />
      </div>
      <div className="cw-hero-name">
        <b>{team?.symbol ?? '—'}</b>
        <small>{team?.name ?? row!.entry!.mint}</small>
        {/* Two labelled figures on a rule, not "3 W · 0 L": the middle dot was
            doing the work a column gap does better, and this page was leaning
            on it in nine different places. */}
        {row!.standing
          ? <span className="cw-hero-record"><b>{row!.standing.wins}W</b><b>{row!.standing.losses}L</b></span>
          : row!.recordKnown
            ? <span className="cw-hero-norecord">NO WALKS YET</span>
            : <span className="cw-hero-norecord" title="The season record could not be read.">RECORD UNAVAILABLE</span>}
        <LaneChip lane={row!.lane} />
      </div>
    </div>
  )
}

export type HeroProps = {
  shape: CatwalkBoardShape
  season: CatwalkSeason | null
  /** True until the board read lands. Nothing countable may be stated. */
  pending?: boolean
  /** Sends the viewer to the spot ladder. Passed only when the ladder is open
   *  and has an unheld seat, because that is the only time there is one to take. */
  onLadder?: () => void
}

export function CatwalkHero({ shape, season, pending = false, onLadder }: HeroProps) {
  const front = [1, 2, 3].map((spot) => shape.rows.find((row) => row.spot === spot) ?? null)
  const headline = shape.walkingClaimed === 0
    ? 'NOBODY HAS WALKED IN YET'
    : `THE TOP ${shape.activeSlots} WALK EVERY MIAW PRIX ROTATION`
  const label = catwalkSeasonLabel(season)
  return (
    <section className="cw-hero">
      <div className="cw-hero-season">
        {/* Two labelled items rather than "MIAW PRIX · SEASON 00". */}
        <span className="cw-kicker"><i aria-hidden="true" />MIAW PRIX{label ? <em>{label}</em> : null}</span>
        <h1>CATWALK<i aria-hidden="true" /></h1>
        {pending
          ? <p><i className="cw-pending cw-pending--line" aria-hidden="true" /></p>
          : <p>{headline}</p>}
        {season ? <CatwalkClock season={season} activeSlots={shape.activeSlots} /> : null}
        <div className="cw-claim-rail">
          {pending
            ? <>
                <span><i className="cw-pending cw-pending--word" aria-hidden="true" /></span>
                <i className="cw-pending cw-pending--seg" aria-hidden="true" />
              </>
            : <>
                <span>{shape.walkingClaimed} OF {shape.activeSlots} WALK-IN SLOTS CLAIMED</span>
                {/* Segments, not a percentage: two lit ticks out of twelve reads
                    as a countable start, where a 17% bar reads as failure. */}
                <SegBar value={shape.walkingClaimed} total={shape.activeSlots} cells={shape.activeSlots} tone="acid" label="Walk-in slots claimed" />
              </>}
        </div>
      </div>
      <div className="cw-hero-front">
        <span className="cw-hero-ghost" aria-hidden="true">1</span>
        {front.map((row, index) => (
          <HeroCard key={index + 1} position={index + 1} row={row} pending={pending} onLadder={onLadder} />
        ))}
      </div>
    </section>
  )
}

/**
 * Emptiness stated as a countable position, before the viewer reaches a single
 * empty row. Every value here comes from a field that exists on the wire today,
 * and every one of them is a LABELLED FIGURE in its own cell rather than a
 * clause strung onto the next one with a middle dot.
 */
export function CatwalkCounter({ shape, season, ladder, pending = false, now }: {
  shape: CatwalkBoardShape; season: CatwalkSeason | null; ladder: LadderState; pending?: boolean; now: number
}) {
  const remaining = daysLeft(season, now)
  const priced = ladder === 'open' && shape.floorUsdMicros
  // Three different reasons for no floor, and the strip says which. "SALE
  // CLOSED" under an unreadable ladder was the page inventing the reason.
  const floorNote = priced ? 'CHEAPEST LADDER SEAT' : ladder === 'closed' ? 'SALE CLOSED' : ladder === 'unknown' ? 'PRICE UNAVAILABLE' : 'NOTHING FOR SALE'
  const label = catwalkSeasonLabel(season)
  // One skeleton cell, so every count is either read or visibly not yet read.
  const cell = (head: string, body: ReactNode, note?: ReactNode) => (
    <div>
      <small>{head}</small>
      {pending ? <b><i className="cw-pending cw-pending--num" aria-hidden="true" /></b> : body}
      {pending ? <small>&nbsp;</small> : note}
    </div>
  )
  return (
    <div className="cw-counter">
      {cell('CLAIMED', <b>{shape.claimed} / {shape.lineupSize}</b>)}
      {cell('WALKING IN', <b>{shape.walkingClaimed} / {shape.activeSlots}</b>)}
      {cell('OPEN WALK-IN SLOTS', <b className="cw-sport">{Math.max(0, shape.activeSlots - shape.walkingClaimed)}</b>)}
      {cell('FLOOR', <b className="cw-money">{priced ? usdLabel(shape.floorUsdMicros!) : '—'}</b>, <small>{floorNote}</small>)}
      {/* The season and the days left are two figures, so they are two cells.
          One cell reading "SEASON 07 · ENDS IN 4d" strung them on a dot. */}
      {cell('SEASON', <b>{label ?? '—'}</b>)}
      {cell('DAYS LEFT', <b>{remaining === null ? '—' : remaining}</b>)}
    </div>
  )
}

function ExplainCells({ shape, miawPrixHref }: { shape: CatwalkBoardShape; miawPrixHref: string }) {
  return (
    <div className="cw-explain-cells">
      <div>
        <small>A TEAM IS A COIN</small>
        <p>Its mint is its identity. One coin holds one slot, however many ways it qualifies.</p>
      </div>
      <div>
        <small>THREE WAYS IN</small>
        {/* The row chips' legend is taught once, here, in the lane colours
            themselves - and never repeated beside the chips. These three
            colours are the only colours a row ever wears. */}
        <p>
          Buy it (<b data-lane="outbid">OUTBID</b>). Win it (<b data-lane="champion">CHAMPION</b> — top 3 by season wins).
          Climb it (<b data-lane="ranked">RANKED</b>).
        </p>
      </div>
      <div>
        <small>{shape.activeSlots} WALK IN, {shape.lineupSize} ON THE BOARD</small>
        {/* The challenge sentence is dropped, not emptied, when the board has
            no challenge band: at activeSlots === lineupSize it read "13–12 are
            qualified and waiting", an inverted range describing nobody. */}
        <p>
          Slots {pad(1)}–{pad(shape.activeSlots)} walk every MIAW PRIX rotation.
          {shape.lineupSize > shape.activeSlots
            ? ` ${pad(shape.activeSlots + 1)}–${shape.lineupSize} walk them in turn, and take a slot by walking one down — below ${shape.activeSlots} is one rotation away, not a bench.`
            : ' Every coin on the board walks in.'}
        </p>
      </div>
      <a className="cw-explain-link" href={miawPrixHref}>
        <small>WHAT IS MIAW PRIX</small>
        <p>The season this board walks in.</p>
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </div>
  )
}

const EXPLAIN_KEY = 'catwalk.explain'

/** Band meaning is never duplicated here: it lives in the band heads, adjacent
 *  to the rows they cover. */
export function CatwalkExplain({ shape, miawPrixHref }: { shape: CatwalkBoardShape; miawPrixHref: string }) {
  const narrow = useMediaQuery('(max-width: 470px)')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try { setOpen(window.localStorage.getItem(EXPLAIN_KEY) === 'open') } catch { /* private mode */ }
  }, [])
  if (!narrow) return <div className="cw-explain">{<ExplainCells shape={shape} miawPrixHref={miawPrixHref} />}</div>
  return (
    <details
      className="cw-explain cw-explain--fold"
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open
        setOpen(next)
        try { window.localStorage.setItem(EXPLAIN_KEY, next ? 'open' : 'shut') } catch { /* private mode */ }
      }}
    >
      <summary>HOW THE BOARD WORKS</summary>
      <ExplainCells shape={shape} miawPrixHref={miawPrixHref} />
    </details>
  )
}
