import { CoinIdentity } from './CoinIdentity'
import type { ExplorerVenue } from './explorerLink'
import type { MiawPrixSeason } from './miawPrixSource'
import { championNote, seasonClock, seasonLabel, windowLabel, type Champion } from './board'

const STATUS_COPY: Record<MiawPrixSeason['status'], string> = {
  upcoming: 'Not started',
  live: 'Running',
  closed: 'Closed',
}

/** The crest-and-ticker shape the champion cell resolves to, un-inked. It reuses
 *  the loaded row's own classes so the cell keeps its width and its 33px crest
 *  height while the read is in flight. */
function PendingCoin() {
  return <span className="mp-coin">
    <i className="mp-pending mp-pending--mark" />
    <span className="mp-coin-text">
      <i className="mp-pending mp-pending--symbol" />
      <i className="mp-pending mp-pending--name" />
    </span>
  </span>
}

/**
 * The season is the frame everything else on this page is read inside, so it is
 * stated once, at the top: which season, when it runs, whether it is running,
 * and how long is left. A closed season leads with its champion instead of its
 * countdown, because that is the fact it exists to publish.
 *
 * Loading is the same panel with its VALUES un-inked, not a smaller panel: the
 * status chip, the champion block and the picker are grid cells that decide the
 * section's height and its column count, and dropping any of them would move
 * every table on the page when the read lands (AGENTS.md, Loading states).
 * Which cells exist is decided by the season already in hand, so a refresh or a
 * re-select holds the shape it is about to return to.
 */
export function SeasonPanel({ season, seasons, champion, now, loading, venue, onSelect }: {
  season: MiawPrixSeason | null
  seasons: MiawPrixSeason[]
  champion: Champion | null
  now: number
  loading: boolean
  /** Venue record behind the champion's explorer link. */
  venue?: ExplorerVenue | null
  onSelect: (seasonId: string) => void
}) {
  const closed = season?.status === 'closed'
  const classes = ['mp-season', closed ? 'is-closed' : '', season?.status === 'live' ? 'is-live' : '', loading ? 'is-pending' : '']
  return <section
    className={classes.filter(Boolean).join(' ')}
    aria-label="Season"
    aria-busy={loading || undefined}
  >
    <div className="mp-season-main">
      <div className="mp-season-id">
        <h2>{loading ? <i className="mp-pending mp-pending--inline mp-pending--season" /> : seasonLabel(season)}</h2>
        <span className={`mp-status mp-status--${loading ? 'none' : season?.status ?? 'none'}`}>
          {loading
            ? <i className="mp-pending mp-pending--inline mp-pending--status" />
            : season ? STATUS_COPY[season.status] : 'No season opened'}
        </span>
      </div>
      <p className="mp-season-window">
        {loading ? <i className="mp-pending mp-pending--inline mp-pending--window" /> : windowLabel(season)}
      </p>
    </div>

    {/* A champion is only ever shown for a closed season: while a season runs,
        the top row is a leader, and calling that a champion would publish a
        result the programme has not published. */}
    {closed && <div className="mp-champion">
      <span className="mp-champion-label">Champion</span>
      {loading
        ? <PendingCoin />
        : champion
          ? <CoinIdentity mint={champion.mint} symbol={champion.symbol} name={champion.name} logoUrl={champion.logoUrl} color={champion.color} address venue={venue} />
          : <span className="mp-unbound">No coin recorded a win</span>}
      {/* Three labelled figures, not "7—4 from 11 matches". The old line leaned
          on punctuation to carry meaning the reader had to reconstruct, and it
          spent this page's em dash — which everywhere else means "unknown" — as
          a separator between two numbers that are perfectly well known. */}
      {loading
        ? <span className="mp-champion-record"><i className="mp-pending mp-pending--inline mp-pending--record" /></span>
        : champion && <span className="mp-champion-record">
          <span className="mp-figure"><b>{champion.wins}</b><small>Won</small></span>
          <span className="mp-figure"><b>{champion.losses}</b><small>Lost</small></span>
          <span className="mp-figure"><b>{champion.matches}</b><small>Matches</small></span>
        </span>}
      {/* The season is won on raw wins, so a level top line is decided by
          something this cell does not show. The standings table admits the tie
          on the row below; stating the winner flatly here contradicted it. */}
      {!loading && championNote(champion) && <span className="mp-champion-tie">{championNote(champion)}</span>}
    </div>}

    <div className="mp-season-clock">
      <span className="mp-clock-label">
        {loading
          ? <i className="mp-pending mp-pending--inline mp-pending--clock-label" />
          : !season ? 'Season' : closed ? 'Result' : season.status === 'upcoming' ? 'Opens' : 'Closes'}
      </span>
      <strong className={!loading && season ? undefined : 'mp-unknown'}>
        {loading ? <i className="mp-pending mp-pending--inline mp-pending--clock" /> : seasonClock(season, now)}
      </strong>
    </div>

    {/* The picker's cell is reserved while loading and kept for a programme with
        a single season, where the control is inert rather than absent — its row
        carries the panel's bottom rule, so removing it resizes the section. */}
    {(loading || seasons.length > 0) && <label className="mp-season-picker">
      <span>Season</span>
      {loading
        ? <i className="mp-pending mp-pending--picker" />
        : <select value={season?.seasonId ?? ''} disabled={seasons.length < 2} onChange={(event) => onSelect(event.target.value)}>
          {/* An <option> cannot hold layout, so the status is parenthesised
              rather than hung off a middle dot. Same two facts, no separator
              doing a label's job. */}
          {seasons.map((option) => <option key={option.seasonId} value={option.seasonId}>
            {`${seasonLabel(option)} (${STATUS_COPY[option.status]})`}
          </option>)}
        </select>}
    </label>}
  </section>
}
