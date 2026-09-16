import { TeamMark } from '../home/HomePrimitives'
import type { CatwalkRankedLaneRead, CatwalkRankedProjectRow } from '../solz/catwalkSource'
import type { ExplorerVenue } from '../../../packages/adapters/explorer'
import type { CatwalkBoardShape } from './catwalkBands'
import { DASH } from './CatwalkComposition'
import { matchedSpots, parseCatwalkQuery, tabRows } from './catwalkQuery'
import { LaneNote, MintButton, pickCoin, shortMint } from './CatwalkSlotRow'

/**
 * WHAT THE SOLZ RANKED LANE IS - the right-hand rail of the SOLZ RANKED tab.
 *
 * Clicking the tab changes THIS and nothing else. The board on the left does not
 * re-filter, does not re-group and does not lose a row: a lane is a way of
 * ARRIVING at a position, not a smaller board, and the screen the owner rejected
 * was the one where choosing a lane replaced thirty-six numbered positions with
 * a single centred card.
 *
 * THREE STATES, AND THEY STAY THREE. "Nobody has climbed in yet" is a fact about
 * the board. "The ranked ladder lists nobody" is a fact about the chain. "The
 * registry has not been read" is a fact about the network. They are one sentence
 * apart and a whole lie apart, exactly as LadderState, StandingsState and
 * CatwalkLock each keep theirs - so this rail never collapses them, and says
 * nothing at all about the registry when the board did not carry a read.
 *
 * AND IT IS A LADDER NOW, NOT A PARAGRAPH. This rail used to be prose, two
 * counts and a button: the tab named SOLZ RANKED had no ranked list on it
 * anywhere. The coins are here, in rank order, with the figures the chain
 * actually answers for them.
 */

/** Where the real ladder lives. It is ANOTHER SITE, which is why it is written
 *  here as an absolute URL and why both call sites below open it in a new tab -
 *  and why it is deliberately NOT the page's `rankedHref`, which defaults to
 *  this repo's own /agent-arena and still names HOW TO QUALIFY FREE elsewhere. */
const RANKED_LADDER_URL = 'https://solz.fun/leaderboard'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Why a ladder entry is not a link. Said as a fact about the BOARD, never as
 *  one about the coin: climbing the ranked ladder is how a coin ARRIVES at a
 *  position, so "not standing on the board" is the normal state of almost every
 *  row on this list. */
const NOT_ON_BOARD_TITLE = 'This coin is not standing on the board, so there is nothing on it to filter to.'

/**
 * DOES THE BOARD HOLD THIS MINT?
 *
 * Asked with the board's OWN search predicate, over the WHOLE board rather than
 * the open tab's rows, so the answer is exactly "would clicking this find
 * something". Anything looser would put a link on a row whose click empties the
 * board; anything narrower would take the link off a coin that is standing on it.
 */
export const boardHolds = (rows: readonly CatwalkBoardShape['rows'][number][], mint: string): boolean =>
  !!mint && matchedSpots(rows, parseCatwalkQuery(mint)).length > 0

/**
 * The identity file's own stamp, as a date a reader can place.
 *
 * READ IN UTC, ON PURPOSE. This rail renders on the server and again in the
 * browser, and a local-time format would print two different days either side of
 * midnight for half the planet - a hydration mismatch over a fact that is the
 * same instant in both places.
 *
 * Anything unparsable returns null and the sentence simply omits that half. A
 * guessed date on a line whose entire job is to say how stale the registry is
 * would be the one lie this line cannot afford.
 */
export function registryDate(value: string | null): string | null {
  if (!value) return null
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return null
  const when = new Date(at)
  return `${String(when.getUTCDate()).padStart(2, '0')} ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`
}

/**
 * A u64 counter, thousands-separated - AND NEVER COERCED TO A NUMBER.
 *
 * `BigInt(...).toLocaleString` groups exactly the digits it was given. `Number()`
 * on a u64 past 2^53 does not throw, it rounds, and a rounded match count looks
 * entirely plausible sitting in a column of other plausible figures.
 *
 * Null in, em dash out. Never a zero: a coin that has finalized no matches and a
 * coin whose figure did not arrive must not read the same.
 */
export function countLabel(value: string | null): string {
  if (value === null) return DASH
  try {
    return BigInt(value).toLocaleString('en')
  } catch {
    return DASH
  }
}

/**
 * BASE UNITS SCALED BY THE TOKEN'S OWN DECIMALS, with BigInt throughout.
 *
 * `poolBaseUnits` is a u128: the chain accumulates one match's total stake into
 * it per finalized match, so at six decimals it passes Number.MAX_SAFE_INTEGER
 * at roughly nine billion cumulative whole tokens - and a single large match can
 * already breach it. A Number coercion there does not fail loudly; it rounds,
 * and the column then shows a wrong figure nobody can tell from a right one.
 *
 * Null when either half is unreadable, INCLUDING an unreadable scale over
 * readable digits: base units nobody can scale are not a smaller figure, they
 * are a figure of unknown size, and printing them raw would overstate a pool by
 * a factor of a million.
 *
 * TRUNCATED, NEVER ROUNDED, because rounding up is how a pool that has not
 * reached a whole token comes to claim one. Two fraction digits are enough
 * beside a whole number - and six are kept when there is no whole number at
 * all, because truncating 0.0015 to two digits prints `0`, which is a claim
 * that nothing has been staked.
 */
export function formatBaseUnits(amount: string | null, decimals: number | null): string | null {
  if (amount === null || decimals === null) return null
  if (!/^\d+$/.test(amount) || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) return null
  const units = BigInt(amount)
  const scale = 10n ** BigInt(decimals)
  if (decimals === 0) return units.toLocaleString('en')
  const units_whole = units / scale
  const whole = units_whole.toLocaleString('en')
  const digits = units_whole === 0n ? 6 : 2
  const fraction = (units % scale).toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/**
 * ONE COIN ON THE LADDER.
 *
 * SIX CELLS ACROSS, WHICH IS THE WHOLE FIX. This row used to draw three cells
 * and pin all three FIGURES to grid track 3, so auto-placement stacked them
 * down the right-hand edge - "pool competed, finalized match there" one under
 * the other, which is not a table. There is one track per figure now and the
 * labels live in a header row above the list; each figure keeps its own `<i>`
 * in the DOM, clipped rather than deleted, so a screen-reader user on row
 * nineteen still hears which number they are on without scrolling back to a
 * header.
 *
 * THE LAST CELL IS THE TRAP. "Pool competed" is denominated in EACH PROJECT'S
 * OWN STAKE TOKEN. It is not dollars, it is not comparable to the row above it,
 * and it does not add up down the column - so it is scaled by ITS OWN row's
 * decimals, printed against ITS OWN coin's symbol, and it never wears
 * `cw-money`, which is this page's green for a price in dollars.
 *
 * THE IDENTITY CELL IS THE BOARD'S, NOT A SECOND ONE. It wears `cw-id` as well
 * as `cw-ranked-id`, so `.cw-id-head`, `.cw-symbol`, `.cw-coin-name` and the
 * whole `.cw-ca` block resolve from the rules the board rows already have, and
 * `MintButton` is the same control the board uses. The owner asked for the
 * address here because "there can be too many similar image and name" - two
 * coins on this ladder can wear the same crest and near enough the same
 * ticker, and the mint is the only real identity either of them has.
 *
 * NOT `cw-outbid-row`: catwalk.css hides that class's own cells inside the
 * rail, and borrowing it would have hidden half of these.
 */
function RankedRow({ rank, row, explorer, coinHref, onCoin, logoFor, onBoard = false }: {
  rank: number
  row: CatwalkRankedProjectRow
  explorer?: ExplorerVenue | null
  coinHref?: (mint: string) => string
  onCoin?: (mint: string) => void
  logoFor?: (mint: string, boardLogo?: string | null) => string | undefined
  /** Whether this coin's mint actually finds something on the board. */
  onBoard?: boolean
}) {
  const pool = formatBaseUnits(row.poolBaseUnits, row.poolDecimals)
  // A coin the registry does not name is SHOWN, by its address. Curating an
  // unnamed coin out of the ladder would make the lane look shallower than the
  // chain says it is - the same argument `CoinIdentity` makes on the board.
  const symbol = row.symbol || (row.mint ? shortMint(row.mint) : DASH)
  /**
   * LINKED ONLY WHEN THE CLICK HAS SOMEWHERE TO LAND.
   *
   * Every coin link on this page runs the board's own search. This ladder is the
   * CHAIN'S whole candidate list, not the board - most coins on it hold no
   * position - so searching one of them matches nothing, and a text query with
   * an empty hit set dims all thirty-six rows to .22 while `searchOutcome`
   * reports a miss and swaps this very rail for the search card. The reader's
   * click would delete the table they clicked on and grey out the board behind
   * it, with the CLEAR button as the only way back.
   *
   * So the symbol is a link exactly when the board holds this mint. The address
   * underneath is unaffected: `MintButton` still copies the full mint and still
   * links to the explorer, which is the identity the owner asked for, and it is
   * the only identity an off-board ladder entry has on this page.
   */
  const href = row.mint && onBoard && coinHref ? coinHref(row.mint) : undefined
  return (
    <li className="cw-ranked-row" aria-label={`Rank ${rank}, ${symbol}`}>
      <span className="cw-ranked-rank">{rank}</span>
      {/* `TeamMark` falls back to a per-id mark when a logo will not load, so a
          ranked coin with no crest is a missing picture, never a broken image. */}
      <TeamMark id={row.mint} logoUrl={logoFor ? logoFor(row.mint, row.logoUrl) : row.logoUrl ?? undefined} className="cw-crest" />
      <span className="cw-id cw-ranked-id">
        <span className="cw-id-head">
          {href
            ? <a className="cw-symbol" href={href} onClick={pickCoin(onCoin, row.mint)}>{symbol}</a>
            : <b
                className="cw-symbol"
                title={row.mint && !onBoard ? NOT_ON_BOARD_TITLE : undefined}
              >{symbol}</b>}
          {row.name && row.name !== symbol ? <small className="cw-coin-name">{row.name}</small> : null}
        </span>
        {row.mint ? <MintButton mint={row.mint} explorer={explorer} /> : null}
      </span>
      {/* `display: contents` at wide width, so these three are flat grid items
          in tracks 4, 5 and 6. The wrapper exists only so the phone fold can
          move all three onto a second line at once - three across, never
          re-stacked into a column, which is the layout that was rejected. */}
      <span className="cw-ranked-figures">
        <span className="cw-ranked-figure">
          <i>FINALIZED MATCHES</i>
          <b>{countLabel(row.matches)}</b>
        </span>
        <span className="cw-ranked-figure">
          <i>PLAYER ENTRIES</i>
          <b>{countLabel(row.playerEntries)}</b>
        </span>
        <span className="cw-ranked-figure cw-ranked-pool">
          <i>POOL COMPETED</i>
          <b>{pool === null ? DASH : `${pool} ${symbol}`}</b>
        </span>
      </span>
    </li>
  )
}

/**
 * HOW DEEP THE LADDER IS, BUILT FROM THE WIRE AND NOTHING REMEMBERED.
 *
 * Two coins on a three-token registry is not a broken list, it is the chain's
 * answer: the third token has no non-native project record, so it has finalized
 * nothing. This line says that in figures rather than leaving a two-row
 * leaderboard looking like a failed read - and each half is DROPPED when its own
 * field did not arrive, rather than guessed at.
 */
function LadderDepth({ read }: { read: CatwalkRankedLaneRead }) {
  const coins = read.candidates
  const updated = registryDate(read.registryUpdatedAt)
  const registry = read.registryTokens === null
    ? ''
    : `; THE REGISTRY NAMES ${read.registryTokens}${updated ? `, LAST UPDATED ${updated}` : ''}`
  return (
    <p className="cw-ranked-depth">
      THE LADDER IS AS DEEP AS THE CHAIN IS. {coins} COIN{coins === 1 ? '' : 'S'} {coins === 1 ? 'HAS' : 'HAVE'}
      {' '}FINALIZED A RANKED MATCH ON THIS BOARD{registry}.
    </p>
  )
}

export function CatwalkRankedRail({ shape, rankedLane = null, explorer, coinHref, onCoin, logoFor }: {
  shape: CatwalkBoardShape
  rankedLane?: CatwalkRankedLaneRead | null
  /* ALL FOUR ARE OPTIONAL WITH NO DEFAULT. A rail rendered with `shape` and
     `rankedLane` alone - which is how this repo's render tests call it -
     draws exactly what it drew before: no explorer link, no coin link, no
     in-place filter and the board's own logo. */
  explorer?: ExplorerVenue | null
  coinHref?: (mint: string) => string
  onCoin?: (mint: string) => void
  /** The crest, resolved against the mint registry. `overlayTokenMeta` cannot
   *  serve the ladder - it walks `board.lineup` only - so identity is resolved
   *  per row here, the way MIAW PRIX does it. */
  logoFor?: (mint: string, boardLogo?: string | null) => string | undefined
}) {
  const standing = tabRows('ranked', shape.rows).length
  // THE LIST IS GATED ON THE READ'S STATE, NEVER ON ITS LENGTH. A registry
  // nobody has opened and one whose read failed both arrive with no rows, and
  // rendering an empty ladder for either is the exact "read it as nothing"
  // collapse this rail exists to refuse. Only 'ready' may draw a list at all.
  const ladder = rankedLane?.state === 'ready' ? rankedLane : null
  // `projects` is required on the parsed read and is always an array there. The
  // fallback is for a HOST handing this component a hand-built object: a rail
  // that throws takes the whole page down, and "no rows arrived" is a state this
  // file already knows how to render.
  const rows = ladder?.projects ?? []
  return (
    <section className="cw-legend" aria-labelledby="cw-ranked-head">
      {/* A SWATCH, NOT A `LaneChip`. The chip spells its own lane out, and beside
          a heading naming the same lane it printed the word twice. It takes its
          colour the same way - off `data-lane` resolving `--cw-hue` in
          catwalk.css - so no hex value is restated here. */}
      <h3 id="cw-ranked-head">
        <span className="cw-legend-swatch" data-lane="ranked" aria-hidden="true" />
        SOLZ RANKED
      </h3>
      <p className="cw-legend-lede">
        A coin climbs the SOLZ ranked ladder and takes a position free at season roll.
        Nothing to pay, nothing to bid — and no ask is ever published against one of
        these positions, because none of them is for sale.
      </p>

      {standing === 0
        ? <LaneNote
            lane="ranked"
            title="NOBODY HAS CLIMBED IN YET."
            body="High coins on the SOLZ ranked ladder take a slot free at season roll. Nothing to pay, nothing to bid."
            cta={{ label: 'VIEW RANKED LADDER', href: RANKED_LADDER_URL }}
          />
        : null}

      <dl className="cw-legend-stats">
        <div><dt>STANDING IN THIS LANE</dt><dd>{standing}</dd></div>
        {/* ON THE LADDER, NOT 'ON THE REGISTRY'. The wire key is still
            `candidates` and still means what it always meant - the CHAIN's count
            of non-native project records - which is not the identity file's
            token count. The old label named the wrong source for the figure
            beside it; the registry's own depth is stated in its own words below.
            The count is printed only over a 'ready' read, because a cold read
            and a failed one both carry zero and printing that states "nobody is
            queued" every time the network blinks. */}
        {ladder ? <div><dt>ON THE LADDER</dt><dd>{ladder.candidates}</dd></div> : null}
      </dl>

      {ladder ? <LadderDepth read={ladder} /> : null}

      {ladder && rows.length > 0
        ? <>
            {/* ORDER COMES OFF THE WIRE AND IS NEVER RE-SORTED HERE. Finalized
                matches DESC with a stable tie-break, decided once upstream; a
                second sort on this page would be a second opinion about a
                ranking the chain already answered. */}
            {/* THE HEADER ROW, WHICH IS WHAT MAKES THIS A TABLE. A sibling of
                the list rather than a row inside it: the `<ol>` keeps its list
                semantics, and every row still carries its own clipped label, so
                assistive technology hears "FINALIZED MATCHES 1,427" in place
                and never has to hold a header in memory. Hidden from it here
                for exactly that reason - read aloud it would be a seventh
                announcement of three words the rows already say. */}
            <div className="cw-ranked-head" aria-hidden="true">
              <span>#</span>
              <span aria-hidden="true" />
              <span>COIN</span>
              <span>FINALIZED MATCHES</span>
              <span>PLAYER ENTRIES</span>
              <span>POOL COMPETED</span>
            </div>
            <ol className="cw-ranked-list" data-lane="ranked">
              {rows.map((row, index) => (
                <RankedRow
                  key={row.mint}
                  rank={index + 1}
                  row={row}
                  explorer={explorer}
                  coinHref={coinHref}
                  onCoin={onCoin}
                  logoFor={logoFor}
                  onBoard={boardHolds(shape.rows, row.mint)}
                />
              ))}
            </ol>
            <p className="cw-ranked-foot">
              PLAYER ENTRIES COUNTS SEATS FILLED ACROSS FINALIZED MATCHES, NOT DISTINCT WALLETS.
            </p>
            <p className="cw-ranked-foot">
              POOL COMPETED IS EACH COIN&rsquo;S OWN STAKE TOKEN. IT IS NOT A DOLLAR FIGURE AND IT
              DOES NOT ADD UP DOWN THE COLUMN.
            </p>
          </>
        : null}

      <RegistryNote read={rankedLane} />

      {standing > 0
        ? <a className="cw-act" href={RANKED_LADDER_URL} target="_blank" rel="noreferrer">VIEW RANKED LADDER</a>
        : null}
    </section>
  )
}

/**
 * WHY THE REGISTRY SAYS WHAT IT SAYS, in the registry's own three words.
 *
 * The server's vocabulary is 'cold' (nothing read yet), 'unavailable' (a read
 * was tried and failed) and 'ready' (an answer). They are read verbatim and
 * never collapsed - and a FOURTH word, from a server newer than this page, is
 * not guessed at: an unrecognised state says nothing, which is the one answer
 * that cannot be wrong.
 *
 * 'ready' with candidates on it is not a note at all. The figure is in the list
 * above and a banner restating it would be the third place on this rail the same
 * number appears.
 */
function RegistryNote({ read }: { read: CatwalkRankedLaneRead | null }) {
  if (!read) return null
  if (read.state === 'cold') return (
    <LaneNote
      lane="ranked"
      title="THE RANKED REGISTRY HAS NOT BEEN READ YET."
      body="How many coins are queued to climb in is not known yet. This is not a statement about the ladder, and it is emphatically not a statement that nobody is on it."
    />
  )
  if (read.state === 'unavailable') return (
    <LaneNote
      lane="ranked"
      title="THE RANKED REGISTRY COULD NOT BE READ."
      body="The read was tried and it failed. Nothing about the ranked ladder has changed; this page retries on its own."
    />
  )
  // The one state that may say the ladder is empty - and it says it about the
  // LADDER, which is what the chain answered for, rather than about the registry
  // file, which names tokens and knows nothing about who has played.
  if (read.state === 'ready' && read.candidates === 0) return (
    <LaneNote
      lane="ranked"
      title="THE RANKED LADDER LISTS NOBODY YET."
      body="The chain answered, and no coin has finalized a ranked match on this board yet."
    />
  )
  return null
}
