import { ArrowUpRight, Copy, Crown, ExternalLink, Lock, Plus } from 'lucide-react'
import { useState, type CSSProperties, type MouseEvent } from 'react'
import { TeamMark } from '../home/HomePrimitives'
import { explorerAddressUrl, marketCapLabel, usdLabel } from '../solz/catwalkSource'
import type { ExplorerVenue } from '../../../packages/adapters/explorer'
import { bandInvitation, bandSpoken, pad, type CatwalkLadderSeat, type CatwalkRow, type LadderState } from './catwalkBands'

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

export type CatwalkMetric = 'rotation' | 'record' | 'take' | 'lane' | 'wins'

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
  /** FILTER THE BOARD IN PLACE, rather than reloading the page it is on.
   *  Optional with no default: a row rendered without it keeps the anchor's own
   *  navigation, which is what every render test in this repo exercises. */
  onCoin?: (mint: string) => void
  /** The chain to build a contract-address link against. Absent means no link
   *  is drawn at all - the address is still copyable, because copying the
   *  verbatim mint cannot send anybody to the wrong chain. */
  explorer?: ExplorerVenue | null
  /**
   * TAKE THE SEAT THIS ROW'S COIN IS STANDING ON.
   *
   * The same handler the OUTBID tab's own rows call, taking the same
   * `CatwalkLadderSeat` - `row.offer` IS one - so the runway and the ladder open
   * the identical claim dialog for the identical seat rather than each having
   * their own idea of what outbidding means.
   *
   * Typed here rather than imported as `ClaimHandler`: CatwalkLadder already
   * imports from this file, and importing back would close the cycle.
   *
   * Absent means the viewer cannot claim right now (no wallet, sale shut), and
   * `claimReason` is why - the button renders DISABLED and says so, which is the
   * one thing a hidden button cannot do.
   */
  onClaim?: (seat: CatwalkLadderSeat) => void
  claimReason?: string
}

/** HEAD AND TAIL, FOR DISPLAY ONLY, AND AUTHORED ONCE. Every copy control on
 *  this page writes the mint it was handed as a PROP, never the text on screen,
 *  so the abbreviated form is structurally uncopyable. Exported because the
 *  ranked rail needs the same fallback name plate - two copies of a truncation
 *  rule is how head-and-tail quietly becomes something else. */
export const shortMint = (mint: string) => (mint.length > 9 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint)

/**
 * A PLAIN LEFT CLICK ON A SAME-PAGE COIN LINK IS A FILTER, not a navigation.
 *
 * Every `cw-symbol` anchor on this page points at `/catwalk?q=<mint>` - the
 * page the reader is already on - so following it hard-reloaded the document
 * just to run a search. `onCoin` runs that search in place instead.
 *
 * ANYTHING THAT IS NOT A PLAIN LEFT CLICK IS THE READER ASKING THE BROWSER FOR
 * SOMETHING, and the browser must be left to give it to them: cmd/ctrl-click
 * opens a tab, shift-click a window, alt-click downloads. React does not fire
 * `onClick` for a middle click at all - that is `auxclick` - so middle-click
 * keeps the native anchor behaviour without a line of code here.
 *
 * With `onCoin` absent the helper does nothing at all and the anchor navigates
 * exactly as it always did, which is how every render test in this repo calls
 * these components.
 */
export const pickCoin = (onCoin: ((mint: string) => void) | undefined, mint: string) =>
  (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
    if (!onCoin) return
    if (event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onCoin(mint)
  }

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
 * A LANE'S OWN STATE, SAID BESIDE THE TABLE RATHER THAN INSTEAD OF IT.
 *
 * This used to be a centred card with a headline over a large dashed box, and
 * it REPLACED the board: the SOLZ RANKED tab with nothing in it rendered
 * "NOBODY HAS CLIMBED IN YET" and no numbered positions at all, which is the
 * screen the owner rejected. An empty lane is a fact about the lane, not the
 * disappearance of the board, so it is a slim banner and the numbered positions
 * render alongside it exactly as on every other tab.
 *
 * IT LIVES HERE, WITH THE BAND HEAD AND THE WALK LINE, rather than inside
 * CatwalkApp where it was authored. Three rails and the app's own board-level
 * failure state all render one, and a component this file's siblings import
 * cannot live in the file that imports them - that is an import cycle, and the
 * first symptom of one here would be an undefined component at render time.
 */
export function LaneNote({ title, body, cta, lane }: {
  title: string; body: string; cta?: { label: string; href: string }; lane: string
}) {
  return (
    <div className="cw-lane-note" data-lane={lane}>
      <strong>{title}</strong>
      <p>{body}</p>
      {cta ? <a className="cw-act" href={cta.href}>{cta.label}<ArrowUpRight size={12} aria-hidden="true" /></a> : null}
    </div>
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
        {/* BOTH FORMS, ONE CHOSEN BY WIDTH. The row is full-page wide and had
            room for the whole address all along, so a desktop reader now gets
            the verbatim mint rather than head-and-tail - they came here to
            check an address against one they already hold, and four characters
            of base58 at each end is not a check. The short form is kept for
            phones, where the full one would break the column.
            Both are hidden from assistive technology: the button's own
            aria-label already carries the whole mint, once. */}
        <code className="cw-mint-full" aria-hidden="true">{mint}</code>
        <code className="cw-mint-short" aria-hidden="true">{shortMint(mint)}</code>
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
 * runway are interchangeable: a line-up whose caps are all of one size can
 * rotate freely, and one with an outlier cannot. Unknown renders as an
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
    return `Slot ${row.spot}, ${band}, open, ${row.walks ? 'walks every rotation' : 'walks the runway in turn'}`
  }
  const block = saleBlock(row, ladder)
  const ask = row.offer?.askUsdMicros ?? 0
  // No cached identity yet is still a coin: it is spoken by its short address,
  // the same string the row prints, and never as a blank or an invented ticker.
  const symbol = row.entry?.team?.symbol ?? (row.entry ? shortMint(row.entry.mint) : '')
  const record = row.standing
    ? `, ${row.standing.wins} wins ${row.standing.losses} losses`
    : row.recordKnown ? ', no record this season' : ', season record unavailable'
  const cap = row.entry?.marketCapUsd ? `, market cap ${marketCapLabel(row.entry.marketCapUsd)}` : ', market cap unknown'
  // What the holder paid is the coin's own fact, so it is spoken even when the
  // ladder cannot be read and there is no ask to speak alongside it.
  const paid = row.paidUsdMicros ? `, paid ${usdLabel(row.paidUsdMicros)}` : ''
  const action = row.lane === 'outbid'
    ? block ? `, ${block.label.toLowerCase()}` : `, outbid for ${usdLabel(ask)}`
    : ', held by record'
  return `Slot ${row.spot}, ${band}, ${symbol}, ${row.lane} lane${record}${cap}${paid}${action}`
}

/**
 * WHERE THIS POSITION STANDS IN THE ROTATION, which is the board's own subject.
 *
 * Not a round number. The line-up is one band and the wire carries no rotation
 * order, so a numbered round here would publish an order nobody had read. Walks
 * in, or waits its turn - that is the whole of what is known.
 */
const RotationCell = ({ walks }: { walks: boolean }) => (
  <span className="cw-metric">
    <small>ROTATION</small>
    <b>{walks ? 'WALKS IN' : 'IN TURN'}</b>
  </span>
)

function Metric({ row, metric, ladder }: { row: CatwalkRow; metric: CatwalkMetric; ladder: LadderState }) {
  if (row.lane === 'open') {
    // The column holds what IS known about a vacancy: where it stands in the
    // rotation. It used to hold a floor price copied off the ladder seat with
    // the same number, which was some other coin's seat.
    return <RotationCell walks={row.walks} />
  }

  /**
   * THE BOARD DOES NOT REPORT A SEASON RECORD ANY MORE.
   *
   * A W-L column stood here on every row, and it was the wrong page's fact: the
   * record is MIAW PRIX's, it is reported in full on the MIAW PRIX standings
   * table, and a second copy on CATWALK could only ever be the same number in a
   * narrower column or - whenever the standings read failed - an em dash beside
   * thirty-six others. CATWALK is about the CHANGE-UP: who stands where, how
   * they got there, and what it costs to take it from them. So the column that
   * used to carry a record now carries the position's place in the rotation,
   * which is the thing this board is actually for.
   *
   * `recordLabel` is deliberately still here: `slotLabel` speaks the record in
   * the row's aria-label, where it costs no width and tells a screen-reader user
   * something the visible row no longer says.
   */
  if (metric === 'rotation') return <RotationCell walks={row.walks} />

  const block = saleBlock(row, ladder)
  const ask = row.offer?.askUsdMicros ?? 0
  if (metric === 'take') {
    return (
      <span className="cw-metric">
        <small title={block?.title}>{block ? block.short : 'TO TAKE'}</small>
        <b className="cw-money">{block ? '—' : usdLabel(ask)}</b>
        {/* The holder's own price, off the holder's own entry. Reading it from a
            ladder seat with the same number printed whatever the coin standing
            at that ladder position had paid. A holder is a price and whoever
            stands here; the board draws no distinction beyond that. */}
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
function CoinIdentity({ row, coinHref, explorer, onCoin }: {
  row: CatwalkRow
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
  onCoin?: (mint: string) => void
}) {
  const team = row.entry?.team ?? null
  const mint = row.entry?.mint ?? ''
  // A coin whose identity has not been cached yet is NOT an unknown quantity:
  // its contract address is the one thing always known about it. An em dash
  // here drew a held seat as a blank cell, and inventing a ticker would be
  // worse. The short address is the honest name plate.
  const symbol = team?.symbol ?? (mint ? shortMint(mint) : '—')
  const href = mint && coinHref ? coinHref(mint) : undefined
  return (
    <span className="cw-id">
      <span className="cw-id-head">
        {href
          ? <a className="cw-symbol" href={href} onClick={pickCoin(onCoin, mint)}>{symbol}</a>
          : <b className="cw-symbol">{symbol}</b>}
        {team?.name && team.name !== symbol ? <small className="cw-coin-name">{team.name}</small> : null}
      </span>
      {mint ? <MintButton mint={mint} explorer={explorer} /> : null}
    </span>
  )
}

export function CatwalkSlotRow({
  row, metric, state, dim, matched, ladder = 'unknown', crown, onLadder, coinHref, explorer, onCoin,
  onClaim, claimReason,
}: RowProps) {
  const ask = row.offer?.askUsdMicros ?? 0
  const team = row.entry?.team ?? null
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
        <CoinIdentity row={row} coinHref={coinHref} explorer={explorer} onCoin={onCoin} />
        <MarketCap usd={row.entry?.marketCapUsd ?? null} />
        <LaneChip lane={row.lane} />
        <span className="cw-metric"><small>HELD IN</small><b>{row.lane === 'champion' ? 'CHAMPION' : row.lane.toUpperCase()}</b></span>
        <span className="cw-act cw-act--ghostly" title="This position is taken, just not through this lane.">TAKEN</span>
      </li>
    )
  }

  /* THE ROW ITSELF IS NOT A CONTROL. It used to take a click anywhere on it and
     run a search for that coin, which made a twelve-row table into twelve
     invisible buttons: there was no affordance saying so, the whole row lit up
     under the cursor, and a reader reaching for the contract address or the
     explorer link got a filter they never asked for. The row now holds ITS
     controls and is not one - the symbol anchor still runs the search, the mint
     still copies, the explorer link still opens, and the action column on the
     right is the only thing that acts on the position.

     (It called `window.location.assign(coinHref(mint))` before that, and
     `coinHref` resolves to `/catwalk?q=<mint>` - the page the reader is already
     on - so pressing any row reloaded the whole document to run a filter.
     `<li>` is not a link and never was, so nothing about middle-click or
     cmd-click is lost here; the symbol anchor keeps both.) */
  return (
    <li
      className={`cw-slot${open ? ' cw-slot--open' : ''}`}
      data-lane={row.lane}
      data-walks={row.walks}
      data-dim={dim ? 'true' : undefined}
      data-matched={matched ? 'true' : undefined}
      style={team?.color ? ({ '--team-color': team.color } as CSSProperties) : undefined}
      aria-label={rowLabel(row, ladder)}
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
        : <CoinIdentity row={row} coinHref={coinHref} explorer={explorer} onCoin={onCoin} />}

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
            /* A SEAT THAT CAN BE TAKEN GETS A BUTTON HERE, NOT A PRICE TAG. The
               runway used to state `SEAT 03 · $6` as dead text and leave the
               reader to find the OUTBID tab themselves, which put the one
               action this lane exists for two navigations away from the row
               that names it. Only the OUTBID lane gets one: champion and ranked
               positions are earned, and no price reaches them.
               It keeps its words - `OUTBID $6` - because the price IS the
               action here, and it names the seat in its title rather than in
               the label, which has one line to say what pressing it does.
               With no `onLadder` there is nowhere to send anybody, so the row
               falls back to stating the seat exactly as it did before. */
            : <button
                type="button"
                className="cw-act"
                disabled={!onClaim}
                /* THE SEAT NUMBER SURVIVES THE REWRITE. The label is the action
                   and its price, so the ladder seat this coin stands on moved
                   into the title - it must still be stated, and in the page's
                   own `SEAT 03` idiom, because it is how this row and the OUTBID
                   tab refer to the same thing. A disabled button says WHY here,
                   which is the one thing hiding the control cannot do. */
                title={onClaim
                  ? `SEAT ${pad(row.offer!.seat)} — take it for ${usdLabel(ask)}.`
                  : `SEAT ${pad(row.offer!.seat)} — ${claimReason ?? 'it cannot be taken right now.'}`}
                onClick={() => onClaim?.(row.offer!)}
              >
                OUTBID {usdLabel(ask)}
              </button>
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
export function CatwalkBandHead({ label, range, note, lane, walks }: {
  label: string; range?: string; note: string
  /** Set only on a head that names a LANE, so it takes that lane's colour - the
   *  same colour the lane's chips and its tab carry. */
  lane?: string
  /** True on the head of the band that walks every rotation. THE WALK-IN BAND
   *  IS COLOURED WHETHER OR NOT ANYBODY IS STANDING IN IT: those twelve
   *  positions are the product, and a board that launches empty drew them in
   *  exactly the grey it drew the twenty-four challenge vacancies in, so the
   *  thing the page is about was the least visible thing on it. */
  walks?: boolean
}) {
  return (
    <h3 className="cw-band-head" data-lane={lane} data-walks={walks ? 'true' : undefined} aria-hidden="true">
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
