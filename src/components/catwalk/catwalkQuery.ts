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

export const CATWALK_TABS: CatwalkTab[] = ['catwalk', 'outbid', 'ranked', 'champions', 'agents']

export const isCatwalkTab = (value: string): value is CatwalkTab =>
  (CATWALK_TABS as string[]).includes(value)

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

/** The spots a query lights, best match first. */
export function matchedSpots(rows: readonly CatwalkRow[], query: CatwalkQuery): number[] {
  if (query.kind === 'none') return []
  return rows
    .map((row) => ({ row, score: matchScore(row, query) }))
    .filter((hit): hit is { row: CatwalkRow; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || a.row.spot - b.row.spot)
    .map((hit) => hit.row.spot)
}
