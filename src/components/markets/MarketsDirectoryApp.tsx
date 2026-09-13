import '../../styles/home.css'
import '../../styles/home-markets.css'
import { ArrowUpRight, Eye } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { DynamicSolanaSession } from '../arena/DynamicSolanaSession'
import { StatusDot, TeamMark, compact } from '../home/HomePrimitives'
import { useHomeData } from '../home/useHomeData'
import { SiteFooter } from '../solz/SiteFooter'
import { SiteHeader } from '../solz/SiteHeader'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { SolzMatch, SolzSnapshot } from '../solz/model'

type Props = { apiUrl?: string; environmentId: string }

type MarketGroup = { title: string; detail: string; matches: SolzMatch[]; empty: string }

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

function MarketRow({ match, now }: { match: SolzMatch; now: number }) {
  const [home, away] = match.teams
  const participants = match.roster.length || match.teams.reduce((total, team) => total + team.agentIds.length, 0)
  return <a className="mk-market-row" href={`/events/${encodeURIComponent(match.id)}`}>
    <div className="mk-market-status"><StatusDot pink={match.phase !== 'live'}>{scheduleLabel(match, now)}</StatusDot><span>{match.mode}</span></div>
    <div className="mk-market-title"><strong>{matchTitle(match)}</strong><small>{match.map} · {match.round}</small></div>
    {home && away && match.teams.length === 2 ? <div className="mk-market-sides"><span><TeamMark id={home.teamId} color={home.color}/>{home.symbol}<b>{home.score}</b></span><span><TeamMark id={away.teamId} color={away.color}/>{away.symbol}<b>{away.score}</b></span></div> : <div className="mk-market-meta"><span>{participants} agents</span><span>{match.teams.length} teams</span></div>}
    <div className="mk-market-meta"><span>{compact(match.volume.COOLA)} COOLA</span><span><Eye size={13}/>{compact(match.viewers)}</span></div>
    <ArrowUpRight className="mk-market-open" size={18}/>
  </a>
}

function MarketDirectory({ snapshot, error, retry, walletControl }: { snapshot: SolzSnapshot | null; error: string; retry: () => void; walletControl: ReactNode }) {
  const groups = useMemo<MarketGroup[]>(() => snapshot ? [
    { title: 'Live markets', detail: 'Markets currently in play.', matches: snapshot.matches.filter((match) => match.phase === 'live'), empty: 'No markets are live right now.' },
    { title: 'Upcoming markets', detail: 'Scheduled matches available to preview.', matches: snapshot.matches.filter((match) => match.phase === 'countdown' || match.phase === 'queued').sort((a, b) => a.startedAt - b.startedAt), empty: 'No upcoming markets are scheduled.' },
    { title: 'Past markets', detail: 'Completed matches and settled outcomes.', matches: snapshot.matches.filter((match) => match.phase === 'settled').sort((a, b) => b.endsAt - a.endsAt), empty: 'No settled markets yet.' },
  ] : [], [snapshot])
  return <div className="solz-home mk-app">
    <a className="sh-skip-link" href="#market-directory">Skip to markets</a>
    <SiteHeader homeHref="/" marketsHref="/markets" active="markets" walletControl={walletControl}/>
    <main className="mk-main" id="market-directory">
      <header className="mk-heading"><span>ARENA MARKET DIRECTORY</span><h1>ALL MATCH MARKETS</h1><p>Browse every live, scheduled, and settled arena match. Open a match to watch and trade its available markets.</p></header>
      {error ? <div className="mk-state" role="alert"><strong>Markets could not load.</strong><span>{error}</span><button className="sh-button" onClick={retry}>Try again</button></div> : !snapshot ? <div className="mk-state" role="status">Loading market directory…</div> : <div className="mk-groups">{groups.map((group) => <section key={group.title} className="mk-group" aria-labelledby={group.title.replaceAll(' ', '-').toLowerCase()}>
        <div className="mk-group-heading"><div><h2 id={group.title.replaceAll(' ', '-').toLowerCase()}>{group.title}</h2><p>{group.detail}</p></div><span>{group.matches.length}</span></div>
        <div className="mk-market-list">{group.matches.map((match) => <MarketRow key={match.id} match={match} now={snapshot.updatedAt}/>)}</div>
        {!group.matches.length && <p className="mk-empty">{group.empty}</p>}
      </section>)}</div>}
    </main>
    <SiteFooter homeHref="/" backToTopHref="#market-directory"/>
  </div>
}

export function MarketsDirectoryApp({ apiUrl = '', environmentId }: Props) {
  const source = useMemo(() => createSolzDataSource(), [])
  const { snapshot, error, retry } = useHomeData(source, apiUrl)
  return <DynamicSolanaSession environmentId={environmentId} predictionApiUrl={apiUrl}>{(session) => <MarketDirectory snapshot={snapshot} error={error} retry={retry} walletControl={session.walletControl}/>}</DynamicSolanaSession>
}
