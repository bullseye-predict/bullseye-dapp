import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AppShell } from '../solz/AppShell'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { MatchTable } from './MatchTable'
import { ProgrammeLayout, useNarrow } from './ProgrammeLayout'
import { SeasonPanel } from './SeasonPanel'
import { StandingsTable } from './StandingsTable'
import { miawPrixSource, type MiawPrixBoard } from './miawPrixSource'
import { useTokenMeta } from '../solz/tokenMeta'
import { resolvedTokenLogo } from '../solz/tokenIcon'
import { champion, orderSeasons, rankStandings, seasonMismatch, splitMatches, sectionCount } from './board'
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

  const data = board ?? EMPTY_BOARD
  const boardMints = useMemo(() => [...new Set([
    ...data.standings.map((row) => row.mint),
    ...data.matches.flatMap((match) => match.sides.map((side) => side.mint)),
  ].filter(Boolean))], [data])
  const tokenMeta = useTokenMeta(boardMints)
  // A cycle is an immutable list of mints, not an immutable broken image URL.
  // Identity can be filled from the same mint registry CATWALK uses without
  // changing who was locked into the match.
  const displayData = useMemo<MiawPrixBoard>(() => ({
    ...data,
    standings: data.standings.map((row) => {
      const meta = tokenMeta.get(row.mint)
      return meta ? {
        ...row,
        name: row.name === row.symbol && meta.name ? meta.name : row.name,
        logoUrl: resolvedTokenLogo(row.logoUrl, meta.icon) || undefined,
      } : { ...row, logoUrl: resolvedTokenLogo(row.logoUrl) || undefined }
    }),
    matches: data.matches.map((match) => ({
      ...match,
      sides: match.sides.map((side) => {
        const meta = tokenMeta.get(side.mint)
        return meta ? {
          ...side,
          name: side.name === side.symbol && meta.name ? meta.name : side.name,
          logoUrl: resolvedTokenLogo(side.logoUrl, meta.icon) || undefined,
        } : { ...side, logoUrl: resolvedTokenLogo(side.logoUrl) || undefined }
      }),
    })),
  }), [data, tokenMeta])
  const seasons = useMemo(() => orderSeasons(data.seasons), [data.seasons])
  const standings = useMemo(() => rankStandings(displayData.standings), [displayData.standings])
  const { upcoming, finished, missed } = useMemo(() => splitMatches(displayData.matches, now), [displayData.matches, now])
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
      <div className="mp-heading-copy">
        <h1 className="sz-page-title">MIAW PRIX</h1>
        <p>One month, one season, one champion. The coins on the CATWALK walk in through the Agent Colosseum programme; the season is won on raw wins.</p>
      </div>
      <div className="mp-heading-season">
        <SeasonPanel
          season={data.season}
          seasons={seasons}
          champion={winner}
          now={now}
          loading={loading}
          venue={venue}
          onSelect={setSeasonId}
        />
        <button type="button" className="mp-refresh" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw size={15} /> {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </header>

    {/* The skeleton below is aria-hidden, so the fact that the page is still
        reading has to reach assistive technology some other way. */}
    <p className="sr-only" role="status">{loading ? 'Loading the MIAW PRIX season, schedule and standings.' : ''}</p>

    {error && <p className="mp-error" role="alert">{error}</p>}
    {mismatch && <p className="mp-error" role="alert">{mismatch}</p>}
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
          <span>{missed ? `${missed} past ${missed === 1 ? 'slot' : 'slots'} without a verified result` : 'Cycle locks before its first kickoff'}</span>
        </div>
        <MatchTable variant="upcoming" matches={upcoming} missed={missed} now={now} loading={loading} unavailable={error ? 'The schedule is unavailable while the programme is unreachable.' : ''} />
      </section>}
      results={<section className="mp-section" aria-labelledby="mp-results">
        <div className="mp-section-heading">
          <h2 id="mp-results">Results</h2>
          <span>{sectionCount({ loading, counted }, finished.length, { one: 'completed match', many: 'completed matches', unavailable: 'Results unavailable' })}</span>
        </div>
        <MatchTable variant="finished" matches={finished} now={now} loading={loading} unavailable={error ? 'Results are unavailable while the programme is unreachable.' : ''} />
      </section>}
    />

    <p className="mp-footnote">
      Matchups are frozen from the CATWALK board at lock time. Prediction pool and aggregate volume belong to the
      standings view; they remain empty until the prediction index publishes those coin-level totals. Completed here
      means the off-chain Colosseum game result is final; prediction-market settlement is tracked separately.
    </p>
  </AppShell>
}
