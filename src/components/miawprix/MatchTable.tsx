import type { MiawPrixMarketsState, MiawPrixMatch } from './miawPrixSource'
import { CoinIdentity } from './CoinIdentity'
import {
  EM_DASH, isWinner, kickoffLabel, matchState, pairingNotice, programmeLabel, rewardLabel, volumeCell,
} from './board'

type Variant = 'upcoming' | 'finished'

const SKELETON_ROWS = 4

function PendingRows({ columns }: { columns: number }) {
  return <>{Array.from({ length: SKELETON_ROWS }, (_, index) => <tr key={index} className="mp-pending-row" aria-hidden="true">
    <td><i className="mp-pending mp-pending--time" /></td>
    <td><i className="mp-pending mp-pending--programme" /></td>
    <td><span className="mp-pair">
      <span className="mp-coin"><i className="mp-pending mp-pending--mark" /><span className="mp-coin-text"><i className="mp-pending mp-pending--symbol" /><i className="mp-pending mp-pending--name" /></span></span>
      <i className="mp-versus" aria-hidden="true">v</i>
      <span className="mp-coin"><i className="mp-pending mp-pending--mark" /><span className="mp-coin-text"><i className="mp-pending mp-pending--symbol" /><i className="mp-pending mp-pending--name" /></span></span>
    </span></td>
    {columns === 6 && <td><i className="mp-pending mp-pending--symbol" /></td>}
    <td className="mp-col-num"><i className="mp-pending mp-pending--num" /></td>
    <td className="mp-col-num"><i className="mp-pending mp-pending--num" /></td>
  </tr>)}</>
}

function PairingCell({ match, now }: { match: MiawPrixMatch; now: number }) {
  const notice = pairingNotice(match, now)
  // Before the pairing is bound, there is no pairing to show. Rendering placeholder
  // teams here would publish a fixture the programme has not decided.
  if (notice) return <span className="mp-unbound">{notice}</span>
  const final = matchState(match) === 'final'
  return <span className="mp-pair">
    {match.sides.map((side, index) => <span key={`${side.teamId}-${side.mint}-${index}`} className="mp-pair-side">
      {index > 0 && <i className="mp-versus" aria-hidden="true">v</i>}
      <CoinIdentity
        mint={side.mint} symbol={side.symbol} name={side.name} logoUrl={side.logoUrl} color={side.color}
        muted={final && !isWinner(match, side)}
      />
    </span>)}
  </span>
}

/**
 * What the table says ABOUT ITSELF, in exactly one sentence or none.
 *
 * A failed refresh does not empty the table — the rows on screen are the last
 * read that landed. Printing "unavailable" over rows it is still showing let
 * the table make two contradictory claims at once, so the two conditions are no
 * longer independent: rows present means the message describes those rows as
 * stale; no rows means the message is the outage itself.
 */
function tableMessage(loading: boolean, unavailable: string, rows: number, stale: string, empty: string): string {
  if (loading) return ''
  if (rows > 0) return unavailable ? stale : ''
  return unavailable || empty
}

export function MatchTable({ variant, matches, markets, now, loading, unavailable }: {
  variant: Variant
  matches: MiawPrixMatch[]
  markets: MiawPrixMarketsState
  now: number
  loading: boolean
  unavailable: string
}) {
  const finished = variant === 'finished'
  const columns = finished ? 6 : 5
  const staleCopy = finished
    ? 'These are the results from the last read that landed. The programme is unreachable, so a match settled since is not here.'
    : 'This is the schedule from the last read that landed. The programme is unreachable, so it may have changed since.'
  const emptyCopy = finished
    ? 'No MIAW PRIX match has settled in this season yet.'
    : 'No MIAW PRIX match is scheduled. The next pairing appears once CATWALK binds it.'
  const message = tableMessage(loading, unavailable, matches.length, staleCopy, emptyCopy)
  const stale = message === staleCopy
  return <div className="mp-table-scroll" tabIndex={0} aria-label={finished ? 'MIAW PRIX results' : 'MIAW PRIX schedule'}>
    <table className={`mp-table mp-table--matches ${finished ? 'mp-table--final' : 'mp-table--next'}`}>
      <caption className="sr-only">
        {finished
          ? 'Settled MIAW PRIX matches. The winning coin is highlighted.'
          : 'Scheduled MIAW PRIX matches. A pairing binds twelve hours before kickoff.'}
      </caption>
      <thead><tr>
        <th scope="col" className="mp-col-time">{finished ? 'Played' : 'Kickoff'}</th>
        <th scope="col">Programme</th>
        <th scope="col">Pairing</th>
        {finished && <th scope="col">Winner</th>}
        <th scope="col" className="mp-col-num">Reward pool</th>
        <th scope="col" className="mp-col-num">Volume</th>
      </tr></thead>
      <tbody aria-busy={loading}>
        {loading && <PendingRows columns={columns} />}
        {!loading && matches.map((match) => {
          const state = matchState(match)
          const volume = volumeCell(match.matchId, markets)
          const winner = match.sides.find((side) => isWinner(match, side))
          return <tr key={match.matchId} className={`mp-match is-${state}`}>
            <td className="mp-col-time">
              <span className="mp-time">{kickoffLabel(match.scheduledStartAt)}</span>
              <small>{state === 'live' ? 'Live now' : state === 'cancelled' ? 'Cancelled' : match.displayMatchId}</small>
            </td>
            <td>{programmeLabel(match)}</td>
            <td><PairingCell match={match} now={now} /></td>
            {finished && <td>{winner
              ? <CoinIdentity mint={winner.mint} symbol={winner.symbol} name={winner.name} logoUrl={winner.logoUrl} color={winner.color} />
              : <span className="mp-unbound">{state === 'cancelled' ? 'No result' : EM_DASH}</span>}</td>}
            {/* Soda Liquid, the game stake — deliberately NOT the money green
                that volume takes, because the two are not the same kind of number. */}
            <td className="mp-col-num mp-reward">{rewardLabel(match)}</td>
            {/* Five different facts share this cell; volumeCell() is the only
                place allowed to decide which one it states. A catalogue that has
                not answered yet gets the same un-inked bar as any other value
                still being read — it must not borrow the em dash, which on this
                page means "we looked, and there is no market". */}
            <td className="mp-col-num">{volume.reading === 'pending'
              ? <span className="mp-unknown" title={volume.note}><i className="mp-pending mp-pending--num" aria-hidden="true" /><span className="sr-only">{volume.note}</span></span>
              : <span className={volume.reading === 'zero' || volume.reading === 'figure' ? 'mp-volume' : 'mp-unknown'} title={volume.note}>{volume.text}</span>}</td>
          </tr>
        })}
        {message && <tr className={`mp-message-row${stale ? ' is-stale' : ''}`}><td colSpan={columns}>{message}</td></tr>}
      </tbody>
    </table>
  </div>
}
