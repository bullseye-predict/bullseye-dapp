import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AppShell } from '../solz/AppShell'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { MatchTable } from './MatchTable'
import { ProgrammeLayout, useNarrow } from './ProgrammeLayout'
import { SeasonPanel } from './SeasonPanel'
import { StandingsTable } from './StandingsTable'
import {
  MARKETS_FAILED, MARKETS_UNREAD, marketsRead, miawPrixSource,
  type MiawPrixBoard, type MiawPrixMarketsState,
} from './miawPrixSource'
import { champion, marketsNotice, orderSeasons, rankStandings, seasonMismatch, splitMatches, sectionCount } from './board'
import '../../styles/miaw-prix.css'

type Props = {
  /** Same-origin arena proxy, e.g. `/api/agent-arena`. */
  endpoint: string
  /** Same-origin prediction proxy, e.g. `/api/prediction`. */
  predictionApiUrl: string
  /** Deep link from the season selector, e.g. `?season=solz-00`. */
  initialSeasonId?: string
}

const EMPTY_BOARD: MiawPrixBoard = { season: null, seasons: [], standings: [], matches: [] }

/** Countdowns are read in minutes, so a half-minute tick is enough and keeps a
 *  page full of tables from re-rendering once a second for no visible change. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function MiawPrixApp({ endpoint, predictionApiUrl, initialSeasonId = '' }: Props) {
  const source = useMemo(() => miawPrixSource(endpoint, predictionApiUrl), [endpoint, predictionApiUrl])
  const now = useNow()
  // Which chain a mint belongs to is a deployment fact, not a page's guess, so
  // the explorer links under every contract address are built from the venue
  // record the prediction service publishes. Null until it answers — and null
  // forever if it never does — which renders the address with its copy control
  // and no link, rather than a link to whichever chain was hardcoded.
  const venue = useSolanaVenue(predictionApiUrl)
  // Desktop splits the programme into two columns; a phone gets the same three
  // surfaces as tabs, with only the selected one built. ProgrammeLayout owns
  // both trees and never renders more than one of them.
  const narrow = useNarrow()
  const [seasonId, setSeasonId] = useState(initialSeasonId)
  const [board, setBoard] = useState<MiawPrixBoard | null>(null)
  const [markets, setMarkets] = useState<MiawPrixMarketsState>(MARKETS_UNREAD)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    source.board(seasonId, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setBoard(next) })
      .catch(() => { if (!controller.signal.aborted) setError('The MIAW PRIX programme is unavailable. Retry to reconnect.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [source, seasonId, revision])

  // Volume is a join, not the page. The catalogue lives behind a different
  // service, so its failure must leave the programme readable with an UNKNOWN
  // volume column rather than take the whole page down with it.
  //
  // Unknown is not empty. A rejection used to be folded into `new Map()`, the
  // same value the column starts on, so both a read in flight and a dead
  // catalogue rendered as "No prediction market opened for this match" on every
  // row. The three states stay three, as they do for the CATWALK spot ladder.
  useEffect(() => {
    const controller = new AbortController()
    setMarkets(MARKETS_UNREAD)
    source.markets(controller.signal)
      .then((next) => { if (!controller.signal.aborted) setMarkets(marketsRead(next)) })
      .catch(() => { if (!controller.signal.aborted) setMarkets(MARKETS_FAILED) })
    return () => controller.abort()
  }, [source, revision])

  const data = board ?? EMPTY_BOARD
  const seasons = useMemo(() => orderSeasons(data.seasons), [data.seasons])
  const standings = useMemo(() => rankStandings(data.standings), [data.standings])
  const { upcoming, finished } = useMemo(() => splitMatches(data.matches), [data.matches])
  const winner = champion(data.season, standings)
  // The request carries ?seasonId=, but only the response proves which season
  // answered. Showing another season's standings under the requested season's
  // name would misreport every number below, so the substitution is stated.
  // Only a landed response can be checked: a read still in flight is holding
  // the previous season's board, and a failed one has its own banner.
  const mismatch = loading || error || !board ? null : seasonMismatch(seasonId, board.season, seasons)
  // The same guard the line above already applies. A count taken from
  // EMPTY_BOARD after a failed read is not zero, it is unknown — and printing
  // "0 settled" directly beneath "the programme is unavailable" states the one
  // thing the page just said it could not know.
  // A board on screen is a board to count, even when the last REFRESH failed —
  // the table below already says the rows are the last read that landed, and a
  // heading reading "Standings unavailable" beside a table full of coins is a
  // contradiction the viewer has to resolve. Only a first load with nothing to
  // show has no count to state.
  const counted = !loading && !!board
  const catalogueNotice = marketsNotice(markets)

  return <AppShell
    className="solz-home mp-app"
    mainId="miaw-prix"
    mainClassName="mp-main"
    active="miawprix"
    skipTo="#miaw-prix"
    skipLabel="Skip to MIAW PRIX"
    backToTopHref="#miaw-prix"
  >
    <header className="mp-heading">
      <div>
        <h1 className="sz-page-title">MIAW PRIX</h1>
        <p>One month, one season, one champion. The coins on the CATWALK walk in through the Agent Colosseum programme; the season is won on raw wins.</p>
      </div>
      <button type="button" className="mp-refresh" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
        <RefreshCw size={15} /> {loading ? 'Refreshing' : 'Refresh'}
      </button>
    </header>

    <SeasonPanel
      season={data.season}
      seasons={seasons}
      champion={winner}
      now={now}
      loading={loading}
      venue={venue}
      onSelect={setSeasonId}
    />

    {/* The skeleton below is aria-hidden, so the fact that the page is still
        reading has to reach assistive technology some other way. */}
    <p className="sr-only" role="status">{loading ? 'Loading the MIAW PRIX season, schedule and standings.' : ''}</p>

    {error && <p className="mp-error" role="alert">{error}</p>}
    {mismatch && <p className="mp-error" role="alert">{mismatch}</p>}
    {/* Every Volume cell is an em dash when the catalogue is down, and an em
        dash in that column otherwise means "we looked, and there is no market".
        The outage is therefore stated once, in words, rather than left to a
        title attribute on forty identical dashes. */}
    {catalogueNotice && <p className="mp-notice" role="status">{catalogueNotice}</p>}

    <ProgrammeLayout
      narrow={narrow}
      standings={<section className="mp-section" aria-labelledby="mp-standings">
        <div className="mp-section-heading">
          <h2 id="mp-standings">Standings</h2>
          <span>{sectionCount({ loading, counted }, standings.length, { one: 'coin on the board', many: 'coins on the board', unavailable: 'Standings unavailable' })}</span>
        </div>
        <StandingsTable rows={standings} loading={loading} venue={venue} unavailable={error ? 'Standings are unavailable while the programme is unreachable.' : ''} />
      </section>}
      schedule={<section className="mp-section" aria-labelledby="mp-schedule">
        <div className="mp-section-heading">
          <h2 id="mp-schedule">Schedule</h2>
          <span>Pairings bind 12 hours before kickoff</span>
        </div>
        <MatchTable variant="upcoming" matches={upcoming} markets={markets} now={now} loading={loading} unavailable={error ? 'The schedule is unavailable while the programme is unreachable.' : ''} />
      </section>}
      results={<section className="mp-section" aria-labelledby="mp-results">
        <div className="mp-section-heading">
          <h2 id="mp-results">Results</h2>
          <span>{sectionCount({ loading, counted }, finished.length, { one: 'settled', many: 'settled', unavailable: 'Results unavailable' })}</span>
        </div>
        <MatchTable variant="finished" matches={finished} markets={markets} now={now} loading={loading} unavailable={error ? 'Results are unavailable while the programme is unreachable.' : ''} />
      </section>}
    />

    <p className="mp-footnote">
      Reward pools are Soda Liquid, the game stake. Volume is prediction-market money and is read from the prediction
      catalogue, not from the game: a match with no market shows an em dash, never a zero, and a volume still being
      read shows an un-inked bar rather than either. Market capitalisation is reported with the standings and decides
      nothing about the season, which is won on raw wins; a coin the programme did not price shows an em dash too.
    </p>
  </AppShell>
}
