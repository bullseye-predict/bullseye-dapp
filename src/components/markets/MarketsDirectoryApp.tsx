import '../../styles/home.css'
import '../../styles/home-markets.css'
import '../../styles/markets-directory.css'
import { ArrowUpRight, Eye, Users, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { StatusDot, TeamMark, compact } from '../home/HomePrimitives'
import { useHomeData } from '../home/useHomeData'
import { linkedAnswerLabel, linkedQuestionTitle, questionEvents, standaloneQuestions, useReservedSolanaQuestions } from '../home/solanaQuestionMarkets'
import { useSolanaMarketPrices } from '../home/useSolanaMarketPrices'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { AppShell } from '../solz/AppShell'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { ArenaMarket, SolzMatch, SolzSnapshot } from '../solz/model'
import { eventMarketVolume } from '../events/eventModel'

type Props = { apiUrl?: string }

/** A directory entry. A standalone question is not match-backed, so its title,
 *  status and market are supplied rather than derived from teams. */
export type DirectoryRow = { match: SolzMatch; market?: ArenaMarket; markets?: ArenaMarket[]; title?: string; detail?: string; status?: string; collateral?: string }

const filters = ['All', 'Live', 'Upcoming', 'Settled', 'Questions'] as const
type MarketFilter = typeof filters[number]

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

/** Match outcome identities before falling back to order. Missing quotes stay
 *  indicative: team count cannot establish odds or imply a certain winner. */
function teamOdds(match: SolzMatch, market: ArenaMarket | undefined) {
  return match.teams.map((team, index) => {
    const outcome = market?.outcomes.find((item) => item.teamId === team.teamId) ?? market?.outcomes[index]
    return { team, probability: outcome?.probability ?? 1 / Math.max(1, match.teams.length), indicative: outcome?.indicative ?? !outcome }
  })
}

/** The question leads. Everything that qualifies it - status, mode, schedule -
 *  sits under it, so scanning the grid reads the markets and not the chrome. */
function CardFrame({ row, now, kind, children }: { row: DirectoryRow; now: number; kind: string; children: ReactNode }) {
  const { match } = row
  const marketVolume = row.markets?.reduce((sum, market) => sum + eventMarketVolume(market), 0) ?? (row.market ? eventMarketVolume(row.market) : match.volume.COOLA)
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
      <span>{compact(marketVolume)} {row.collateral ?? 'COOLA'} Vol.</span>
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
      {odds.map(({ team, probability, indicative }) => <div className="mk-versus-side" key={team.teamId}>
        <TeamMark id={team.teamId} color={team.color}/>
        <strong>{team.symbol}</strong>
        <b style={{ color: team.color }}>{indicative ? '—' : percent(probability)}</b>
      </div>)}
    </div>
    {!odds.some(item => item.indicative) && <div className="mk-split" style={{ background: away?.team.color ?? 'var(--sh-line)' }}>
      <i style={{ width: percent(home?.probability ?? .5), background: home?.team.color ?? 'var(--sh-lime)' }}/>
    </div>}
  </CardFrame>
}

/** One ranked row per contender, highest first, tail collapsed into a count.
 *  Used for a team field and for a set of linked questions alike: both are a
 *  field with no head-to-head to split. */
function RankedCard({ row, now, kind, rows, note }: { row: DirectoryRow; now: number; kind: string; rows: { key: string; label: string; color?: string; probability: number; indicative?: boolean }[]; note: string }) {
  const ranked = [...rows].sort((a, b) => Number(a.indicative) - Number(b.indicative) || b.probability - a.probability)
  const shown = ranked.slice(0, 4)
  return <CardFrame row={row} now={now} kind={kind}>
    <div className="mk-ffa">
      {shown.map((item) => <div className="mk-ffa-row" key={item.key}>
        {item.color ? <TeamMark id={item.key} color={item.color}/> : <span className="mk-ffa-dot" aria-hidden="true"/>}
        <strong>{item.label}</strong>
        <span className="mk-ffa-bar"><i style={{ width: item.indicative ? '0%' : percent(item.probability), background: item.color ?? 'var(--sh-lime)' }}/></span>
        <b>{item.indicative ? '—' : percent(item.probability)}</b>
      </div>)}
    </div>
    <div className="mk-card-note"><Users size={11}/>{note}{ranked.length > shown.length ? ` · ${ranked.length - shown.length} more` : ''}</div>
  </CardFrame>
}

function FreeForAllCard({ row, now }: { row: DirectoryRow; now: number }) {
  const rows = teamOdds(row.match, row.market).map(({ team, probability, indicative }) => ({ key: team.teamId, label: team.symbol, color: team.color, probability, indicative }))
  return <RankedCard row={row} now={now} kind="ffa" rows={rows} note={`${row.match.teams.length} ${row.match.teams.length === 1 ? 'team' : 'teams'}${row.match.roster.length ? ` · ${row.match.roster.length} agents` : ''}`}/>
}

/** Several linked questions under one event: rank them by their YES price. */
function LinkedQuestionsCard({ row, now }: { row: DirectoryRow; now: number }) {
  const rows = (row.markets ?? []).map((market) => ({
    key: market.id,
    // The subject is what differs between linked questions; the shared tail is
    // already the card title, so showing it on every row would be noise.
    label: market.presentation?.answer?.label ?? linkedAnswerLabel(market.title, row.title ?? ''),
    probability: market.outcomes[0]?.probability ?? .5,
    indicative: market.outcomes[0]?.indicative,
  }))
  return <RankedCard row={row} now={now} kind="linked" rows={rows} note={`${rows.length} linked questions`}/>
}

/** A standalone question has no teams at all: it trades as a plain YES/NO pair. */
function QuestionCard({ row, now }: { row: DirectoryRow; now: number }) {
  const outcomes = row.market?.outcomes ?? []
  return <CardFrame row={row} now={now} kind="question">
    <div className="mk-binary">
      {outcomes.slice(0, 2).map((outcome, index) => <span className={`mk-binary-side ${index === 0 ? 'is-yes' : 'is-no'}`} key={outcome.id}>
        {outcome.label}<b>{outcome.indicative ? '—' : percent(outcome.probability)}</b>
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

export function MarketDirectory({ snapshot, questions, error, retry }: { snapshot: SolzSnapshot | null; questions: DirectoryRow[]; error: string; retry: () => void }) {
  const [filter, setFilter] = useState<MarketFilter>('All')
  const [search, setSearch] = useState('')
  const rows = useMemo(() => {
    const matches: DirectoryRow[] = (snapshot?.matches ?? []).map(match => ({ match, market: snapshot?.markets.find(item => item.id === match.marketId), title: match.teams.length > 2 ? `${match.teams.length}-TEAM FREE FOR ALL` : match.teams.map(team => team.symbol).join(' VS ') || match.map }))
    // Questions and arena matches share one stage; status is a filter, never a
    // separate section that pushes the next available market below the fold.
    return [...questions, ...matches].filter(row => {
      const phase = row.match.phase
      const selected = filter === 'All' || (filter === 'Questions' ? questions.includes(row) : filter === 'Live' ? phase === 'live' : filter === 'Settled' ? phase === 'settled' : phase === 'countdown' || phase === 'queued')
      return selected && `${row.title ?? ''} ${row.match.mode} ${row.match.teams.map(team => team.name).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())
    })
  }, [snapshot, questions, filter, search])
  return <AppShell className="solz-home mk-app" marketsHref="/markets" active="markets" skipTo="#market-directory" skipLabel="Skip to markets" backToTopHref="#market-directory">
    <main className="mk-main" id="market-directory">
      <header className="mk-heading"><h1>All markets</h1><label className="mk-search"><Search size={18}/><input type="search" aria-label="Search markets" placeholder="Search markets" value={search} onChange={event => setSearch(event.target.value)}/></label></header>
      <nav className="mk-filters" aria-label="Filter markets">{filters.map(item => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</nav>
      {error ? <div className="mk-state" role="alert"><strong>Markets could not load.</strong><span>{error}</span><button className="sh-button" onClick={retry}>Try again</button></div> : !snapshot ? <div className="mk-state" role="status">Loading markets…</div> : <>
        <span className="mk-result-count" role="status">{rows.length} {rows.length === 1 ? 'market' : 'markets'}</span>
        {rows.length ? <div className="mk-card-grid">{rows.map(row => <MarketCard key={row.match.id} row={row} now={snapshot.updatedAt}/>)}</div> : <div className="mk-empty"><strong>{search || filter !== 'All' ? 'No matching markets' : 'No markets available yet'}</strong><span>{search || filter !== 'All' ? 'Try another filter or search.' : 'Markets will appear here when they are published.'}</span></div>}
      </>}
    </main>
  </AppShell>
}

export function MarketsDirectoryApp({ apiUrl = '' }: Props) {
  const source = useMemo(() => createSolzDataSource({ simulationEnabled: () => false }), [])
  const { snapshot, error, retry } = useHomeData(source, apiUrl)
  const venue = useSolanaVenue(apiUrl)
  const reserved = useReservedSolanaQuestions(apiUrl, venue)
  const standalone = useMemo(() => standaloneQuestions(reserved.questions, snapshot?.matches ?? []), [reserved.questions, snapshot?.matches])
  const standaloneMarkets = useMemo(() => standalone.map((view) => view.market), [standalone])
  const priced = useSolanaMarketPrices(standaloneMarkets, venue, true).markets
  const pricedById = useMemo(() => new Map(priced.map((market) => [market.id, market])), [priced])
  // Only questions with no arena match behind them. An arena-backed question
  // already appears as its match card, and listing it here would duplicate it.
  const questions = useMemo<DirectoryRow[]>(
    () => questionEvents(standalone).map((views) => {
      const markets = views.map((view) => pricedById.get(view.market.id) ?? view.market)
      return {
        match: views[0].match,
        market: markets[0],
        markets,
        title: markets[0]?.presentation?.eventTitle ?? linkedQuestionTitle(markets.map((market) => market.title)),
        detail: `Closes ${lockLabel(views[0].match.endsAt)}`,
        status: views[0].question.status === 'live' ? 'LIVE NOW' : 'RESERVED',
        collateral: 'fUSDC',
      }
    }),
    [standalone, priced],
  )
  return <MarketDirectory snapshot={snapshot} questions={questions} error={error} retry={retry}/>
}
