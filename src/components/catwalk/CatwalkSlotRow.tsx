import { Copy, Crown, ExternalLink, Lock, Plus } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { TeamMark } from '../home/HomePrimitives'
import { explorerAddressUrl, marketCapLabel, usdLabel } from '../solz/catwalkSource'
import type { ExplorerVenue } from '../../../packages/adapters/explorer'
import { bandInvitation, bandSpoken, pad, type CatwalkRow, type LadderState } from './catwalkBands'

/**
 * One row of the CATWALK table, authored once.
 *
 * A vacancy is not a second component and not a greyed ghost of a real row: it
 * is the same row on the same column grid in a different `state`, so the list
 * never reflows and never looks half-built. Filled, open, other and skeleton
 * are the four states; there are no filled-vs-empty twins and no per-tab
 * copies.
 *
 * EVERY NUMBERED POSITION RENDERS AS A ROW. A stretch of vacancies used to
 * collapse into a summary strip of number chips above a SHOW ALL control, which
 * on a board with nothing on it - the state this board launches in - hid most
 * of its own structure behind a count. The board is thirty-six positions and it
 * draws thirty-six rows.
 *
 * COLOUR FOLLOWS THE LANE, NEVER THE POSITION. A row is tinted by HOW its coin
 * got here - OUTBID, CHAMPION, RANKED - and that lane is the same colour
 * everywhere on the page, in the band heads and the tab row included. Position
 * is carried by the number chip and the band the row sits in, never by hue. The
 * board used to paint four position tiers in four hues, which taught a colour
 * language that said nothing about how a coin arrived.
 *
 * A ROW NEVER CARRIES A PRICE FOR A VACANCY. What a board position costs is not
 * a question with an answer: positions are numbered 1..N in lane-priority order
 * and the sale is a separate, separately numbered ladder. A held row may show
 * what it costs to TAKE IT from its holder, because that seat is resolved by the
 * holder's own mint. See CatwalkLadder.tsx for the list of things on sale.
 */

export type CatwalkMetric = 'record' | 'take' | 'lane' | 'wins'

/** Every state a numbered position can be rendered in.
 *
 *  'other' exists so a lane tab can show the WHOLE numbered table without
 *  lying about it. On SOLZ RANKED, position 4 may be held by a coin that
 *  outbid for it: it is not in this lane, but it is emphatically not open
 *  either, and drawing it as a vacancy would advertise a slot somebody is
 *  standing in. */
export type CatwalkRowState = 'filled' | 'open' | 'other'

export type RowProps = {
  row: CatwalkRow
  metric: CatwalkMetric
  state: CatwalkRowState
  /** Search dims non-matches rather than removing them: a slot number is
   *  identity, and a list that reads 03, 17, 31 is a new idiom to misread. */
  dim?: boolean
  matched?: boolean
  /** Open, closed or unreadable. Read ONLY for a held row's take-price; a
   *  vacancy says nothing about the ladder, because it is not on it. */
  ladder?: LadderState
  crown?: boolean
  /** Send the viewer to the ladder, where the seats actually are. Passed only
   *  for a walk-in vacancy and only when the ladder has something on sale. */
  onLadder?: () => void
  coinHref?: (mint: string) => string
  /** The chain to build a contract-address link against. Absent means no link
   *  is drawn at all - the address is still copyable, because copying the
   *  verbatim mint cannot send anybody to the wrong chain. */
  explorer?: ExplorerVenue | null
}

const shortMint = (mint: string) => (mint.length > 9 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint)

const NO_RECORD_TITLE = 'No MIAW PRIX matches recorded this season.'
/** Said when the season record could not be READ. Stating the sentence above in
 *  this case makes a claim about the coin out of a fact about the network. */
const RECORD_UNREAD_TITLE = 'The season record could not be read. This is not a statement about this coin.'

const NO_MARKET_CAP_TITLE =
  'No market cap published for this coin. That is an unread figure, not a worthless coin.'

const WALK_VACANCY_TITLE =
  'A board position is not sold by its number. Seats are bought on the spot ladder, in the OUTBID tab.'
const CHALLENGE_VACANCY_TITLE =
  'One rotation away. Challenge positions are not sold - they fill as coins qualify.'

/** A record renders from standings or not at all. `0-0` would state a result. */
function recordLabel(row: CatwalkRow) {
  if (!row.standing) return null
  return `${row.standing.wins}–${row.standing.losses}`
}

/**
 * Why a HELD row's take-price cannot be shown, or null when it can be.
 *
 * Three absences the board used to render as one sentence: the ladder could not
 * be read, the sale is shut, and this coin's seat is not on the ladder at all.
 * Only ever asked about a row a coin is standing in - a vacancy is not on the
 * ladder by construction, so asking it this question invented an answer.
 */
type SaleBlock = { short: string; label: string; title: string }

export function saleBlock(row: CatwalkRow, ladder: LadderState): SaleBlock | null {
  if (ladder === 'unknown') return {
    short: 'UNAVAILABLE',
    label: 'PRICE UNAVAILABLE',
    title: 'The spot ladder could not be read just now. That is not the same as a closed sale.',
  }
  if (ladder === 'closed') return {
    short: 'SALE CLOSED',
    label: 'SALE CLOSED',
    title: 'The spot ladder is closed between seasons.',
  }
  if (!row.offer) return {
    short: 'NOT FOR SALE',
    label: 'NOT FOR SALE',
    // Not "does not hold a seat": the row's offer is bounded by what the ladder
    // PUBLISHES, so a coin sitting on a seat past the outbid quota lands here
    // too - and that seat genuinely cannot be taken on the OUTBID tab.
    title: 'The spot ladder publishes no seat for this coin, so there is nothing to outbid.',
  }
  if (row.offer.askUsdMicros <= 0) return {
    short: 'NO ASK',
    label: 'NO ASK PUBLISHED',
    title: 'This seat is on the ladder but carries no published ask.',
  }
  return null
}

/** The line under OPEN SLOT. It describes the POSITION - what walking in means,
 *  or how far off it is - and never the sale, because a position is not the
 *  thing being sold. */
const openNote = (row: CatwalkRow) => bandInvitation(row.band)

export function LaneChip({ lane }: { lane: CatwalkRow['lane'] }) {
  const label = lane === 'outbid' ? 'OUTBID' : lane === 'champion' ? 'CHAMP' : lane === 'ranked' ? 'RANKED' : 'OPEN'
  return (
    <span className="cw-lane" data-lane={lane}>
      {lane === 'champion' ? <Crown size={10} aria-hidden="true" /> : null}
      {label}
    </span>
  )
}

/**
 * THE CONTRACT ADDRESS, copyable and linkable.
 *
 * Two controls rather than one, because they answer two different questions: a
 * holder wants the address ON THE CLIPBOARD, verbatim and unabbreviated, and a
 * stranger wants to LOOK AT IT. The copy carries the full mint, never the
 * head-and-tail form on screen, so what is pasted is what the board was given.
 *
 * The explorer link is drawn only when the board named a chain to build it
 * against. A link to the wrong cluster resolves to "account not found", which a
 * reader takes as a statement about the coin.
 */
export function MintButton({ mint, explorer }: { mint: string; explorer?: ExplorerVenue | null }) {
  const [copied, setCopied] = useState(false)
  const href = explorerAddressUrl(explorer, mint)
  return (
    <span className="cw-ca">
      <button
        type="button"
        className="cw-mint"
        aria-label={copied ? 'Contract address copied' : `Copy contract address ${mint}`}
        title={copied ? 'Copied' : 'Copy contract address'}
        onClick={(event) => {
          event.stopPropagation()
          try {
            void navigator.clipboard?.writeText(mint).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1_600)
            })
          } catch { /* a clipboard the browser refuses is not worth an error state */ }
        }}
      >
        <code>{shortMint(mint)}</code>
        <Copy size={10} aria-hidden="true" />
      </button>
      {href
        ? <a
            className="cw-ca-link"
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`View contract ${mint} in the block explorer`}
            title="View the contract in the block explorer"
            onClick={(event) => event.stopPropagation()}
          >
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        : null}
    </span>
  )
}

/**
 * MARKET CAP.
 *
 * On the board because it is how a reader tells whether the coins below the
 * walk-in band are interchangeable: a challenge band whose caps are all of one
 * size can rotate freely, and one with an outlier cannot. Unknown renders as an
 * em dash carrying its reason - never as $0, which says the coin is worthless
 * when in fact nobody published a figure.
 */
export function MarketCap({ usd }: { usd: number | null }) {
  return (
    <span className="cw-mcap">
      <small>MKT CAP</small>
      {usd === null
        ? <b className="cw-unknown" title={NO_MARKET_CAP_TITLE}>—</b>
        : <b>{marketCapLabel(usd)}</b>}
    </span>
  )
}

/** The spoken form of a row, because band heads are hidden from screen readers
 *  and a reader should not have to remember which band it is inside. */
function rowLabel(row: CatwalkRow, ladder: LadderState) {
  const band = bandSpoken(row.band)
  if (row.lane === 'open') {
    // No price and no ladder verdict: neither is a fact about this position.
    return `Slot ${row.spot}, ${band}, open, ${row.walks ? 'walks every rotation' : `walks the walk-in band in round ${row.band.round}`}`
  }
  const block = saleBlock(row, ladder)
  const ask = row.offer?.askUsdMicros ?? 0
  const symbol = row.entry?.team?.symbol ?? row.entry?.mint ?? ''
  const record = row.standing
    ? `, ${row.standing.wins} wins ${row.standing.losses} losses`
    : row.recordKnown ? ', no record this season' : ', season record unavailable'
  const cap = row.entry?.marketCapUsd ? `, market cap ${marketCapLabel(row.entry.marketCapUsd)}` : ', market cap unknown'
  // What the holder paid is the coin's own fact, so it is spoken even when the
  // ladder cannot be read and there is no ask to speak alongside it.
  // Seeded and bought holders are spoken identically: at launch the board IS
  // the initial teams, and the owner's call is that it presents them as held
  // seats. `row.seeded` is deliberately not read here - see `seeded` on
  // CatwalkRow in catwalkBands.ts.
  const paid = row.paidUsdMicros ? `, paid ${usdLabel(row.paidUsdMicros)}` : ''
  const action = row.lane === 'outbid'
    ? block ? `, ${block.label.toLowerCase()}` : `, outbid for ${usdLabel(ask)}`
    : ', held by record'
  return `Slot ${row.spot}, ${band}, ${symbol}, ${row.lane} lane${record}${cap}${paid}${action}`
}

function Metric({ row, metric, ladder }: { row: CatwalkRow; metric: CatwalkMetric; ladder: LadderState }) {
  if (row.lane === 'open') {
    // The column holds what IS known about a vacancy: where it stands in the
    // rotation. It used to hold a floor price copied off the ladder seat with
    // the same number, which was some other coin's seat.
    return (
      <span className="cw-metric">
        <small>ROTATION</small>
        <b>{row.walks ? 'WALKS IN' : `ROUND ${row.band.round}`}</b>
      </span>
    )
  }

  const block = saleBlock(row, ladder)
  const ask = row.offer?.askUsdMicros ?? 0
  if (metric === 'take') {
    return (
      <span className="cw-metric">
        <small title={block?.title}>{block ? block.short : 'TO TAKE'}</small>
        <b className="cw-money">{block ? '—' : usdLabel(ask)}</b>
        {/* The holder's own price, off the holder's own entry. Reading it from a
            ladder seat with the same number printed whatever the coin standing
            at that ladder position had paid.

            A seeded holder renders exactly like a bought one, by the owner's
            decision: the launch board is the initial teams, and an outbid takes
            a seat over when a real payment arrives. The `seeded` flag survives
            in the data and in the admin panel at :3101, which still shows
            "seeded — not a payment" so an operator can tell which rows still
            want a signature. It is not a public label. */}
        {row.paidUsdMicros ? <small>PAID {usdLabel(row.paidUsdMicros)}</small> : null}
      </span>
    )
  }
  if (metric === 'lane') {
    // Never a ladder rank: no parsed payload carries one, so a number here
    // would be invented. Lane membership is the whole claim being made.
    return <span className="cw-metric"><small>LANE</small><b>RANKED</b></span>
  }
  if (metric === 'wins') {
    const standing = row.standing
    return (
      <span className="cw-metric">
        <small>WINS</small>
        {standing
          ? <b className="cw-sport">{standing.wins} W</b>
          : <b title={row.recordKnown ? NO_RECORD_TITLE : RECORD_UNREAD_TITLE}>—</b>}
        {standing ? <small>{standing.matches} WALKS</small> : null}
      </span>
    )
  }
  const record = recordLabel(row)
  return (
    <span className="cw-metric">
      <small>RECORD</small>
      {record ? <b>{record}</b> : <b title={row.recordKnown ? NO_RECORD_TITLE : RECORD_UNREAD_TITLE}>—</b>}
    </span>
  )
}

/** The action column of a vacancy. Never a price and never a CLAIM P07: buying
 *  P07 is not a thing that can be done. A walk-in vacancy points at the ladder
 *  when the ladder has seats; otherwise it states how the position fills. */
function VacancyAction({ row, onLadder, className }: { row: CatwalkRow; onLadder?: () => void; className: string }) {
  const toLadder = row.walks ? onLadder : undefined
  if (toLadder) {
    return (
      <button
        type="button"
        className={`${className} cw-act--claim`}
        title={WALK_VACANCY_TITLE}
        onClick={(event) => { event.stopPropagation(); toLadder() }}
      >
        TAKE A SEAT
      </button>
    )
  }
  return (
    <span className={`${className} cw-act--ghostly`} title={row.walks ? WALK_VACANCY_TITLE : CHALLENGE_VACANCY_TITLE}>
      {row.walks ? 'FILLS FROM THE LANES' : 'OPEN TO CHALLENGERS'}
    </span>
  )
}

/** The coin's own name plate: a crest-sized symbol that links to the coin, the
 *  full name beneath it, and the contract address with its copy and explorer
 *  controls. Every one of these is identity, so none of them is optional when
 *  the wire carried it. */
function CoinIdentity({ row, coinHref, explorer }: {
  row: CatwalkRow; coinHref?: (mint: string) => string; explorer?: ExplorerVenue | null
}) {
  const team = row.entry?.team ?? null
  const mint = row.entry?.mint ?? ''
  const symbol = team?.symbol ?? '—'
  const href = mint && coinHref ? coinHref(mint) : undefined
  return (
    <span className="cw-id">
      <span className="cw-id-head">
        {href
          ? <a className="cw-symbol" href={href} onClick={(event) => event.stopPropagation()}>{symbol}</a>
          : <b className="cw-symbol">{symbol}</b>}
        {team?.name && team.name !== symbol ? <small className="cw-coin-name">{team.name}</small> : null}
      </span>
      {mint ? <MintButton mint={mint} explorer={explorer} /> : null}
    </span>
  )
}

export function CatwalkSlotRow({
  row, metric, state, dim, matched, ladder = 'unknown', crown, onLadder, coinHref, explorer,
}: RowProps) {
  const ask = row.offer?.askUsdMicros ?? 0
  const team = row.entry?.team ?? null
  const href = row.entry && coinHref ? coinHref(row.entry.mint) : undefined
  const open = row.lane === 'open'
  const block = open ? null : saleBlock(row, ladder)

  // A position held by a coin that is NOT in the lane being looked at. It keeps
  // its number, its crest and its market cap - it is the same position - and
  // states plainly which lane holds it. What it must never do is render as a
  // vacancy, which would advertise a slot somebody is standing in.
  if (state === 'other' && !open) {
    return (
      <li
        className="cw-slot cw-slot--other"
        data-lane={row.lane}
        data-walks={row.walks}
        data-dim={dim ? 'true' : undefined}
        data-matched={matched ? 'true' : undefined}
        aria-label={`Slot ${row.spot}, ${bandSpoken(row.band)}, held in the ${row.lane} lane`}
      >
        <span className="cw-num">{pad(row.spot)}</span>
        <TeamMark id={team?.id ?? row.entry?.mint ?? ''} color={team?.color} logoUrl={team?.logoUrl} className="cw-crest" />
        <CoinIdentity row={row} coinHref={coinHref} explorer={explorer} />
        <MarketCap usd={row.entry?.marketCapUsd ?? null} />
        <LaneChip lane={row.lane} />
        <span className="cw-metric"><small>HELD IN</small><b>{row.lane === 'champion' ? 'CHAMPION' : row.lane.toUpperCase()}</b></span>
        <span className="cw-act cw-act--ghostly" title="This position is taken, just not through this lane.">TAKEN</span>
      </li>
    )
  }

  return (
    <li
      className={`cw-slot${open ? ' cw-slot--open' : ''}`}
      data-lane={row.lane}
      data-walks={row.walks}
      data-dim={dim ? 'true' : undefined}
      data-matched={matched ? 'true' : undefined}
      style={team?.color ? ({ '--team-color': team.color } as CSSProperties) : undefined}
      aria-label={rowLabel(row, ladder)}
      onClick={href ? () => window.location.assign(href) : undefined}
    >
      {crown ? <Crown className="cw-row-crown" size={14} aria-hidden="true" /> : null}
      <span className="cw-num">{pad(row.spot)}</span>

      {open
        ? <span className="cw-open-well" aria-hidden="true"><Plus size={16} /></span>
        : <TeamMark id={team?.id ?? row.entry?.mint ?? ''} color={team?.color} logoUrl={team?.logoUrl} className="cw-crest" />}

      {open
        ? <span className="cw-id">
            <b className="cw-open-title">OPEN SLOT</b>
            <small>{openNote(row)}</small>
          </span>
        : <CoinIdentity row={row} coinHref={coinHref} explorer={explorer} />}

      {/* A vacancy has no market cap because it has no coin - and the column
          still holds its box, so the table does not reflow row to row. */}
      {open
        ? <span className="cw-mcap cw-mcap--empty" aria-hidden="true"><small>MKT CAP</small><b>—</b></span>
        : <MarketCap usd={row.entry?.marketCapUsd ?? null} />}

      <LaneChip lane={row.lane} />

      <Metric row={row} metric={metric} ladder={ladder} />

      {open
        ? <VacancyAction row={row} onLadder={onLadder} className="cw-act" />
        : row.lane === 'outbid'
          ? block
            ? <span className="cw-act cw-act--closed" title={block.title}>{block.label}</span>
            : <span className="cw-act cw-act--ghostly" title={`This coin holds ladder seat ${pad(row.offer!.seat)}. Take it on the OUTBID tab for ${usdLabel(ask)}.`}>
                <i>SEAT {pad(row.offer!.seat)}</i>
                <b>{usdLabel(ask)}</b>
              </span>
          : <span className="cw-act cw-act--locked" title="Champion and ranked slots are earned, not bought.">
              <Lock size={12} aria-hidden="true" />HELD BY RECORD
            </span>}
    </li>
  )
}

/**
 * A row before anything has been read.
 *
 * It holds the exact box its row will occupy and states NOTHING: not that the
 * slot is vacant, not who is in it, not what it costs, not whether the ladder
 * answered. The number is structure - the board is 1..lineupSize whatever lands
 * - and everything that depends on a read shimmers. The list is drawn
 * uncollapsed because collapsing a run of vacancies is itself a count of them.
 */
export function CatwalkSlotSkeleton({ spot }: { spot: number }) {
  return (
    <li className="cw-slot cw-slot--skeleton" aria-hidden="true">
      <span className="cw-num">{pad(spot)}</span>
      <i className="cw-pending cw-pending--crest" />
      <span className="cw-id">
        <i className="cw-pending cw-pending--title" />
        <i className="cw-pending cw-pending--word" />
      </span>
      <i className="cw-pending cw-pending--mcap" />
      <i className="cw-pending cw-pending--lane" />
      <i className="cw-pending cw-pending--metric" />
      <i className="cw-pending cw-pending--act" />
    </li>
  )
}

/** Hidden from assistive technology on purpose: every row already names its own
 *  band, and a head repeated above twelve rows would be read twelve times. */
export function CatwalkBandHead({ label, range, note, lane }: {
  label: string; range?: string; note: string
  /** Set only on a head that names a LANE, so it takes that lane's colour - the
   *  same colour the lane's chips and its tab carry. A head that names a band
   *  of the rotation takes no colour at all, because position is not a hue. */
  lane?: string
}) {
  return (
    <h3 className="cw-band-head" data-lane={lane} aria-hidden="true">
      <span>{label}</span>
      <em>{range}</em>
      <small>{note}</small>
    </h3>
  )
}

/** The line between the coins that walk every rotation and the coins one
 *  rotation away from it. */
export function CatwalkWalkLine({ activeSlots }: { activeSlots: number }) {
  return (
    <div className="cw-walkline" aria-hidden="true">
      <span>TOP {activeSlots} WALK IN EVERY ROTATION</span>
    </div>
  )
}
