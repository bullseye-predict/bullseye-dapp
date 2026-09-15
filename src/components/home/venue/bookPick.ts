import { create } from 'zustand'

/** One price level, picked out of an order book, on its way to the trade
 *  ticket. A row click is a PRICE choice and nothing else: it never changes
 *  which outcome the trader is on, never flips Buy to Sell, and never writes
 *  their share count. Clicking a bid while buying is a trader saying "80c is my
 *  limit", not asking to become a seller.
 *
 *  A store rather than a prop because the book and the ticket are siblings six
 *  hops apart — LiveOrderBook sits under PredictionDetail, OutcomeRow,
 *  PredictionOptions and MatchViewer, the ticket under InteractionConsole —
 *  and the same pair is assembled again by the event page through different
 *  parents. Threading a price through ten components that never read it is the
 *  arrangement session/store.ts was written to delete.
 *
 *  Only value-typed fields live here, per session/chrome.ts: the applier is the
 *  ticket's own effect, not a callback parked in the store. */
export type BookPick = {
  /** The book that owns the level, so only that book marks a row picked.
   *  Built by bookTarget(); never parsed. */
  target: string
  /** The ticket matches on the contract alone, not on the market id: the event
   *  page hands the book a synthesised per-answer market while its ticket holds
   *  the parent prediction, so the two market ids legitimately differ for one
   *  and the same contract. */
  outcomeId: string
  no: boolean
  /** Which ladder the level sits in. It identifies the row — a crossed book
   *  quotes the same price as both a bid and an ask — and it says whether the
   *  level is executable against the trader's current direction. It does NOT
   *  choose that direction. */
  side: 'ask' | 'bid'
  /** Collateral atoms, as printed by the owning book. Identifies the row. */
  price: string
  /** The level's price in cents, exact — the ticket rounds it toward its own
   *  side, since a limit is a ceiling on a buy and a floor on a sell. */
  cents: string
  /** What rests at this one level, less the trader's own orders, which they
   *  cannot fill. Shown as available liquidity, never written into the share
   *  field: how much to trade stays the trader's decision. */
  quantity: string
  /** Re-picking the same level must re-apply, and a pick must apply exactly
   *  once: the ticket remembers the last nonce it consumed. */
  nonce: number
}

type BookPickState = { pick: BookPick | null }

const useBookPickStore = create<BookPickState>(() => ({ pick: null }))

/** Identifies one outcome's book. Market id included so a row stays marked in
 *  the book it was clicked in and nowhere else, even where two questions on the
 *  page share the literal outcome ids "yes" and "no". */
export const bookTarget = (marketId: string, outcomeId: string, no: boolean) => `${marketId}|${outcomeId}|${no ? 'no' : 'yes'}`

/** Beside the store rather than in it, because clearing the pick must not rewind
 *  the count: a consumer remembers the last nonce it applied, and a restarted
 *  one reads to it as already applied — the pick after every edit would be
 *  silently dropped. */
let issued = 0

export function pickBookLevel(pick: Omit<BookPick, 'nonce'>) {
  useBookPickStore.setState({ pick: { ...pick, nonce: ++issued } }, true)
}

/** The trader taking the price back — typing in the limit field or stepping it —
 *  ends the pick, so the row stops claiming to describe the ticket's price.
 *  Switching Buy/Sell does not: the price is still the one they chose, and only
 *  whether it is executable changes. */
export function clearBookPick() {
  if (useBookPickStore.getState().pick) useBookPickStore.setState({ pick: null }, true)
}

/** `pick` is a stable reference between writes, so this selector cannot loop. */
export const useBookPick = () => useBookPickStore(state => state.pick)
export const getBookPick = () => useBookPickStore.getState().pick
