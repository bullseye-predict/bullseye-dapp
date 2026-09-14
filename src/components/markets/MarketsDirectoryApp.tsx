import '../../styles/home.css'
import '../../styles/home-markets.css'
import { ArrowUpRight, Eye, Users } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { DynamicSolanaSession } from '../arena/DynamicSolanaSession'
import { StatusDot, TeamMark, compact } from '../home/HomePrimitives'
import { useHomeData } from '../home/useHomeData'
import { linkedQuestionTitle, questionEvents, standaloneQuestions, useReservedSolanaQuestions } from '../home/solanaQuestionMarkets'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { AppShell } from '../solz/AppShell'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { ArenaMarket, SolzMatch, SolzSnapshot } from '../solz/model'

type Props = { apiUrl?: string; environmentId: string }

/** A directory entry. A standalone question is not match-backed, so its title,
 *  status and market are supplied rather than derived from teams. */
export type DirectoryRow = { match: SolzMatch; market?: ArenaMarket; markets?: ArenaMarket[]; title?: string; detail?: string; status?: string }

type MarketGroup = { title: string; detail: string; rows: DirectoryRow[]; empty: string }

const percent = (value: number) => `${Math.round(value * 100)}%`

function scheduleLabel(match: SolzMatch, now: number) {
  if (match.phase === 'live') return 'LIVE NOW'
  if (match.phase === 'settled') return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(match.endsAt)
  const remaining = Math.max(0, match.startedAt - now)
  if (remaining < 60_000) return 'STARTING NOW'
  if (remaining < 3_600_000) return `STARTS IN ${Math.ceil(remaining / 60_000)}M`
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(match.startedAt)
}

const lockLabel = (at: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)

/** Each team's share of the market, by teamId, falling back to outcome order so
 *  a market that never labelled its outcomes still renders a bar. */
function teamOdds(match: SolzMatch, market: ArenaMarket | undefined) {
  return match.teams.map((team, index) => {
    const outcome = market?.outcomes.find((item) => item.teamId === team.teamId) ?? market?.outcomes[index]
    return { team, probability: outcome?.probability ?? 1 / Math.max(1, match.teams.length) }
  })
}

/** The question leads. Everything that qualifies it - status, mode, schedule -
 *  sits under it, so scanning the grid reads the markets and not the chrome. */
function CardFrame({ row, now, kind, children }: { row: DirectoryRow; now: number; kind: string; children: ReactNode }) {
  const { match } = row
  return <a className={`mk-card mk-card--${kind}`} href={`/events/${encodeURIComponent(match.id)}`}>
    <div className="mk-card-head">
      <h3 className="mk-card-title">{row.title ?? match.map}</h3>
      <ArrowUpRight className="mk-card-open" size={15}/>
    </div>
    <div className="mk-card-status">
      <StatusDot pink={match.phase !== 'live'}>{row.status ?? scheduleLabel(match, now)}</StatusDot>
      <span>{row.detail ?? `${match.mode} · ${match.round}`}</span>
    </div>
    {children}
    <div className="mk-card-bottom">
      <span>{compact(match.volume.COOLA)} COOLA Vol.</span>
      <span><Eye size={12}/>{compact(match.viewers)}</span>
    </div>
  </a>
}

/** Two teams: the head-to-head split reads as one bar with both shares on it. */
function VersusCard({ row, now }: { row: DirectoryRow; now: number }) {
  const odds = teamOdds(row.match, row.market)
  const [home, away] = odds
  return <CardFrame row={row} now={now} kind="versus">
    <div className="mk-versus">
      {odds.map(({ team, probability }) => <div className="mk-versus-side" key={team.teamId}>
        <TeamMark id={team.teamId} color={team.color}/>
        <strong>{team.symbol}</strong>
        <b style={{ color: team.color }}>{percent(probability)}</b>
      </div>)}
    </div>
    <div className="mk-split" style={{ background: away?.team.color ?? 'var(--sh-line)' }}>
      <i style={{ width: percent(home?.probability ?? .5), background: home?.team.color ?? 'var(--sh-lime)' }}/>
    </div>
  </CardFrame>
}

/** One ranked row per contender, highest first, tail collapsed into a count.
 *  Used for a team field and for a set of linked questions alike: both are a
 *  field with no head-to-head to split. */
function RankedCard({ row, now, kind, rows, note }: { row: DirectoryRow; now: number; kind: string; rows: { key: string; label: string; color?: string; probability: number }[]; note: string }) {
  const ranked = [...rows].sort((a, b) => b.probability - a.probability)
  const shown = ranked.slice(0, 4)
  return <CardFrame row={row} now={now} kind={kind}>
    <div className="mk-ffa">
      {shown.map((item) => <div className="mk-ffa-row" key={item.key}>
        {item.color ? <TeamMark id={item.key} color={item.color}/> : <span className="mk-ffa-dot" aria-hidden="true"/>}
        <strong>{item.label}</strong>
        <span className="mk-ffa-bar"><i style={{ width: percent(item.probability), background: item.color ?? 'var(--sh-lime)' }}/></span>
        <b>{percent(item.probability)}</b>
      </div>)}
    </div>
    <div className="mk-card-note"><Users size={11}/>{note}{ranked.length > shown.length ? ` · ${ranked.length - shown.length} more` : ''}</div>
  </CardFrame>
}

function FreeForAllCard({ row, now }: { row: DirectoryRow; now: number }) {
  const rows = teamOdds(row.match, row.market).map(({ team, probability }) => ({ key: team.teamId, label: team.symbol, color: team.color, probability }))
  return <RankedCard row={row} now={now} kind="ffa" rows={rows} note={`${row.match.teams.length} teams${row.match.roster.length ? ` · ${row.match.roster.length} agents` : ''}`}/>
}

/** Several linked questions under one event: rank them by their YES price. */
function LinkedQuestionsCard({ row, now }: { row: DirectoryRow; now: number }) {
  const rows = (row.markets ?? []).map((market) => ({
    key: market.id,
    // The subject is what differs between linked questions; the shared tail is
    // already the card title, so showing it on every row would be noise.
    label: market.title.replace(/^Will\s+/i, '').replace(/\s+finish.*$/i, '') || market.title,
    probability: market.outcomes[0]?.probability ?? .5,
  }))
  return <RankedCard row={row} now={now} kind="linked" rows={rows} note={`${rows.length} linked questions`}/>
}

/** A standalone question has no teams at all: it trades as a plain YES/NO pair. */
function QuestionCard({ row, now }: { row: DirectoryRow; now: number }) {
  const outcomes = row.market?.outcomes ?? []
  return <CardFrame row={row} now={now} kind="question">
    <div className="mk-binary">
      {outcomes.slice(0, 2).map((outcome, index) => <span className={`mk-binary-side ${index === 0 ? 'is-yes' : 'is-no'}`} key={outcome.id}>
        {outcome.label}<b>{percent(outcome.probability)}</b>
      </span>)}
    </div>
  </CardFrame>
}

/** Three shapes, chosen by what the market actually is: no teams is a plain
 *  question, exactly two is a head-to-head, anything else is a ranked field. */
export function MarketCard({ row, now }: { row: DirectoryRow; now: number }) {
  if (!row.match.teams.length) return (row.markets?.length ?? 0) > 1 ? <LinkedQuestionsCard row={row} now={now}/> : <QuestionCard row={row} now={now}/>
  if (row.match.teams.length === 2) return <VersusCard row={row} now={now}/>
  return <FreeForAllCard row={row} now={now}/>
}

function MarketDirectory({ snapshot, questions, error, retry, walletControl }: { snapshot: SolzSnapshot | null; questions: DirectoryRow[]; error: string; retry: () => void; walletControl: ReactNode }) {
  const groups = useMemo<MarketGroup[]>(() => {
    if (!snapshot) return []
    const row = (match: SolzMatch): DirectoryRow => ({ match, market: snapshot.markets.find((item) => item.id === match.marketId), title: match.teams.length > 2 ? `${match.teams.length}-TEAM FREE FOR ALL` : match.teams.map((team) => team.symbol).join(' VS ') })
    return [
      // Listed first and always rendered: a standalone question settles on its own
      // schedule and is the only market that outlives the ~20-minute match cycle.
      { title: 'Standalone questions', detail: 'Long-running questions that settle on their own schedule, independent of any match.', rows: questions, empty: 'No standalone questions are open right now.' },
      { title: 'Live markets', detail: 'Markets currently in play.', rows: snapshot.matches.filter((match) => match.phase === 'live').map(row), empty: 'No markets are live right now.' },
      { title: 'Upcoming markets', detail: 'Scheduled matches available to preview.', rows: snapshot.matches.filter((match) => match.phase === 'countdown' || match.phase === 'queued').sort((a, b) => a.startedAt - b.startedAt).map(row), empty: 'No upcoming markets are scheduled.' },
      { title: 'Past markets', detail: 'Completed matches and settled outcomes.', rows: snapshot.matches.filter((match) => match.phase === 'settled').sort((a, b) => b.endsAt - a.endsAt).map(row), empty: 'No settled markets yet.' },
    ]
  }, [snapshot, questions])
  return <AppShell className="solz-home mk-app" marketsHref="/markets" active="markets" walletControl={walletControl} skipTo="#market-directory" skipLabel="Skip to markets" backToTopHref="#market-directory">
    <main className="mk-main" id="market-directory">
      <header className="mk-heading"><span>ARENA MARKET DIRECTORY</span><h1>ALL MATCH MARKETS</h1><p>Browse every live, scheduled, and settled arena match, plus standalone questions that trade on their own schedule. Open one to watch and trade its available markets.</p></header>
      {error ? <div className="mk-state" role="alert"><strong>Markets could not load.</strong><span>{error}</span><button className="sh-button" onClick={retry}>Try again</button></div> : !snapshot ? <div className="mk-state" role="status">Loading market directory…</div> : <div className="mk-groups">{groups.map((group) => <section key={group.title} className="mk-group" aria-labelledby={group.title.replaceAll(' ', '-').toLowerCase()}>
        <div className="mk-group-heading"><div><h2 id={group.title.replaceAll(' ', '-').toLowerCase()}>{group.title}</h2><p>{group.detail}</p></div><span>{group.rows.length}</span></div>
        {group.rows.length ? <div className="mk-card-grid">{group.rows.map((row) => <MarketCard key={row.match.id} row={row} now={snapshot.updatedAt}/>)}</div> : <p className="mk-empty">{group.empty}</p>}
      </section>)}</div>}
    </main>
  </AppShell>
}

export function MarketsDirectoryApp({ apiUrl = '', environmentId }: Props) {
  const source = useMemo(() => createSolzDataSource(), [])
  const { snapshot, error, retry } = useHomeData(source, apiUrl)
  const venue = useSolanaVenue(apiUrl)
  const reserved = useReservedSolanaQuestions(apiUrl, venue)
  // Only questions with no arena match behind them. An arena-backed question
  // already appears as its match card, and listing it here would duplicate it.
  const questions = useMemo<DirectoryRow[]>(
    () => questionEvents(standaloneQuestions(reserved.questions, snapshot?.matches ?? [])).map((views) => {
      const markets = views.map((view) => view.market)
      return {
        match: views[0].match,
        market: views[0].market,
        markets,
        title: linkedQuestionTitle(markets.map((market) => market.title)),
        detail: `${views[0].match.map} · LOCKS ${lockLabel(views[0].match.endsAt)}`,
        status: views[0].question.status === 'live' ? 'LIVE NOW' : 'RESERVED',
      }
    }),
    [reserved.questions, snapshot?.matches],
  )
  return <DynamicSolanaSession environmentId={environmentId} predictionApiUrl={apiUrl}>{(session) => <MarketDirectory snapshot={snapshot} questions={questions} error={error} retry={retry} walletControl={session.walletControl}/>}</DynamicSolanaSession>
}
