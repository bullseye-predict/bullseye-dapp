import '../../styles/home.css'
import '../../styles/home-markets.css'
import '../../styles/markets-directory.css'
import { ArrowLeft, ArrowRight, ArrowUpRight, Eye, Users, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { AgentPortrait, StatusDot, TeamMark, compact } from '../home/HomePrimitives'
import { useHomeData } from '../home/useHomeData'
import { linkedAnswerLabel, linkedQuestionTitle, questionEvents, reservedSolanaView, useQuestionIdentity, useReservedSolanaQuestions } from '../home/solanaQuestionMarkets'
import { useSolanaMarketPrices } from '../home/useSolanaMarketPrices'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { AppShell } from '../solz/AppShell'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { ArenaMarket, SolzMatch, SolzSnapshot } from '../solz/model'
import { eventMarketVolume } from '../events/eventModel'
import { normalisedChances } from './chance'
import { catalogueQuestions, type CatalogueItem } from './marketList'
import { useMarketCatalogue } from './useMarketCatalogue'
import { eventTimingLabel } from '../events/eventTiming'
import { pickInk, teamIdentityColor } from './moneyline'
import { useLogoPalette } from './logoIdentity'

type Props = { apiUrl?: string }

/** A directory entry. A standalone question is not match-backed, so its title,
 *  status and market are supplied rather than derived from teams. */
export type DirectoryRow = {
  match: SolzMatch
  market?: ArenaMarket
  markets?: ArenaMarket[]
  title?: string
  detail?: string
  status?: string
  collateral?: string
  kind?: 'match' | 'general'
  opened?: boolean
  eventType?: CatalogueItem['eventType']
  matchNumber?: number
  hasHumans?: boolean
  gameMode?: string
  teamFormat?: string
}

// All/Live/Upcoming/Settled are statuses; General is a kind (MARKET_LIST_API.md:38
// gives `kind` as its own axis). Naming it after the axis stops it reading as a
// fifth status - every item here is a question, so 'Questions' excluded nothing.
const filters = ['Featured', 'Live', 'Upcoming', 'History', 'All'] as const
type MarketFilter = typeof filters[number]
type EventTypeFilter = 'all' | NonNullable<DirectoryRow['eventType']>
const PAGE_SIZE = 12
const AGENT_COLORS = ['#c7ff00', '#ff579d', '#65cfff', '#ffac57', '#bd9afa', '#f9e071']

const percent = (value: number) => `${Math.round(value * 100)}%`

function scheduleLabel(match: SolzMatch, now: number) {
  return eventTimingLabel(match, now)
}

const eventTypeLabel = (row: DirectoryRow) => row.hasHumans ? 'HUMAN MATCH' : row.eventType === 'genesis-ffa'
  ? 'GENESIS AGENT FFA'
  : row.eventType === 'miaw-prix' ? 'MIAW PRIX · COLOSSEUM'
    : row.eventType === 'general' ? 'GENERAL MARKET' : 'RANKED / STAKE MATCH'

/** General is a market taxonomy, not a game mode. A two-sided general question
 * may be a future human match, but it must never be marketed as a token duel
 * until that product actually exists. */
const cardProgram = (row: DirectoryRow) => row.eventType === 'miaw-prix'
  ? 'MIAW PRIX GAME'
    : row.hasHumans || row.eventType === 'match' ? 'SOLZ.FUN GAME' : null

const absoluteTime = (match: SolzMatch, now: number) => {
  const terminal = match.phase === 'settled' || (match.timingType !== 'open-ended' && match.endsAt <= now)
  const at = terminal ? match.endsAt : match.phase === 'live' ? match.endsAt : match.startedAt
  if (!Number.isFinite(at)) return ''
  const label = terminal ? 'Finished' : match.phase === 'live' ? 'Ends' : 'Begins'
  return `${label} ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at)}`
}

const absoluteTimeAt = (match: SolzMatch, now: number) => match.phase === 'settled'
  || (match.timingType !== 'open-ended' && match.endsAt <= now) || match.phase === 'live' ? match.endsAt : match.startedAt

const agentNumber = (participantId?: string) => {
  const parsed = /^genesis-(\d{1,2})$/i.exec(participantId ?? '')
  return parsed ? Number(parsed[1]) : undefined
}

const agentColor = (number?: number) => number ? AGENT_COLORS[(number - 1) % AGENT_COLORS.length] : undefined

/** teamIdentityColor hashes into a 44-50% lightness band (moneyline.ts:31), which
 *  is tuned for a control that lights up when you pick it. A directory card has
 *  nothing to pick, so every outcome here is drawn already lit: the same x1.18
 *  the button's :hover used to apply, applied once, up front, to all of them.
 *
 *  Done here and not with a CSS filter because the ink is chosen from the fill's
 *  luminance - brightening after pickInk saw the colour could leave white ink on
 *  a fill that had crossed into needing dark. */
function litIdentity(hex: string, by = 1.18) {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return hex
  const channel = (at: number) => Math.min(255, Math.round(parseInt(raw.slice(at, at + 2), 16) * by))
  return `#${[0, 2, 4].map((at) => channel(at).toString(16).padStart(2, '0')).join('')}`
}

const phaseRank = (row: DirectoryRow) => {
  const realMatch = row.eventType !== 'general'
  if (row.match.phase === 'live') return row.hasHumans ? 0 : realMatch ? 1 : 2
  if (row.match.phase === 'countdown' || row.match.phase === 'queued') return row.hasHumans ? 3 : realMatch ? 4 : 5
  return 6
}

export function sortMarketRows(rows: readonly DirectoryRow[]) {
  return [...rows].sort((a, b) => {
    const phase = phaseRank(a) - phaseRank(b)
    if (phase) return phase
    if (a.match.phase === 'settled' && b.match.phase === 'settled') return b.match.endsAt - a.match.endsAt
    return a.match.startedAt - b.match.startedAt
  })
}

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
  const timing = scheduleLabel(match, now)
  const terminal = timing === 'CANCELLED' || timing.startsWith('SETTLED') || timing.startsWith('FINISHED')
  const detail = row.opened === undefined ? row.detail ?? matchDetail(match)
    : terminal ? row.opened ? 'ON-CHAIN · CLOSED' : 'OFF-CHAIN · NEVER OPENED'
      : row.opened ? 'ON-CHAIN' : 'OFF-CHAIN · OPENS ON FIRST TRADE'
  const href = `/events/${encodeURIComponent(match.id)}`
  const program = cardProgram(row)
  // The card's surface states which family it belongs to, so it keys off the
  // event type rather than off whether a programme badge happens to be printed.
  // A Genesis FFA round is a game and carries no badge; tying the two together
  // dropped it onto the general-market grey for want of a label it never has.
  const category = (row.eventType ?? row.kind) === 'general' ? 'is-general' : 'is-game'
  return <article className={`mk-card mk-card--${kind} ${category}${match.phase === 'live' ? ' is-live' : terminal ? ' is-past' : ''}`}>
    <div className="mk-card-kicker">
      <span>{eventTypeLabel(row)}</span>
      {row.matchNumber && <b>MATCH #{row.matchNumber}</b>}
    </div>
    <a className="mk-card-head" href={href} aria-label={`Open ${row.title ?? match.map}`}>
      <h3 className="mk-card-title">{row.title ?? match.map}{program && <small className="mk-card-program">{program}</small>}</h3>
      <ArrowUpRight className="mk-card-open" size={15}/>
    </a>
    <div className="mk-card-status">
      <StatusDot pink={match.phase !== 'live'}>{row.status ?? timing}</StatusDot>
      <span>{detail}</span>
    </div>
    {Number.isFinite(absoluteTimeAt(match, now)) && <time className={`mk-card-time${terminal ? ' is-past' : ''}`} dateTime={new Date(absoluteTimeAt(match, now)).toISOString()}>{absoluteTime(match, now)}</time>}
    {children}
    <div className="mk-card-bottom">
      <span className="mk-card-volume">{compact(marketVolume)} {row.collateral ?? 'COOLA'} Vol.</span>
      <span><Eye size={12}/>{compact(match.viewers)}</span>
    </div>
  </article>
}

function VersusPick({ team, probability, indicative, href }: { team: SolzMatch['teams'][number]; probability: number; indicative: boolean; href: string }) {
  // The fill spans from a dark indigo to a bright olive even before it is lit,
  // so the ink is read off the final colour rather than fixed - the same call
  // the market rows and the ticket make, on the value actually painted.
  // The crest beside the fill is what the fill is coloured from; it is read
  // asynchronously, so this card re-renders when its hue lands.
  useLogoPalette()
  const color = litIdentity(teamIdentityColor(team.symbol, team.logoUrl))
  return <div className="mk-versus-pick" style={{ '--mk-identity': color, '--mk-ink': pickInk(color) } as CSSProperties}>
    <div className="mk-versus-identity">
      <TeamMark id={team.teamId} color={color} logoUrl={team.logoUrl}/>
      <strong>{team.name || team.symbol}</strong>
      {!indicative && <span className="mk-versus-meter" aria-hidden="true"><i style={{ width: percent(probability), background: color }}/></span>}
    </div>
    <a className="mk-versus-button" href={href} aria-label={`Open ${team.symbol} market`}>
      <span>{team.symbol}</span>
      <b>{indicative ? '—' : percent(probability)}</b>
    </a>
  </div>
}

/** Two teams: identity stays in the card; its adjacent price control follows
 * the trade ticket's label-plus-quote treatment and is coloured from the crest. */
function VersusCard({ row, now }: { row: DirectoryRow; now: number }) {
  const odds = teamOdds(row.match, row.market)
  return <CardFrame row={row} now={now} kind="versus">
    <div className="mk-versus">
      {odds.map(({ team, probability, indicative }) => <VersusPick key={team.teamId} team={team} probability={probability} indicative={indicative} href={`/events/${encodeURIComponent(row.match.id)}`}/>) }
    </div>
  </CardFrame>
}

/** One ranked row per contender, highest first, tail collapsed into a count.
 *  Used for a team field and for a set of linked questions alike: both are a
 *  field with no head-to-head to split. */
function RankedCard({ row, now, kind, rows, note }: { row: DirectoryRow; now: number; kind: string; rows: { key: string; label: string; color?: string; imageUrl?: string; participantId?: string; probability: number; indicative?: boolean }[]; note: string }) {
  const ranked = [...rows].sort((a, b) => Number(a.indicative) - Number(b.indicative) || b.probability - a.probability)
  const shown = ranked.slice(0, 4)
  return <CardFrame row={row} now={now} kind={kind}>
    {shown.length > 0 && <div className="mk-ffa">
      {shown.map((item) => <div className="mk-ffa-row" key={item.key}>
        {agentNumber(item.participantId)
          ? <AgentPortrait number={agentNumber(item.participantId)!} className="mk-agent-portrait"/>
          : item.color || item.imageUrl ? <TeamMark id={item.key} color={item.color} logoUrl={item.imageUrl}/> : <span className="mk-ffa-dot" aria-hidden="true"/>}
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
  const rows = contested ? teamOdds(row.match, row.market).map(({ team, probability, indicative }) => ({ key: team.teamId, label: team.symbol, color: team.color, imageUrl: team.logoUrl, probability, indicative })) : []
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
    const suppliedParticipant = market.presentation?.answer?.participantId
    const participantId = agentNumber(suppliedParticipant) ? suppliedParticipant
      : row.eventType === 'genesis-ffa' ? `genesis-${String(index + 1).padStart(2, '0')}` : suppliedParticipant
    return {
      key: market.id,
      // The subject is what differs between linked questions; the shared tail is
      // already the card title, so showing it on every row would be noise.
      label: market.presentation?.answer?.label ?? linkedAnswerLabel(market.title, row.title ?? ''),
      participantId,
      imageUrl: market.presentation?.answer?.imageUrl,
      color: market.presentation?.answer?.color ?? agentColor(agentNumber(participantId)),
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

/**
 * Does what the reader has selected need rows beyond the newest cursor page?
 *
 * Featured, Live and Upcoming are all about matches that have not finished, and
 * the catalogue is ordered newest-created first, so the head page answers them.
 * History is by definition the tail. All spans both. A search or an event-type
 * narrowing is defined across the inventory (MARKET_LIST_API.md), so it must be
 * able to reach rows the head page does not hold — answering it from one page
 * would quietly report "no matching markets" for markets that exist.
 */
export function needsInventory(filter: MarketFilter, eventType: EventTypeFilter, search: string) {
  return filter === 'History' || filter === 'All' || eventType !== 'all' || search.trim().length > 0
}

export function MarketDirectory({ snapshot, questions, loaded = true, error, retry, onScope, extending = false }: {
  snapshot: SolzSnapshot | null
  questions: DirectoryRow[]
  loaded?: boolean
  error: string
  retry: () => void
  /** Told when the selection needs more than the newest catalogue page, so the
   *  owner can widen the read. Never called for the default view. */
  onScope?: (depth: 'head' | 'inventory') => void
  /** The wider read is still running behind the rows already on screen. */
  extending?: boolean
}) {
  const [filter, setFilter] = useState<MarketFilter>('Featured')
  const [eventType, setEventType] = useState<EventTypeFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const allRows = useMemo(() => {
    const snapshotMatches = new Map((snapshot?.matches ?? []).map(match => [match.id, match]))
    const snapshotMarkets = new Map<string, ArenaMarket[]>()
    for (const market of snapshot?.markets ?? []) {
      if (!market.matchId) continue
      const current = snapshotMarkets.get(market.matchId) ?? []
      current.push(market)
      snapshotMarkets.set(market.matchId, current)
    }
    return sortMarketRows(questions.map(row => {
      const match = snapshotMatches.get(row.match.id)
      if (!match) return row
      const markets = snapshotMarkets.get(match.id) ?? row.markets ?? []
      return { ...row, match, market: markets[0] ?? row.market, markets: markets.length ? markets : row.markets, title: row.title ?? matchTitle(match) }
    }).filter(row => {
      const phase = row.match.phase
      const selected = filter === 'All'
        || (filter === 'Featured' ? phase !== 'settled' && row.eventType !== 'genesis-ffa'
          : filter === 'Live' ? phase === 'live'
            : filter === 'History' ? phase === 'settled'
              : phase === 'countdown' || phase === 'queued')
      const typeSelected = eventType === 'all' || row.eventType === eventType
      return selected && typeSelected && `${row.title ?? ''} ${row.match.mode} ${eventTypeLabel(row)} ${row.match.teams.map(team => team.name).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())
    }))
  }, [snapshot, questions, filter, eventType, search])
  useEffect(() => setPage(1), [filter, eventType, search])
  // Widen the catalogue read as soon as the selection needs the tail, and never
  // narrow it back: the rows are already held, and dropping them would make
  // stepping back to Featured throw away a walk the reader just paid for.
  useEffect(() => {
    if (needsInventory(filter, eventType, search)) onScope?.('inventory')
  }, [filter, eventType, search, onScope])
  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE))
  useEffect(() => setPage(current => Math.min(current, pageCount)), [pageCount])
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const setStatusFilter = (value: MarketFilter) => { setFilter(value); setPage(1) }
  const setTypeFilter = (value: EventTypeFilter) => {
    setEventType(value)
    if (value === 'genesis-ffa' && filter === 'Featured') setFilter('All')
    setPage(1)
  }
  const movePage = (next: number) => {
    setPage(Math.max(1, Math.min(pageCount, next)))
    document.querySelector('#market-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const pagination = pageCount > 1 && <nav className="mk-pagination" aria-label="Market pages">
    <button type="button" onClick={() => movePage(page - 1)} disabled={page === 1}><ArrowLeft size={16}/>Previous</button>
    <span>Page <b>{page}</b> of {pageCount}</span>
    <button type="button" onClick={() => movePage(page + 1)} disabled={page === pageCount}>Next<ArrowRight size={16}/></button>
  </nav>
  return <AppShell className="solz-home mk-app" mainId="market-directory" mainClassName="mk-main" marketsHref="/markets" active="markets" skipTo="#market-directory" skipLabel="Skip to markets" backToTopHref="#market-directory">
      <header className="mk-heading"><div><span>EVENT CATALOGUE</span><h1 className="sz-page-title">Prediction markets</h1><p>Live matches first. Every eligible match stays visible before opening, while live human matches take priority.</p></div><label className="mk-search"><Search size={18}/><input type="search" aria-label="Search markets" placeholder="Search markets" value={search} onChange={event => setSearch(event.target.value)}/></label></header>
      <div className="mk-directory-controls">
        <nav className="mk-filters" aria-label="Filter by status">{filters.map(item => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setStatusFilter(item)}>{item}</button>)}</nav>
        <label className="mk-type-filter"><span>Event type</span><select value={eventType} onChange={event => setTypeFilter(event.target.value as EventTypeFilter)}>
          <option value="all">All event types</option><option value="miaw-prix">MIAW Prix · Colosseum</option><option value="match">Ranked / stake match</option><option value="general">General market</option><option value="genesis-ffa">Genesis Agent FFA</option>
        </select></label>
      </div>
      {filter === 'Featured' && eventType === 'all' && <p className="mk-filter-note">Routine 20-minute Genesis FFA rounds are hidden here. Choose <b>Genesis Agent FFA</b> or <b>All</b> to see them.</p>}
      {error && !snapshot && !questions.length && loaded ? <div className="mk-state" role="alert"><strong>Markets could not load.</strong><span>{error}</span><button className="sh-button" onClick={retry}>Try again</button></div> : !loaded && !snapshot ? <div className="mk-card-grid" role="status" aria-busy="true" aria-label="Loading markets">
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
        {/* A count taken while the wider read is still running is a count of
            what has arrived, not of what matches — so it says so rather than
            letting a partial number read as the answer. */}
        <div className="mk-results-bar"><span className="mk-result-count" role="status">{allRows.length ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, allRows.length)} of ${allRows.length}${extending ? ' so far' : ''}` : extending ? 'Reading the full catalogue…' : '0 markets'}</span>{pagination}</div>
        {rows.length ? <div className="mk-card-grid">{rows.map(row => <MarketCard key={row.match.id} row={row} now={now}/>)}</div>
          : extending ? <div className="mk-empty" role="status"><strong>Reading the full catalogue…</strong><span>History and search span every match ever listed, so this view is still loading the rest of them.</span></div>
          : <div className="mk-empty"><strong>{search || filter !== 'All' ? 'No matching markets' : 'No markets available yet'}</strong><span>{search || filter !== 'All' ? 'Try another filter or search.' : 'Every ranked or stake match appears here as soon as it has a match ID.'}</span></div>}
        {pagination && <div className="mk-pagination-bottom">{pagination}</div>}
      </>}
  </AppShell>
}

export function MarketsDirectoryApp({ apiUrl = '' }: Props) {
  const source = useMemo(() => createSolzDataSource({ simulationEnabled: () => false }), [])
  const { snapshot, error, retry } = useHomeData(source, apiUrl)
  const venue = useSolanaVenue(apiUrl)
  /**
   * HOW MUCH CATALOGUE THIS PAGE IS ALLOWED TO ASK FOR.
   *
   * 'open' is the default and is one request: status=eligible, selected at the
   * source, no cursor. It answers Featured, Live and Upcoming completely.
   *
   * It widens to 'inventory' - status=all, the whole cursor chain, walked once -
   * the first time the reader selects something that is defined across the
   * inventory: History, All, an event type, or a search. It never narrows back,
   * because the rows are already held and dropping them would throw away a walk
   * the reader just waited for.
   *
   * The page used to open directly on status=all and crawl the entire chain -
   * 15 requests, ~10,600 items, 77s a lap - and restart that crawl every ten
   * seconds. Every lap rebuilt a market PDA, a token identity pass and an
   * on-chain price read for every row, which is what kept the grid on its
   * skeletons: the commit that would have replaced them never got a free frame.
   */
  const [scope, setScope] = useState<'open' | 'inventory'>('open')
  const widen = useCallback((depth: 'head' | 'inventory') => {
    if (depth === 'inventory') setScope('inventory')
  }, [])
  const catalogue = useMarketCatalogue(
    apiUrl,
    scope === 'open' ? 'eligible' : 'all',
    30_000,
    scope === 'open' ? 'head' : 'inventory',
  )
  const reserved = useReservedSolanaQuestions(apiUrl, venue)
  // GET /market/list is the catalogue (docs/MARKET_LIST_API.md). Its market
  // addresses are derived here from (programId, matchId, questionId) rather than
  // read off the wire, so a catalogue row can never point trading at another
  // market. `available` is false only when the backend says it has no such route,
  // which keeps the directory working against one that predates it.
  const rawCatalogueQuestions = useMemo(() => catalogueQuestions(catalogue.items, venue), [catalogue.items, venue])
  const identifiedCatalogueQuestions = useQuestionIdentity(rawCatalogueQuestions)
  const catalogued = useMemo(() => identifiedCatalogueQuestions.map(question => ({ ...reservedSolanaView(question, Date.now(), venue), question })), [identifiedCatalogueQuestions, venue])
  const questionCatalogue = catalogue.available ? catalogued : reserved.questions
  /**
   * ONLY TRADABLE MARKETS ARE PRICED FROM THE CHAIN.
   *
   * useSolanaMarketPrices derives a PDA and reads two book accounts per market,
   * every pass. Handed the whole catalogue that was ~21,000 account reads per
   * cycle for a grid of twelve cards, chunked into hundreds of RPC round trips —
   * the single largest thing blocking this page's main thread.
   *
   * A settled or cancelled market has no book worth reading and no price that
   * can still move: its card shows a result, not a quote. Narrowing to markets
   * whose trading has not locked is therefore not a sampling compromise, it is
   * the set that has a live price at all. Measured against the deployed
   * catalogue that is ~137 of ~10,610 rows.
   *
   * `phase === 'settled'` is the right test and not merely the convenient one:
   * reservedSolanaView (src/components/home/solanaQuestionMarkets.ts:179) sets
   * it from `cancelled || settled || past its trading window`, which is exactly
   * "no longer tradable" rather than "reported as resolved".
   */
  const tradableMarkets = useMemo(
    () => questionCatalogue.filter((view) => view.match.phase !== 'settled').map((view) => view.market),
    [questionCatalogue],
  )
  const priced = useSolanaMarketPrices(tradableMarkets, venue, true).markets
  const pricedById = useMemo(() => new Map(priced.map((market) => [`${market.matchId}:${market.id}`, market])), [priced])
  const metadataByEvent = useMemo(() => new Map(catalogue.items.map(item => [item.eventId, item])), [catalogue.items])
  // Every catalogue event gets one directory row. Market existence is not
  // conditional on a live arena snapshot or on somebody already paying to
  // create its PDA; the merge above replaces only its live match telemetry.
  const questions = useMemo<DirectoryRow[]>(
    () => questionEvents(questionCatalogue).map((views) => {
      const markets = views.map((view) => pricedById.get(`${view.market.matchId}:${view.market.id}`) ?? view.market)
      const opened = markets.some(market => market.onchain?.family === 'SOLANA' && market.onchain.opened)
      const metadata = metadataByEvent.get(views[0].question.eventId)
      return {
        match: views[0].match,
        market: markets[0],
        markets,
        title: views[0].question.presentation?.eventTitle ?? markets[0]?.presentation?.eventTitle ?? linkedQuestionTitle(markets.map((market) => market.title)),
        collateral: venue.collateralSymbol,
        opened,
        kind: metadata?.kind ?? (views[0].question.questionId.slice(12, 14) === '02' ? 'general' : 'match'),
        eventType: metadata?.eventType ?? (views[0].question.questionId.slice(12, 14) === '02' ? 'general' : 'match'),
        matchNumber: metadata?.matchNumber,
        hasHumans: metadata?.hasHumans ?? false,
        gameMode: metadata?.gameMode,
        teamFormat: metadata?.teamFormat,
      }
    }),
    [questionCatalogue, pricedById, metadataByEvent],
  )
  return <MarketDirectory
    snapshot={snapshot}
    questions={questions}
    loaded={catalogue.loaded || reserved.loaded}
    error={error}
    retry={retry}
    onScope={widen}
    extending={catalogue.extending}
  />
}
