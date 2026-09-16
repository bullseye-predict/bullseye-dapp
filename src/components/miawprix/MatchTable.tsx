import { useState } from 'react'
import { ArrowUpRight, Check, Copy } from 'lucide-react'
import type { MiawPrixMatch } from './miawPrixSource'
import { CoinIdentity } from './CoinIdentity'
import { eventHref } from '../events/eventModel'
import {
  countdown, EM_DASH, isWinner, kickoffParts, matchState, pairingNotice, programmeLabel,
} from './board'

type Variant = 'upcoming' | 'finished'

const SKELETON_ROWS = 4

function PendingRows() {
  return <>{Array.from({ length: SKELETON_ROWS }, (_, index) => <tr key={index} className="mp-pending-row" aria-hidden="true">
    <td><i className="mp-pending mp-pending--time" /></td>
    <td><span className="mp-pair">
      <span className="mp-coin"><i className="mp-pending mp-pending--mark" /><span className="mp-coin-text"><i className="mp-pending mp-pending--symbol" /><i className="mp-pending mp-pending--name" /></span></span>
      <i className="mp-versus" aria-hidden="true">VS</i>
      <span className="mp-coin"><i className="mp-pending mp-pending--mark" /><span className="mp-coin-text"><i className="mp-pending mp-pending--symbol" /><i className="mp-pending mp-pending--name" /></span></span>
    </span><i className="mp-pending mp-pending--programme" /></td>
    <td><i className="mp-pending mp-pending--num" /></td>
  </tr>)}</>
}

function PairingCell({ match, now }: { match: MiawPrixMatch; now: number }) {
  const notice = pairingNotice(match, now)
  // Before the pairing is bound, there is no pairing to show. Rendering placeholder
  // teams here would publish a fixture the programme has not decided.
  if (notice) return <span className="mp-unbound">{notice}</span>
  const final = matchState(match) === 'final'
  const [home, away] = match.sides
  if (!home || !away) return <span className="mp-unbound">Pairing pending</span>
  return <span className="mp-pair">
    <span className="mp-pair-side is-home">
      <CoinIdentity
        mint={home.mint} symbol={home.symbol} name={home.name} logoUrl={home.logoUrl} color={home.color}
        muted={final && !isWinner(match, home)}
      />
    </span>
    <i className="mp-versus" aria-hidden="true">VS</i>
    <span className="mp-pair-side is-away">
      <CoinIdentity
        mint={away.mint} symbol={away.symbol} name={away.name} logoUrl={away.logoUrl} color={away.color}
        muted={final && !isWinner(match, away)}
      />
    </span>
  </span>
}

function MatchReference({ match }: { match: MiawPrixMatch }) {
  const [copied, setCopied] = useState(false)
  return <span className="mp-market-actions">
    <a
      href={eventHref('/events', match.matchId)}
      aria-label="Open event details"
      title="Open event details"
    >
      <ArrowUpRight size={16} aria-hidden="true" />
    </a>
    <button
      type="button"
      aria-label={copied ? 'Match ID copied' : 'Copy match ID'}
      title={copied ? 'Copied' : 'Copy match ID'}
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(match.matchId).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1_600)
          })
        } catch { /* Clipboard failure leaves the market link available. */ }
      }}
    >
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
    <span className="sr-only" aria-live="polite">{copied ? 'Match ID copied' : ''}</span>
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

export function MatchTable({ variant, matches, missed = 0, now, loading, unavailable }: {
  variant: Variant
  matches: MiawPrixMatch[]
  missed?: number
  /** Kept optional for callers migrating from the former match-volume table. */
  markets?: unknown
  now: number
  loading: boolean
  unavailable: string
}) {
  const finished = variant === 'finished'
  const columns = 3
  const staleCopy = finished
    ? 'These are the results from the last read that landed. The programme is unreachable, so a match settled since is not here.'
    : 'This is the schedule from the last read that landed. The programme is unreachable, so it may have changed since.'
  const emptyCopy = finished
    ? 'No MIAW PRIX match has settled in this season yet.'
    : missed
      ? 'No upcoming or live matches. Past slots without a verified result are hidden from the schedule.'
      : 'No locked matchup yet. The schedule appears when CATWALK freezes both sides.'
  const message = tableMessage(loading, unavailable, matches.length, staleCopy, emptyCopy)
  const stale = message === staleCopy
  return <div className={`mp-table-scroll${finished ? ' mp-table-scroll--results' : ' mp-table-scroll--schedule'}`} tabIndex={0} aria-label={finished ? 'MIAW PRIX results' : 'MIAW PRIX schedule'}>
    <table className={`mp-table mp-table--matches ${finished ? 'mp-table--final' : 'mp-table--next'}`}>
      <caption className="sr-only">
        {finished
          ? 'Settled MIAW PRIX matches. The winning coin is highlighted.'
          : 'Scheduled MIAW PRIX matches. Each matchup belongs to a frozen CATWALK cycle.'}
      </caption>
      <thead><tr>
        <th scope="col" className="mp-col-time">{finished ? 'Played' : 'Kickoff'}</th>
        <th scope="col" className="mp-col-match">Matchup</th>
        <th scope="col">Event</th>
      </tr></thead>
      <tbody aria-busy={loading}>
        {loading && <PendingRows />}
        {!loading && matches.map((match) => {
          const state = matchState(match, now)
          const kickoff = kickoffParts(match.scheduledStartAt)
          const winner = match.sides.find((side) => isWinner(match, side))
          const relative = state === 'live'
            ? 'Live now'
            : state === 'upcoming'
              ? match.scheduledStartAt > now ? `In ${countdown(match.scheduledStartAt - now)}` : 'Starting'
              : ''
          const cycle = match.cycleIndex === null
            ? ''
            : `CATWALK #${match.cycleIndex + 1}`
          const card = match.cycleMatchIndex === null || match.cycleMatchCount === null
            ? ''
            : `Match ${match.cycleMatchIndex + 1}/${match.cycleMatchCount}`
          return <tr key={match.matchId} className={`mp-match is-${state}`}>
            <td className="mp-col-time">
              <span className="mp-date">{kickoff.date}</span>
              {kickoff.time && <strong className="mp-time">{kickoff.time}</strong>}
              {relative && <small className="mp-kickoff-relative">{relative}</small>}
              {!relative && state !== 'upcoming' && <small>{state === 'cancelled' ? 'Cancelled' : state}</small>}
            </td>
            <td className="mp-col-match">
              <PairingCell match={match} now={now} />
              <span className="mp-match-meta">
                {(cycle || card) && <span className="mp-cycle">{cycle}{cycle && card ? ' · ' : ''}{card}</span>}
                <span className="mp-programme">{programmeLabel(match)}{finished && <span className="sr-only">{winner ? ` Winner: ${winner.symbol}` : state === 'cancelled' ? ' No result' : ` ${EM_DASH}`}</span>}</span>
              </span>
            </td>
            <td><MatchReference match={match} /></td>
          </tr>
        })}
        {message && <tr className={`mp-message-row${stale ? ' is-stale' : ''}`}><td colSpan={columns}>{message}</td></tr>}
      </tbody>
    </table>
  </div>
}
