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
import { normalisedChances } from './chance'
import { catalogueQuestions } from './marketList'
import { useMarketCatalogue } from './useMarketCatalogue'

type Props = { apiUrl?: string }

/** A directory entry. A standalone question is not match-backed, so its title,
 *  status and market are supplied rather than derived from teams. */
export type DirectoryRow = { match: SolzMatch; market?: ArenaMarket; markets?: ArenaMarket[]; title?: string; detail?: string; status?: string; collateral?: string }

// All/Live/Upcoming/Settled are statuses; General is a kind (MARKET_LIST_API.md:38
// gives `kind` as its own axis). Naming it after the axis stops it reading as a
// fifth status - every item here is a question, so 'Questions' excluded nothing.
const filters = ['All', 'Live', 'Upcoming', 'Settled', 'General'] as const
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

/** What the card is asking, not who is standing in it. A team-less room reaches
 *  us as one synthetic side (predictionArena.ts:82), whose symbol is a roster
 *  label rather than a question - and the body would only repeat it. */
function matchTitle(match: SolzMatch) {
  if (match.teams.length > 2) return `${match.teams.length}-TEAM FREE FOR ALL`
  if (match.teams.length === 2) return match.teams.map((team) => team.symbol).join(' VS ')
  const mode = match.mode?.toLowerCase()
  return mode ? `Which agent wins the ${mode}?` : match.map
}

/** The dot beside this already states the phase, and predictionArena.ts:85 sets
 *  a live room's round to 'MATCH LIVE', stating it twice. Every other round -
 *  INTERMISSION, SETTLED - carries a fact the dot cannot. */
const matchDetail = (match: SolzMatch) => [match.mode, match.round === 'MATCH LIVE' ? '' : match.round].filter(Boolean).join(' · ')

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
      <span>{row.detail ?? matchDetail(match)}</span>
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
    {shown.length > 0 && <div className="mk-ffa">
      {shown.map((item) => <div className="mk-ffa-row" key={item.key}>
        {item.color ? <TeamMark id={item.key} color={item.color}/> : <span className="mk-ffa-dot" aria-hidden="true"/>}
        <strong>{item.label}</strong>
        <span className="mk-ffa-bar"><i style={{ width: item.indicative ? '0%' : percent(item.probability), background: item.color ?? 'var(--sh-lime)' }}/></span>
        <b>{item.indicative ? '—' : percent(item.probability)}</b>
      </div>)}
    </div>}
    <div className="mk-card-note"><Users size={11}/>{note}{ranked.length > shown.length ? ` · ${ranked.length - shown.length} more` : ''}</div>
  </CardFrame>
}

function FreeForAllCard({ row, now }: { row: DirectoryRow; now: number }) {
  // Zero real teams reach this card as one synthetic side (predictionArena.ts:82),
  // so a team count is invented arithmetic rather than a fact about the room -
  // and a room with one side is not a team fight to count sides in.
  const contested = row.match.teams.length >= 2
  const rows = contested ? teamOdds(row.match, row.market).map(({ team, probability, indicative }) => ({ key: team.teamId, label: team.symbol, color: team.color, probability, indicative })) : []
  const note = [contested ? `${row.match.teams.length} teams` : '', row.match.roster.length ? `${row.match.roster.length} agents` : ''].filter(Boolean).join(' · ')
  return <RankedCard row={row} now={now} kind="ffa" rows={rows} note={note}/>
}

/** Several linked questions under one event. Only one of them can win, so CHANCE
 *  is the normalised distribution over the whole field - the same reading the
 *  event page takes (EventMarkets.tsx:43) - and not each book's own YES price.
 *  Read raw, twelve independent books on this card summed past 300%. */
function LinkedQuestionsCard({ row, now }: { row: DirectoryRow; now: number }) {
  const markets = row.markets ?? []
  // Hoisted above the map: the divisor is the whole field, so a per-market pass
  // cannot compute it. A book that never opened sits out the total and stays
  // undefined here rather than reading as 0%.
  const chances = normalisedChances(markets.map((market) => market.outcomes[0]))
  const rows = markets.map((market, index) => {
    // Only a book that actually quoted stamps `indicative: false`
    // (useSolanaMarketPrices.ts:146). An arena draft leaves it undefined and
    // carries a .5 placeholder, which chance.ts:43 will happily price - and
    // twelve of those normalise to a tidy uniform 8% no book ever made.
    const chance = market.outcomes[0]?.indicative === false ? chances[index] : undefined
    return {
      key: market.id,
      // The subject is what differs between linked questions; the shared tail is
      // already the card title, so showing it on every row would be noise.
      label: market.presentation?.answer?.label ?? linkedAnswerLabel(market.title, row.title ?? ''),
      probability: chance ?? 0,
      indicative: chance === undefined,
    }
  })
  return <RankedCard row={row} now={now} kind="linked" rows={rows} note={`${markets.length} linked questions`}/>
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
 *  question, exactly two is a head-to-head, anything else is a field - ranked
 *  when it has contenders to rank, named when it is one side of many agents. */
export function MarketCard({ row, now }: { row: DirectoryRow; now: number }) {
  // A team-less question and a one-synthetic-side arena room are the same shape:
  // no opponent to split against, but a set of linked questions to rank.
  if (row.match.teams.length < 2) {
    if ((row.markets?.length ?? 0) > 1) return <LinkedQuestionsCard row={row} now={now}/>
    return row.match.teams.length ? <FreeForAllCard row={row} now={now}/> : <QuestionCard row={row} now={now}/>
  }
  if (row.match.teams.length === 2) return <VersusCard row={row} now={now}/>
  return <FreeForAllCard row={row} now={now}/>
}

export function MarketDirectory({ snapshot, questions, error, retry }: { snapshot: SolzSnapshot | null; questions: DirectoryRow[]; error: string; retry: () => void }) {
  const [filter, setFilter] = useState<MarketFilter>('All')
  const [search, setSearch] = useState('')
  const rows = useMemo(() => {
    // match.marketId is roomId-derived (predictionArena.ts:87) and is no market's
    // id anywhere in the snapshot, so it never resolved. Join on matchId, the
    // predicate every event surface already uses (EventApp.tsx:106).
    const matches: DirectoryRow[] = (snapshot?.matches ?? []).map(match => {
      const markets = snapshot?.markets.filter(item => item.matchId === match.id) ?? []
      return { match, market: markets[0], markets, title: matchTitle(match) }
    })
    // Questions and arena matches share one stage; status is a filter, never a
    // separate section that pushes the next available market below the fold.
    return [...questions, ...matches].filter(row => {
      const phase = row.match.phase
      const selected = filter === 'All' || (filter === 'General' ? questions.includes(row) : filter === 'Live' ? phase === 'live' : filter === 'Settled' ? phase === 'settled' : phase === 'countdown' || phase === 'queued')
      return selected && `${row.title ?? ''} ${row.match.mode} ${row.match.teams.map(team => team.name).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())
    })
  }, [snapshot, questions, filter, search])
  return <AppShell className="solz-home mk-app" mainId="market-directory" mainClassName="mk-main" marketsHref="/markets" active="markets" skipTo="#market-directory" skipLabel="Skip to markets" backToTopHref="#market-directory">
      <header className="mk-heading"><h1 className="sz-page-title">All markets</h1><label className="mk-search"><Search size={18}/><input type="search" aria-label="Search markets" placeholder="Search markets" value={search} onChange={event => setSearch(event.target.value)}/></label></header>
      <nav className="mk-filters" aria-label="Filter markets">{filters.map(item => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</nav>
      {error ? <div className="mk-state" role="alert"><strong>Markets could not load.</strong><span>{error}</span><button className="sh-button" onClick={retry}>Try again</button></div> : !snapshot ? <div className="mk-card-grid" role="status" aria-busy="true" aria-label="Loading markets">
        {/* Placeholders in the real grid, at the real card size: the row does not
            jump when the snapshot lands, and a slow upstream reads as the page
            filling in rather than as an empty bordered slab. */}
        {[0, 1, 2].map((slot) => <div className="mk-card mk-card--pending" key={slot} aria-hidden="true">
          <span className="mk-pending mk-pending--title"/>
          <span className="mk-pending mk-pending--detail"/>
          <span className="mk-pending mk-pending--row"/>
          <span className="mk-pending mk-pending--row"/>
          <span className="mk-pending mk-pending--row"/>
        </div>)}
      </div> : <>
        <span className="mk-result-count" role="status">{rows.length} {rows.length === 1 ? 'market' : 'markets'}</span>
        {rows.length ? <div className="mk-card-grid">{rows.map(row => <MarketCard key={row.match.id} row={row} now={snapshot.updatedAt}/>)}</div> : <div className="mk-empty"><strong>{search || filter !== 'All' ? 'No matching markets' : 'No markets available yet'}</strong><span>{search || filter !== 'All' ? 'Try another filter or search.' : 'Markets will appear here when they are published.'}</span></div>}
      </>}
  </AppShell>
}

export function MarketsDirectoryApp({ apiUrl = '' }: Props) {
  const source = useMemo(() => createSolzDataSource({ simulationEnabled: () => false }), [])
  const { snapshot, error, retry } = useHomeData(source, apiUrl)
  const venue = useSolanaVenue(apiUrl)
  const catalogue = useMarketCatalogue(apiUrl)
  const reserved = useReservedSolanaQuestions(apiUrl, venue)
  // GET /market/list is the catalogue (docs/MARKET_LIST_API.md). Its market
  // addresses are derived here from (programId, matchId, questionId) rather than
  // read off the wire, so a catalogue row can never point trading at another
  // market. `available` is false only when the backend says it has no such route,
  // which keeps the directory working against one that predates it.
  const catalogued = useMemo(() => catalogueQuestions(catalogue.items, venue), [catalogue.items, venue])
  const questionCatalogue = catalogue.available ? catalogued : reserved.questions
  const standalone = useMemo(() => standaloneQuestions(questionCatalogue, snapshot?.matches ?? []), [questionCatalogue, snapshot?.matches])
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
