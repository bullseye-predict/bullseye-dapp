import type { CatwalkLane } from '../solz/model'
import type { CatwalkRow } from './catwalkBands'

/**
 * Which rows a tab shows, and what a search string means.
 *
 * Both are pure and both obey the same rule: a filter never renumbers. A slot
 * number is absolute identity, so every tab shows rows in slot order carrying
 * their own number, and search dims rather than removes.
 */

/** 'catwalk' is the table itself - every numbered position, merged. It was
 *  called 'grid', which is a starting grid, which is a race. Nothing here
 *  races. */
export type CatwalkTab = 'catwalk' | 'outbid' | 'ranked' | 'champions' | 'agents'

export const CATWALK_TABS: CatwalkTab[] = ['catwalk', 'outbid', 'ranked', 'champions']

export const isCatwalkTab = (value: string): value is CatwalkTab =>
  (CATWALK_TABS as string[]).includes(value)

/**
 * WHERE THE TWO-COLUMN SPLIT STOPS EXISTING.
 *
 * Its own constant, matching `@media (min-width: 1280px)` in
 * src/styles/catwalk.css - the width at which the composition rail stops being
 * a column on screen and becomes 2,000 pixels of legend under the board with
 * nothing pointing at it. It is deliberately NOT `MIAW_PRIX_NARROW`, which is
 * 900px for a different layout on a different page; sharing it would have tied
 * this tab's existence to a breakpoint that has nothing to do with this grid.
 */
export const CATWALK_NARROW = '(max-width: 1279px)'

/**
 * A DESTINATION THE RAIL CAN SHOW, which is the tabs plus one.
 *
 * 'info' is the composition legend as a TAB, and it exists only below the split
 * breakpoint - above it the legend is already on screen as a column and a tab
 * pointing at it would be a lie about a place the reader is looking at.
 *
 * IT IS DELIBERATELY NOT IN `CatwalkTab` AND NOT IN `CATWALK_TABS`. Keeping it
 * out of that array is the mechanical reason `isCatwalkTab` cannot honour a
 * `?lane=info` deep link on a desktop that has no such tab, and the reason the
 * per-tab promises the board makes are unaffected by its existence.
 */
export type CatwalkPanelId = CatwalkTab | 'info'

/**
 * Which rows BELONG TO a tab's lane. This is a membership question, and it is
 * what the tab counts and the search verdict are computed from.
 *
 * It is NOT what the tab renders. Every tab renders the whole numbered table -
 * see `tabLens` - because a lane with nothing in it still has thirty-six
 * numbered positions, and a single centred card reading "NOBODY HAS CLIMBED IN
 * YET" over a dashed box is not a board. The two questions were one function,
 * and the filter answered both: an empty lane therefore erased the structure.
 *
 * OUTBID is deliberately not a filter of the board. It shows the spot ladder,
 * which is a separate list with its own numbering (CatwalkLadder.tsx), beside
 * the whole table. Filtering the board down to "vacancies plus outbid holders"
 * was the shape of the old idea that a vacancy is itself a thing for sale.
 */
export function tabRows(tab: CatwalkTab, rows: readonly CatwalkRow[]): CatwalkRow[] {
  if (tab === 'ranked') return rows.filter((row) => row.lane === 'ranked')
  if (tab === 'champions') return rows.filter((row) => row.lane === 'champion')
  if (tab === 'agents') return []
  return [...rows]
}

/**
 * The lane a tab is LOOKING THROUGH, or null for a tab that shows every lane.
 *
 * A row whose lane is not the lens renders in the 'other' state: numbered,
 * crested, and plainly marked as taken through a different lane. A row that is
 * genuinely vacant renders open. That is how a lane tab keeps all thirty-six
 * numbered positions on screen without ever drawing an occupied position as an
 * empty one.
 *
 * AGENTS has a lens no row can ever match, which is exactly right: the lane is
 * not scheduled yet, so no position is held through it, and the tab shows the
 * table with every held position marked taken elsewhere.
 */
export function tabLens(tab: CatwalkTab): CatwalkLane | 'agents' | null {
  if (tab === 'ranked') return 'ranked'
  if (tab === 'champions') return 'champion'
  if (tab === 'agents') return 'agents'
  return null
}

export type CatwalkQuery =
  | { kind: 'none' }
  /** A bare number is a slot lookup, not a ticker: `7` and `p12` mean P07/P12. */
  | { kind: 'slot'; spot: number; raw: string }
  | { kind: 'text'; term: string; raw: string }

export function parseCatwalkQuery(raw: string): CatwalkQuery {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'none' }
  const slot = /^p?0*(\d{1,3})$/i.exec(trimmed)
  if (slot) return { kind: 'slot', spot: Number(slot[1]), raw: trimmed }
  // `$GIGA` and `GIGA` are the same gesture; the sigil is decoration on a ticker.
  return { kind: 'text', term: trimmed.replace(/^\$/, '').toLowerCase(), raw: trimmed }
}

/**
 * Lower is better; null means no match. Symbol prefix beats a name substring
 * beats a mint substring, because a holder typing four characters is far more
 * often typing a ticker than the middle of a base58 address.
 */
export function matchScore(row: CatwalkRow, query: CatwalkQuery): number | null {
  if (query.kind === 'none') return 0
  if (query.kind === 'slot') return row.spot === query.spot ? 0 : null
  const entry = row.entry
  if (!entry) return null
  const team = entry.team
  const symbol = (team?.symbol ?? '').replace(/^\$/, '').toLowerCase()
  const name = (team?.name ?? '').toLowerCase()
  const mint = entry.mint.toLowerCase()
  const term = query.term
  if (symbol && symbol.startsWith(term)) return 0
  if (name && name.includes(term)) return 1
  // A pasted contract address is the point of this search, but two characters of
  // base58 hit almost every mint on the board, so mint matching needs four.
  if (term.length >= 4 && mint.includes(term)) return 2
  if (symbol && symbol.includes(term)) return 3
  return null
}

/**
 * THE DIM/MATCH LAYER THE LEFT BOARD WEARS.
 *
 * It takes ROWS AND A QUERY AND NOTHING ELSE - in particular it cannot be given
 * a tab, which is the whole point of it existing as a function.
 *
 * CatwalkApp used to build these two predicates inline from `tabRows(tab, ...)`,
 * so the one layer the left column still read was tab-dependent: a query that
 * matched a coin OUTSIDE the open tab's lane produced an EMPTY hit set, which
 * dimmed every row on the board and outlined none. Clicking SOLZ RANKED while
 * searching therefore faded all thirty-six numbered positions to .22 and dropped
 * the match outline - the left side re-rendering on a tab click, which is the
 * exact thing this screen promises never to do.
 *
 * Whether a lane HAS a hit is a separate question with a separate answer, and it
 * belongs to the rail: see `searchOutcome`, which is still judged against the
 * tab's own rows.
 */
export function boardSearchLayer(rows: readonly CatwalkRow[], query: CatwalkQuery): {
  hits: number[]
  dimmed: (row: CatwalkRow) => boolean
  matched: (row: CatwalkRow) => boolean
} {
  const hits = matchedSpots(rows, query)
  const hitSet = new Set(hits)
  return {
    hits,
    // Only a TEXT query dims: a slot lookup is a jump to a number, and greying
    // the other thirty-five to answer "where is P07" hides the board to point
    // at one row of it.
    dimmed: (row) => query.kind === 'text' && !hitSet.has(row.spot),
    matched: (row) => query.kind !== 'none' && hitSet.has(row.spot),
  }
}

/**
 * EVERYTHING A SEARCH DECIDES, DERIVED IN ONE PLACE, WITH THE TAB HELD APART.
 *
 * `boardSearchLayer` cannot be handed a tab; nothing stopped a CALLER from
 * handing it `tabRows(tab, rows)` and putting the regression straight back -
 * and nothing could catch that, because CatwalkApp only ever reaches its
 * searching frame in a browser and this repo's tests are server renders. So the
 * two derivations live here together instead, where a test can hold them to
 * each other:
 *
 *   - the BOARD layer is built from EVERY row. The tab is not in scope for it.
 *   - the VISIBLE rows are the tab's own, and they exist for the rail's verdict
 *     (`searchOutcome`) and for nothing else.
 *
 * CatwalkApp no longer names `boardSearchLayer` at all, so the one way to make
 * the left board tab-dependent again is to change THIS function, which is
 * covered: see 'the board layer is built from the whole board, never the tab's
 * rows' in tests/catwalkBoard.test.tsx.
 *
 * 'info' is not a lane. It asks the same question the MIAW PRIX tab asks -
 * every row on the board - because it shares that tab's rail, and a search
 * verdict narrower than the rail it is printed beside would be a different
 * claim.
 */
export function catwalkBoardLayer(
  rows: readonly CatwalkRow[],
  query: CatwalkQuery,
  tab: CatwalkPanelId,
): {
  hits: number[]
  dimmed: (row: CatwalkRow) => boolean
  matched: (row: CatwalkRow) => boolean
  visible: CatwalkRow[]
} {
  return {
    ...boardSearchLayer(rows, query),
    visible: tabRows(tab === 'info' ? 'catwalk' : tab, rows),
  }
}

/** The spots a query lights, best match first. */
export function matchedSpots(rows: readonly CatwalkRow[], query: CatwalkQuery): number[] {
  if (query.kind === 'none') return []
  return rows
    .map((row) => ({ row, score: matchScore(row, query) }))
    .filter((hit): hit is { row: CatwalkRow; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || a.row.spot - b.row.spot)
    .map((hit) => hit.row.spot)
}
