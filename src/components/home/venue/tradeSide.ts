import { create } from 'zustand'

/** Whether the trader is buying or selling, published by the trade ticket and
 *  read by the market lists beside it.
 *
 *  The lists quote a price on every outcome button, and that price is only
 *  meaningful against a direction: buying takes an ask, selling hits a bid.
 *  While this lived as local state in the ticket, switching to Sell repriced
 *  the ticket and left every row still advertising its buy price — the list and
 *  the ticket disagreeing about the same outcome at the same instant.
 *
 *  A store rather than a prop for the same reason as bookPick.ts: the ticket and
 *  the lists are siblings several hops apart under two different page roots. */
export type TradeSide = 'buy' | 'sell'

const useTradeSideStore = create<{ side: TradeSide }>(() => ({ side: 'buy' }))

export function setTradeSide(side: TradeSide) {
  if (useTradeSideStore.getState().side !== side) useTradeSideStore.setState({ side })
}

/** A primitive, so the selector cannot loop on a fresh object identity. */
export const useTradeSide = () => useTradeSideStore(state => state.side)
export const getTradeSide = () => useTradeSideStore.getState().side
