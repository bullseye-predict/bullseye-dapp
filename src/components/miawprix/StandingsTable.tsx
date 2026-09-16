import { CoinIdentity } from './CoinIdentity'
import type { ExplorerVenue } from './explorerLink'
import { EM_DASH, type RankedStanding } from './board'

const SKELETON_ROWS = 6

/** The loading state is the same table with its cells un-inked, rather than a
 *  different surface that will be replaced: the column widths, the row height
 *  and the header are identical, so nothing moves when the data lands. */
function PendingRows() {
  return <>{Array.from({ length: SKELETON_ROWS }, (_, index) => <tr key={index} className="mp-pending-row" aria-hidden="true">
    <td className="mp-col-rank"><i className="mp-pending mp-pending--rank" /></td>
    <th scope="row"><span className="mp-coin"><i className="mp-pending mp-pending--mark" /><span className="mp-coin-text"><i className="mp-pending mp-pending--symbol" /><i className="mp-pending mp-pending--name" /><i className="mp-pending mp-pending--mint" /></span></span></th>
    <td><i className="mp-pending mp-pending--num" /></td>
    <td><i className="mp-pending mp-pending--num" /></td>
    <td><i className="mp-pending mp-pending--num" /></td>
    <td className="mp-col-num"><i className="mp-pending mp-pending--num" /></td>
    <td className="mp-col-num"><i className="mp-pending mp-pending--num" /></td>
  </tr>)}</>
}

/**
 * What the table says ABOUT ITSELF, in exactly one sentence or none.
 *
 * A failed refresh does not empty the standings — the rows on screen are the
 * last read that landed. Printing "unavailable" over rows it is still showing
 * let the table make two contradictory claims at once, so the two conditions
 * are no longer independent: rows present means the message describes those
 * rows as stale; no rows means the message is the outage itself.
 */
const STALE = 'These are the standings from the last read that landed. The programme is unreachable, so a match settled since is not counted here.'
const EMPTY = 'No results recorded in this season yet. Standings appear once a MIAW PRIX match settles.'

/** The standings table is the one surface that lists every walking coin exactly
 *  once, so it is where the contract addresses live: a reader who wants to
 *  trade a coin they just saw win finds its mint on the row that names it,
 *  copyable and linked out, rather than hunting for it off-page. */
export function StandingsTable({ rows, loading, unavailable, venue }: {
  rows: RankedStanding[]
  loading: boolean
  unavailable: string
  /** Venue record behind the explorer links. Null renders the address with its
   *  copy control and no link, never a link to a guessed chain. */
  venue?: ExplorerVenue | null
}) {
  const message = loading ? '' : rows.length > 0 ? (unavailable ? STALE : '') : (unavailable || EMPTY)
  const stale = message === STALE
  return <div className="mp-standings">
    <div className="mp-table-scroll" tabIndex={0} aria-label="MIAW PRIX standings">
      <table className="mp-table mp-table--standings">
        <caption className="sr-only">Season standings. The season is won on raw win count; losses break a tie and nothing else. Prediction pool and volume totals are reserved for the prediction-market aggregate.</caption>
        <thead><tr>
          <th scope="col" className="mp-col-rank">#</th>
          <th scope="col">Coin</th>
          <th scope="col" className="mp-col-num mp-col-wins">W</th>
          <th scope="col" className="mp-col-num">L</th>
          <th scope="col" className="mp-col-num">Matches</th>
          <th scope="col" className="mp-col-num">Prediction pool</th>
          <th scope="col" className="mp-col-num">Volume</th>
        </tr></thead>
        <tbody aria-busy={loading}>
          {loading && <PendingRows />}
          {/* data-pos marks the first three, who are exactly the coins the
              CHAMPION lane admits to CATWALK — not a podium.
              Any deeper rank is a number, not a place. */}
          {!loading && rows.map((row) => {
            return <tr key={row.mint} data-pos={row.rank <= 3 ? row.rank : undefined}>
              <td className="mp-col-rank"><span className="mp-rank">{row.rank}</span>{row.tiedOnWins && <i className="mp-tie" title="Tied on wins; ordered by losses, then by who reached the win count first">tie</i>}</td>
              <th scope="row"><CoinIdentity mint={row.mint} symbol={row.symbol} name={row.name} logoUrl={row.logoUrl} color={row.color} address venue={venue} /></th>
              <td className="mp-col-num mp-col-wins"><b>{row.wins}</b></td>
              <td className="mp-col-num">{row.losses}</td>
              <td className="mp-col-num">{row.matches}</td>
              <td className="mp-col-num"><span className="mp-unknown" title="Prediction pool is not published yet">{EM_DASH}</span></td>
              <td className="mp-col-num"><span className="mp-unknown" title="Aggregate prediction volume is not published yet">{EM_DASH}</span></td>
            </tr>
          })}
          {message && <tr className={`mp-message-row${stale ? ' is-stale' : ''}`}><td colSpan={7}>{message}</td></tr>}
        </tbody>
      </table>
    </div>
    {/* The rule sits outside the horizontal scroller: it explains the table and
        must stay readable at the page's own width rather than scrolling with it. */}
    <p className="mp-rule">Won on raw wins{rows.length ? ` ${EM_DASH} losses break a tie and nothing else` : ''}.</p>
  </div>
}
