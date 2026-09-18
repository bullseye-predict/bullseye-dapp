import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AppShell } from '../solz/AppShell'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { MatchTable } from './MatchTable'
import { ProgrammeLayout, useNarrow, type ProgrammeSurface } from './ProgrammeLayout'
import { SeasonPanel } from './SeasonPanel'
import { StandingsTable } from './StandingsTable'
import { miawPrixBoardKey, miawPrixSource, type MiawPrixBoard } from './miawPrixSource'
import { cachedValue } from '../solz/liveCache'
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

/**
 * A table's title bar: what the table is, how much of it there is, and the
 * control that reloads it.
 *
 * REFRESH LIVES HERE, NOT IN THE MASTHEAD. On a two-column board the reader is
 * at the bottom of the results when they want them re-read, and a single button
 * beside the season panel is off-screen by then. One button per title puts it
 * where the table is. All three reload the whole programme - the season, the
 * schedule and the standings arrive in one read - so all three say the same
 * word and the title attribute states the scope rather than implying each
 * table refreshes alone.
 */
export function SectionHeading({ id, title, count, busy, blocked, onRefresh }: {
  id: string
  title: string
  count: string
  /** THIS table's control was the one pressed. */
  busy: boolean
  /** A read is already in flight, from here or from another title. */
  blocked: boolean
  onRefresh: () => void
}) {
  return <div className="mp-section-heading">
    <h2 id={id}>{title}</h2>
    <div className="mp-section-tools">
      <span>{count}</span>
      <button
        type="button"
        className="mp-refresh mp-refresh--section"
        disabled={blocked}
        onClick={onRefresh}
        // Said plainly rather than implied: one read answers for all three
        // tables, so the other two update as well. The button no longer
        // pretends otherwise by blanking them.
        title="Re-reads the MIAW PRIX programme, which updates all three tables"
      >
        <RefreshCw size={13} aria-hidden="true" className={busy ? 'mp-spin' : undefined} /> {busy ? 'Refreshing' : 'Refresh'}
      </button>
    </div>
  </div>
}

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
  // THE FIRST FRAME IS THE LAST GOOD READ. This page is usually opened from the
  // home hero or from /catwalk, which are islands over the SAME document and
  // have already read this exact programme URL. Starting from nothing redrew
  // three tables of rows the reader had been looking at one click earlier as
  // skeletons. The read still goes out below - the seed buys a first frame, it
  // never answers for one. See src/components/solz/liveCache.ts.
  const seed = useMemo(
    () => cachedValue<MiawPrixBoard>(miawPrixBoardKey(endpoint, initialSeasonId)),
    [endpoint, initialSeasonId],
  )
  const [board, setBoard] = useState<MiawPrixBoard | null>(seed?.value ?? null)
  const [loading, setLoading] = useState(!seed)
  /** The rows on screen were carried in from another route and this mount's own
   *  read has not landed yet. `loading` is false — there IS a board — so nothing
   *  draws a skeleton; this is what stops those rows being passed off as fresh.
   *  Cleared by the first read that settles, and never set by a later one. */
  const [carried, setCarried] = useState(Boolean(seed))
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  /** Which table's REFRESH was pressed, or null when nothing is in flight.
   *
   *  ONE READ, BUT NOT ONE PAGE TEARDOWN. source.board() is a single request to
   *  ?kind=miawPrix that answers with the season, the standings AND the matches
   *  together - there is no per-surface endpoint, so any refresh necessarily
   *  re-reads all three. That is fine and cheap. What was not fine was showing
   *  it: every button drove the global loading flag, so pressing REFRESH on
   *  the results blanked the standings and the schedule to skeletons too and
   *  set all three buttons to "Refreshing". A control inside a table's title
   *  that visibly reloads the other two reads as a whole-page refresh, which is
   *  exactly what it looked like. */
  const [refreshingFrom, setRefreshingFrom] = useState<ProgrammeSurface | null>(null)
  /** The season the rows on screen belong to. A refresh re-reads the same
   *  season and keeps them; a season change has nothing worth keeping. */
  const shownSeason = useRef<string | null>(seed ? initialSeasonId : null)
  /** Consecutive failed reads, for the backoff below. Reset by any read that
   *  lands, so one bad minute does not leave the page on a 30s cadence. */
  const attempts = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    let retry: number | undefined
    // Skeletons only when there is nothing to keep. Re-reading the season that
    // is already on screen leaves it there and lets the new rows replace it in
    // place, so a refresh no longer looks like a navigation.
    if (shownSeason.current !== seasonId) { setLoading(true); setRefreshingFrom(null) }
    setError('')
    source.board(seasonId, controller.signal)
      .then((next) => { if (!controller.signal.aborted) { setBoard(next); shownSeason.current = seasonId; attempts.current = 0 } })
      .catch(() => {
        if (controller.signal.aborted) return
        // THE PAGE HEALS ITSELF. This read fails on a slow upstream far more
        // often than on a broken one, and with no retry a single blip left the
        // programme dead until a human pressed a button - which the banner told
        // them to do without giving them one. Capped exponential backoff so a
        // genuinely down control plane is not hammered.
        attempts.current += 1
        setError('The MIAW PRIX programme is unavailable. Retrying…')
        retry = window.setTimeout(
          () => setRevision((value) => value + 1),
          Math.min(30_000, 2_000 * 2 ** (attempts.current - 1)),
        )
      })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); setCarried(false); setRefreshingFrom(null) } })
    return () => { controller.abort(); if (retry) window.clearTimeout(retry) }
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
  const refresh = (from: ProgrammeSurface) => {
    if (refreshingFrom || loading) return
    setRefreshingFrom(from)
    setRevision((value) => value + 1)
  }
  const busy = (surface: ProgrammeSurface) => refreshingFrom === surface
  const blocked = loading || refreshingFrom !== null
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
        {carried && <p className="mp-carried"><RefreshCw size={12} aria-hidden="true" className="mp-spin" /> Showing the last read programme while it is re-read.</p>}
      </div>
      <div className="mp-heading-season">
        <SeasonPanel
          season={data.season}
          seasons={seasons}
          champion={winner}
          now={now}
          // A FAILED READ IS NOT "NO SEASON". With nothing landed, `data.season`
          // is EMPTY_BOARD's null, and the panel printed "NO SEASON · NO SEASON
          // OPENED" directly beside a banner saying the programme could not be
          // reached - a confident claim about the programme sourced from a read
          // that never arrived. Un-inked is what the panel already renders for
          // "not known yet", and while the retry above is pending that is also
          // literally what is happening, so aria-busy stays honest.
          loading={loading || (!!error && !board)}
          venue={venue}
          onSelect={setSeasonId}
        />
      </div>
    </header>

    {/* The skeleton below is aria-hidden, so the fact that the page is still
        reading has to reach assistive technology some other way. */}
    <p className="sr-only" role="status">{loading
      ? 'Loading the MIAW PRIX season, schedule and standings.'
      : carried
        ? 'Showing the last read MIAW PRIX programme while it is re-read.'
        : ''}</p>

    {/* The copy says the page is retrying, so it carries the control that does
        it now rather than naming an action the reader cannot take. */}
    {error && <p className="mp-error" role="alert">
      {error}
      <button type="button" className="mp-refresh mp-refresh--inline" disabled={blocked} onClick={() => refresh('standings')}>
        <RefreshCw size={13} aria-hidden="true" className={blocked ? 'mp-spin' : undefined} /> Retry now
      </button>
    </p>}
    {mismatch && <p className="mp-error" role="alert">{mismatch}</p>}
    <ProgrammeLayout
      narrow={narrow}
      standings={<section className="mp-section" aria-labelledby="mp-standings">
        <SectionHeading
          id="mp-standings" title="Standings" busy={busy('standings')} blocked={blocked} onRefresh={() => refresh('standings')}
          count={sectionCount({ loading, counted }, standings.length, { one: 'coin on the board', many: 'coins on the board', unavailable: 'Standings unavailable' })}
        />
        <StandingsTable rows={standings} loading={loading} venue={venue} unavailable={error ? 'Standings are unavailable while the programme is unreachable.' : ''} />
      </section>}
      schedule={<section className="mp-section" aria-labelledby="mp-schedule">
        <SectionHeading
          id="mp-schedule" title="Schedule" busy={busy('schedule')} blocked={blocked} onRefresh={() => refresh('schedule')}
          count={missed ? `${missed} past ${missed === 1 ? 'slot' : 'slots'} without a verified result` : 'Cycle locks before its first kickoff'}
        />
        <MatchTable variant="upcoming" matches={upcoming} missed={missed} now={now} loading={loading} unavailable={error ? 'The schedule is unavailable while the programme is unreachable.' : ''} />
      </section>}
      results={<section className="mp-section" aria-labelledby="mp-results">
        <SectionHeading
          id="mp-results" title="Results" busy={busy('results')} blocked={blocked} onRefresh={() => refresh('results')}
          count={sectionCount({ loading, counted }, finished.length, { one: 'completed match', many: 'completed matches', unavailable: 'Results unavailable' })}
        />
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
