import '../../styles/home.css'
import '../../styles/home-markets.css'
import { ArrowUpRight, Eye } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { DynamicSolanaSession } from '../arena/DynamicSolanaSession'
import { StatusDot, TeamMark, compact } from '../home/HomePrimitives'
import { useHomeData } from '../home/useHomeData'
import { standaloneQuestions, useReservedSolanaQuestions } from '../home/solanaQuestionMarkets'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { SiteFooter } from '../solz/SiteFooter'
import { SiteHeader } from '../solz/SiteHeader'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { SolzMatch, SolzSnapshot } from '../solz/model'

type Props = { apiUrl?: string; environmentId: string }

/** A directory entry. Standalone questions are not match-backed, so the title
 *  and status they display are supplied rather than derived from teams. */
type DirectoryRow = { match: SolzMatch; title?: string; detail?: string; status?: string }

type MarketGroup = { title: string; detail: string; rows: DirectoryRow[]; empty: string }

function matchTitle(match: SolzMatch) {
  return match.teams.length > 2
    ? `${match.teams.length}-TEAM FREE FOR ALL`
    : match.teams.map((team) => team.symbol).join(' VS ')
}

function scheduleLabel(match: SolzMatch, now: number) {
  if (match.phase === 'live') return 'LIVE NOW'
  if (match.phase === 'settled') return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(match.endsAt)
  const remaining = Math.max(0, match.startedAt - now)
  if (remaining < 60_000) return 'STARTING NOW'
  if (remaining < 3_600_000) return `STARTS IN ${Math.ceil(remaining / 60_000)}M`
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(match.startedAt)
}

function MarketRow({ row, now }: { row: DirectoryRow; now: number }) {
  const { match } = row
  const [home, away] = match.teams
  const participants = match.roster.length || match.teams.reduce((total, team) => total + team.agentIds.length, 0)
  return <a className="mk-market-row" href={`/events/${encodeURIComponent(match.id)}`}>
    <div className="mk-market-status"><StatusDot pink={match.phase !== 'live'}>{row.status ?? scheduleLabel(match, now)}</StatusDot><span>{match.mode}</span></div>
    <div className="mk-market-title"><strong>{row.title ?? matchTitle(match)}</strong><small>{row.detail ?? `${match.map} · ${match.round}`}</small></div>
    {home && away && match.teams.length === 2 ? <div className="mk-market-sides"><span><TeamMark id={home.teamId} color={home.color}/>{home.symbol}<b>{home.score}</b></span><span><TeamMark id={away.teamId} color={away.color}/>{away.symbol}<b>{away.score}</b></span></div> : <div className="mk-market-meta"><span>{participants} agents</span><span>{match.teams.length} teams</span></div>}
    <div className="mk-market-meta"><span>{compact(match.volume.COOLA)} COOLA</span><span><Eye size={13}/>{compact(match.viewers)}</span></div>
    <ArrowUpRight className="mk-market-open" size={18}/>
  </a>
}

const lockLabel = (at: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)

function MarketDirectory({ snapshot, questions, error, retry, walletControl }: { snapshot: SolzSnapshot | null; questions: DirectoryRow[]; error: string; retry: () => void; walletControl: ReactNode }) {
  const groups = useMemo<MarketGroup[]>(() => snapshot ? [
    // Listed first and always rendered: a standalone question settles on its own
    // schedule and is the only market that outlives the ~20-minute match cycle.
    { title: 'Standalone questions', detail: 'Long-running questions that settle on their own schedule, independent of any match.', rows: questions, empty: 'No standalone questions are open right now.' },
    { title: 'Live markets', detail: 'Markets currently in play.', rows: snapshot.matches.filter((match) => match.phase === 'live').map((match) => ({ match })), empty: 'No markets are live right now.' },
    { title: 'Upcoming markets', detail: 'Scheduled matches available to preview.', rows: snapshot.matches.filter((match) => match.phase === 'countdown' || match.phase === 'queued').sort((a, b) => a.startedAt - b.startedAt).map((match) => ({ match })), empty: 'No upcoming markets are scheduled.' },
    { title: 'Past markets', detail: 'Completed matches and settled outcomes.', rows: snapshot.matches.filter((match) => match.phase === 'settled').sort((a, b) => b.endsAt - a.endsAt).map((match) => ({ match })), empty: 'No settled markets yet.' },
  ] : [], [snapshot, questions])
  return <div className="solz-home mk-app">
    <a className="sh-skip-link" href="#market-directory">Skip to markets</a>
    <SiteHeader homeHref="/" marketsHref="/markets" active="markets" walletControl={walletControl}/>
    <main className="mk-main" id="market-directory">
      <header className="mk-heading"><span>ARENA MARKET DIRECTORY</span><h1>ALL MATCH MARKETS</h1><p>Browse every live, scheduled, and settled arena match, plus standalone questions that trade on their own schedule. Open one to watch and trade its available markets.</p></header>
      {error ? <div className="mk-state" role="alert"><strong>Markets could not load.</strong><span>{error}</span><button className="sh-button" onClick={retry}>Try again</button></div> : !snapshot ? <div className="mk-state" role="status">Loading market directory…</div> : <div className="mk-groups">{groups.map((group) => <section key={group.title} className="mk-group" aria-labelledby={group.title.replaceAll(' ', '-').toLowerCase()}>
        <div className="mk-group-heading"><div><h2 id={group.title.replaceAll(' ', '-').toLowerCase()}>{group.title}</h2><p>{group.detail}</p></div><span>{group.rows.length}</span></div>
        <div className="mk-market-list">{group.rows.map((row) => <MarketRow key={row.match.id} row={row} now={snapshot.updatedAt}/>)}</div>
        {!group.rows.length && <p className="mk-empty">{group.empty}</p>}
      </section>)}</div>}
    </main>
    <SiteFooter homeHref="/" backToTopHref="#market-directory"/>
  </div>
}

export function MarketsDirectoryApp({ apiUrl = '', environmentId }: Props) {
  const source = useMemo(() => createSolzDataSource(), [])
  const { snapshot, error, retry } = useHomeData(source, apiUrl)
  const venue = useSolanaVenue(apiUrl)
  const reserved = useReservedSolanaQuestions(apiUrl, venue)
  // Only questions with no arena match behind them. An arena-backed question
  // already appears as its match row, and listing it here would duplicate it.
  const questions = useMemo<DirectoryRow[]>(
    () => standaloneQuestions(reserved.questions, snapshot?.matches ?? []).map(({ match, market, question }) => ({
      match,
      title: market.title,
      detail: `${match.map} · LOCKS ${lockLabel(match.endsAt)}`,
      status: question.status === 'live' ? 'LIVE NOW' : 'RESERVED',
    })),
    [reserved.questions, snapshot?.matches],
  )
  return <DynamicSolanaSession environmentId={environmentId} predictionApiUrl={apiUrl}>{(session) => <MarketDirectory snapshot={snapshot} questions={questions} error={error} retry={retry} walletControl={session.walletControl}/>}</DynamicSolanaSession>
}
